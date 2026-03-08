import { spawn } from "child_process";
import { NextRequest, NextResponse } from "next/server";
import path from "path";

const RPC_URL = process.env.ANVIL_RPC || "http://127.0.0.1:8545";
// Anvil account 1 — has WORKFLOW_ROLE on ClaimDecisionRegistry + ClaimEscrow
const CRE_SIGNER_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const CDR = "0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9"; // ClaimDecisionRegistry
const ESCROW = "0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9"; // ClaimEscrow
const TREASURY = "0x90F79bf6EB2c4f870365E785982E1f101E93b906"; // Anvil account 3
const PROJECT_ROOT = path.resolve(process.cwd(), "../..");

// Fixture proof hash used by all workflows
const PROOF_HASH = "0xb8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8";
const POLICY_HASH = "0xa1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1";

/**
 * POST /api/chain — Execute on-chain operations for demo.
 *
 * Actions:
 *   { action: "resetAndDeploy" }
 *   { action: "submitClaim", claimId, policyHash }
 *   { action: "settle", claimId, amount }
 *     — Full settlement: submitClaim → setProofResult → schedulePayout → releasePayout → markPaid
 *   { action: "settleAfterSubmit", claimId, amount }
 *     — Settlement without submitClaim (claim already SUBMITTED): setProofResult → schedulePayout → releasePayout → markPaid
 */
export async function POST(req: NextRequest) {
  const body = await req.json();

  switch (body.action) {
    case "resetAndDeploy":
      return handleResetAndDeploy();

    case "submitClaim":
      if (!body.claimId || !body.policyHash) {
        return NextResponse.json(
          { error: "Required: { claimId, policyHash }" },
          { status: 400 }
        );
      }
      return handleSubmitClaim(body.claimId, body.policyHash);

    case "settle":
      if (!body.claimId || !body.amount) {
        return NextResponse.json(
          { error: "Required: { claimId, amount }" },
          { status: 400 }
        );
      }
      return handleSettle(body.claimId, body.amount, true);

    case "settleAfterSubmit":
      if (!body.claimId || !body.amount) {
        return NextResponse.json(
          { error: "Required: { claimId, amount }" },
          { status: 400 }
        );
      }
      return handleSettle(body.claimId, body.amount, false);

    default:
      return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }
}

/**
 * Full settlement pipeline — mirrors what CRE workflow would write on-chain.
 * submitClaim → setProofResult(approved) → schedulePayout → releasePayout → markPaid
 */
async function handleSettle(claimId: string, amount: string, includeSubmit: boolean) {
  const steps: { name: string; target: string; sig: string; args: string[] }[] = [];

  if (includeSubmit) {
    steps.push({
      name: "submitClaim",
      target: CDR,
      sig: "submitClaim(bytes32,bytes32)",
      args: [claimId, POLICY_HASH],
    });
  }

  steps.push(
    {
      name: "setProofResult",
      target: CDR,
      sig: "setProofResult(bytes32,bytes32,uint256,bool)",
      args: [claimId, PROOF_HASH, "0", "true"],
    },
    {
      name: "schedulePayout",
      target: ESCROW,
      sig: "schedulePayout(bytes32,address,uint256)",
      args: [claimId, TREASURY, amount],
    },
    {
      name: "releasePayout",
      target: ESCROW,
      sig: "releasePayout(bytes32)",
      args: [claimId],
    },
    {
      name: "markPaid",
      target: CDR,
      sig: "markPaid(bytes32)",
      args: [claimId],
    }
  );

  const results: { step: string; txHash: string }[] = [];
  for (const step of steps) {
    try {
      const txHash = await castSendTo(step.target, step.sig, step.args);
      results.push({ step: step.name, txHash });
    } catch (err) {
      return NextResponse.json(
        {
          error: `${step.name} failed: ${(err as Error).message}`,
          completedSteps: results,
        },
        { status: 500 }
      );
    }
  }

  return NextResponse.json({ ok: true, steps: results });
}

async function handleResetAndDeploy() {
  try {
    const resetRes = await fetch(RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "anvil_reset",
        params: [],
        id: 1,
      }),
      signal: AbortSignal.timeout(5000),
    });
    const resetBody = await resetRes.json();
    if (resetBody.error) {
      return NextResponse.json(
        { error: `anvil_reset failed: ${resetBody.error.message}` },
        { status: 500 }
      );
    }
  } catch (err) {
    return NextResponse.json(
      { error: `Cannot reach Anvil: ${(err as Error).message}` },
      { status: 500 }
    );
  }

  try {
    const output = await runCommand("make", ["deploy-local"], PROJECT_ROOT);
    return NextResponse.json({ ok: true, output });
  } catch (err) {
    return NextResponse.json(
      { error: `Deploy failed: ${(err as Error).message}` },
      { status: 500 }
    );
  }
}

async function handleSubmitClaim(claimId: string, policyHash: string) {
  try {
    const txHash = await castSendTo(CDR, "submitClaim(bytes32,bytes32)", [claimId, policyHash]);
    return NextResponse.json({ txHash });
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.includes("duplicate claim_id")) {
      try {
        const txHash = await findClaimSubmittedTx(claimId);
        return NextResponse.json({ txHash, reused: true });
      } catch {
        return NextResponse.json(
          { error: "Claim already exists but could not find original txHash" },
          { status: 500 }
        );
      }
    }
    return NextResponse.json({ error: `cast send failed: ${msg}` }, { status: 500 });
  }
}

function runCommand(cmd: string, args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { cwd, env: { ...process.env } });
    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data: Buffer) => { stdout += data.toString(); });
    proc.stderr.on("data", (data: Buffer) => { stderr += data.toString(); });

    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr || stdout || `exit code ${code}`));
        return;
      }
      resolve(stdout);
    });

    proc.on("error", reject);
  });
}

function castSendTo(target: string, sig: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn("cast", [
      "send",
      "--private-key", CRE_SIGNER_KEY,
      target,
      sig,
      ...args,
      "--rpc-url", RPC_URL,
      "--json",
    ]);

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data: Buffer) => { stdout += data.toString(); });
    proc.stderr.on("data", (data: Buffer) => { stderr += data.toString(); });

    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr || `exit code ${code}`));
        return;
      }
      try {
        const result = JSON.parse(stdout);
        resolve(result.transactionHash);
      } catch {
        reject(new Error(`Failed to parse cast output: ${stdout}`));
      }
    });

    proc.on("error", reject);
  });
}

function findClaimSubmittedTx(claimId: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn("cast", [
      "logs",
      "--from-block", "0",
      "--address", CDR,
      "ClaimSubmitted(bytes32,bytes32)",
      claimId,
      "--json",
      "--rpc-url", RPC_URL,
    ]);

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data: Buffer) => { stdout += data.toString(); });
    proc.stderr.on("data", (data: Buffer) => { stderr += data.toString(); });

    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr || `exit code ${code}`));
        return;
      }
      try {
        const logs = JSON.parse(stdout);
        if (Array.isArray(logs) && logs.length > 0) {
          resolve(logs[0].transactionHash);
        } else {
          reject(new Error("No ClaimSubmitted event found"));
        }
      } catch {
        reject(new Error(`Failed to parse logs output: ${stdout}`));
      }
    });

    proc.on("error", reject);
  });
}
