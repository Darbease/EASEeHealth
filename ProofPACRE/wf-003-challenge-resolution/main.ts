import {
  CronCapability,
  ConfidentialHTTPClient,
  EVMClient,
  handler,
  Runner,
  type Runtime,
  type CronPayload,
  ok,
  text,
  encodeCallMsg,
  prepareReportRequest,
  LATEST_BLOCK_NUMBER,
  bytesToHex,
} from "@chainlink/cre-sdk";

import { encodeFunctionData, decodeFunctionResult } from "viem";
// CRE SDK handles transport, signing, and DON consensus; viem handles ABI encoding/decoding only.

// ---------------------------------------------------------------------------
// WF-003 · ChallengeResolution · Cron trigger
//
// Monitors pending challenges on approved claims. Reads on-chain state to
// determine whether to challenge, resolve, or cancel payouts. Implements the
// APPROVED → CHALLENGED → APPROVED|DENIED state transitions.
//
// CRE capabilities: ConfidentialHTTPClient, EVMClient
// Contracts touched:
//   READ  — ClaimDecisionRegistry.getDecision
//   WRITE — ClaimDecisionRegistry.challengeClaim / resolveChallenge,
//           ClaimEscrow.cancelPayout
// Demo scenario: C (challenge → payout blocked → resolution)
// Privacy: no PHI on-chain — only claim state transitions and escrow operations
// Spec: TECH_ARCHITECTURE_SPEC_ProofPA.md § 8.3
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Defensive JSON parser (CRE WASM cannot share code across workflows)
// ---------------------------------------------------------------------------
function safeParse(raw: string): Record<string, any> | null {
  try { return JSON.parse(raw); } catch { return null; }
}

// ---------------------------------------------------------------------------
// Contract ABI Fragments
// CRE compiles each workflow to isolated WASM — no shared imports between
// workflows, so ABI fragments are duplicated per-file.
// ---------------------------------------------------------------------------
// ClaimDecision struct: { bytes32 claimId, bytes32 policyHash, uint8 state,
//   bytes32 proofHash, uint256 reasonBitmap, uint256 updatedAt }
const CLAIM_DECISION_REGISTRY_ABI = [
  {
    name: "getDecision",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "claimId", type: "bytes32" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "claimId", type: "bytes32" },
          { name: "policyHash", type: "bytes32" },
          { name: "state", type: "uint8" },
          { name: "proofHash", type: "bytes32" },
          { name: "reasonBitmap", type: "uint256" },
          { name: "updatedAt", type: "uint256" },
        ],
      },
    ],
  },
  {
    name: "challengeClaim",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "claimId", type: "bytes32" },
      { name: "reason", type: "string" },
    ],
    outputs: [],
  },
  {
    name: "resolveChallenge",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "claimId", type: "bytes32" },
      { name: "approved", type: "bool" },
    ],
    outputs: [],
  },
] as const;

const CLAIM_ESCROW_ABI = [
  {
    name: "cancelPayout",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "claimId", type: "bytes32" }],
    outputs: [],
  },
] as const;

// State enum values: 0=NONE, 1=SUBMITTED, 2=PROOF_PENDING, 3=APPROVED, 4=DENIED, 5=CHALLENGED, 6=PAID
const STATE_NAMES = ["NONE", "SUBMITTED", "PROOF_PENDING", "APPROVED", "DENIED", "CHALLENGED", "PAID"];

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
export type Config = {
  schedule: string;                    // Cron expression — triggers workflow on DON nodes
  callbackServiceUrl: string;          // decision-callback-service base URL (port 3006)
  owner: string;                       // Vault owner address — empty for simulation, set in production
  chainSelector: string;              // EIP-155 chain selector — Base Sepolia in staging
  claimDecisionRegistryAddress: string; // Deployed ClaimDecisionRegistry (state machine)
  claimEscrowAddress: string;          // Deployed ClaimEscrow (ERC-20 mock USDC pool)
  creSignerAddress: string;            // DON-controlled signer — has WORKFLOW_ROLE on all contracts
};

// ---------------------------------------------------------------------------
// Handler: onChallengeResolutionCheck
// ---------------------------------------------------------------------------
// Cron-triggered workflow that checks for pending challenge resolutions.
// Uses EVMClient to verify claim state on-chain before processing.
// ---------------------------------------------------------------------------
export const onChallengeResolutionCheck = (
  runtime: Runtime<Config>,
  _cronPayload: CronPayload
): string => {
  const config = runtime.config;
  runtime.log("WF-003: Challenge Resolution Monitor — reviewing blocked payouts");

  // ---- Step 1: Poll callback service for pending challenges [HTTP] ----
  const confidentialClient = new ConfidentialHTTPClient();

  runtime.log("WF-003: [ENCRYPTED] Polling for pending challenges requiring clinical review");
  const challengeResp = confidentialClient.sendRequest(runtime, {
    vaultDonSecrets: [
      { key: "policyServiceApiKey", owner: config.owner },
      { key: "aesEncryptionKey", owner: config.owner },
    ],
    request: {
      url: `${config.callbackServiceUrl}/v1/callbacks/pending-challenges`,
      method: "GET",
      multiHeaders: {
        "Content-Type": { values: ["application/json"] },
        "Authorization": { values: ["Bearer {{.policyServiceApiKey}}"] },
      },
      encryptOutput: true,
    },
  }).result();

  if (!ok(challengeResp)) {
    runtime.log(`WF-003: Challenge service error: ${challengeResp.statusCode}`);
    return JSON.stringify({
      workflow: "WF-003-ChallengeResolution",
      status: "ERROR",
      timestamp: runtime.now().toISOString(),
    });
  }

  const challengeBody = text(challengeResp);
  let challengeCount = 1, resolution = "APPROVED", challengerDisplay = "clinical-review";
  const challengeData = safeParse(challengeBody);
  if (challengeData && Array.isArray(challengeData.challenges)) {
    challengeCount = challengeData.challenges.length;
    const ch = challengeData.challenges[0];
    resolution = ch?.resolution ?? resolution;
    challengerDisplay = ch?.clinical_context?.challenger_display ?? challengerDisplay;
  }

  // ---- Step 2: Verify claim state on-chain [EVM READ] ----
  const evmClient = new EVMClient(BigInt(config.chainSelector));
  // Deterministic demo fixture ID — matches dashboard Scenario C polling target.
  const demoClaimId = ("0x" + "e5".repeat(32)) as `0x${string}`;
  runtime.log(`WF-003: ${challengeCount} challenge(s) found for claim ${demoClaimId.substring(0, 10)}... — flagged by ${challengerDisplay}`);

  const calldata = encodeFunctionData({
    abi: CLAIM_DECISION_REGISTRY_ABI,
    functionName: "getDecision",
    args: [demoClaimId],
  });

  const decisionResult = evmClient.callContract(runtime, {
    call: encodeCallMsg({
      from: config.creSignerAddress as `0x${string}`,
      to: config.claimDecisionRegistryAddress as `0x${string}`,
      data: calldata,
    }),
    // Read from the chain tip, not a specific block height.
    blockNumber: LATEST_BLOCK_NUMBER,
  }).result();

  const decision = decodeFunctionResult({
    abi: CLAIM_DECISION_REGISTRY_ABI,
    functionName: "getDecision",
    data: bytesToHex(decisionResult.data),
  });

  const stateNum = Number(decision.state);
  const stateName = STATE_NAMES[stateNum] || `UNKNOWN(${stateNum})`;
  runtime.log(`WF-003: On-chain claim state: ${stateName} — payout ${stateName === "CHALLENGED" ? "BLOCKED pending review" : stateName === "APPROVED" ? "released after resolution" : stateName}`);

  // ---- Step 3: Challenge claim on-chain if APPROVED [EVM WRITE] ----
  // State-dependent branching: stateNum === 3 (APPROVED) triggers challengeClaim,
  // currentState === 5 (CHALLENGED) in Step 4 triggers resolveChallenge.
  // If resolution denies, Step 5 cancels the payout via ClaimEscrow.
  let challengedOnchain = false;
  if (stateNum === 3 && challengeCount > 0) {
    // State 3 = APPROVED — transition to CHALLENGED
    const challengeCalldata = encodeFunctionData({
      abi: CLAIM_DECISION_REGISTRY_ABI,
      functionName: "challengeClaim",
      args: [demoClaimId, challengerDisplay],
    });

    // Two-phase EVM write: prepareReportRequest generates DON-signed report, writeReport
    // submits it on-chain. The contract verifies the DON signature via WORKFLOW_ROLE.
    runtime.log(`WF-003: Claim is APPROVED with pending challenge — writing challengeClaim on-chain`);
    const challengeReport = runtime.report(prepareReportRequest(challengeCalldata)).result();
    const challengeWriteResult = evmClient.writeReport(runtime, {
      receiver: config.claimDecisionRegistryAddress,
      report: challengeReport,
      gasConfig: { gasLimit: "500000" },
    }).result();
    challengedOnchain = challengeWriteResult.txStatus === 1;
    runtime.log(`WF-003: challengeClaim tx status: ${challengedOnchain ? "CONFIRMED — payout BLOCKED" : challengeWriteResult.txStatus}`);
  } else if (stateNum === 3) {
    runtime.log(`WF-003: Claim APPROVED — no pending challenges, no write needed`);
  }

  // ---- Step 4: Resolve challenge if CHALLENGED [EVM WRITE] ----
  // In the demo flow, after challenging we simulate resolution from the service response
  let resolvedOnchain = false;
  let resolutionApproved = false;
  const currentState = challengedOnchain ? 5 : stateNum; // 5 = CHALLENGED
  if (currentState === 5) {
    // Parse resolution directive from the challenge data
    resolutionApproved = resolution === "APPROVED" || resolution !== "DENIED";

    const resolveCalldata = encodeFunctionData({
      abi: CLAIM_DECISION_REGISTRY_ABI,
      functionName: "resolveChallenge",
      args: [demoClaimId, resolutionApproved],
    });

    runtime.log(`WF-003: Resolving challenge — decision: ${resolutionApproved ? "APPROVED (payout unblocked)" : "DENIED (payout cancelled)"}`);
    const resolveReport = runtime.report(prepareReportRequest(resolveCalldata)).result();
    const resolveResult = evmClient.writeReport(runtime, {
      receiver: config.claimDecisionRegistryAddress,
      report: resolveReport,
      gasConfig: { gasLimit: "500000" },
    }).result();
    resolvedOnchain = resolveResult.txStatus === 1;
    runtime.log(`WF-003: resolveChallenge tx status: ${resolvedOnchain ? "CONFIRMED" : resolveResult.txStatus}`);

    // ---- Step 5: Cancel payout if denied after challenge [EVM WRITE] ----
    if (!resolutionApproved) {
      const cancelCalldata = encodeFunctionData({
        abi: CLAIM_ESCROW_ABI,
        functionName: "cancelPayout",
        args: [demoClaimId],
      });

      runtime.log(`WF-003: Challenge DENIED — cancelling payout on ClaimEscrow`);
      const cancelReport = runtime.report(prepareReportRequest(cancelCalldata)).result();
      const cancelResult = evmClient.writeReport(runtime, {
        receiver: config.claimEscrowAddress,
        report: cancelReport,
        gasConfig: { gasLimit: "500000" },
      }).result();
      runtime.log(`WF-003: cancelPayout tx status: ${cancelResult.txStatus === 1 ? "CONFIRMED — funds returned to pool" : cancelResult.txStatus}`);
    }
  }

  // ---- Step 6: Post resolution results [HTTP] ----
  const finalState = resolvedOnchain ? (resolutionApproved ? "APPROVED" : "DENIED") : stateName;
  runtime.log(`WF-003: [ENCRYPTED] Posting resolution: claim ${finalState} — notifying provider`);
  const resolutionJsonStr = JSON.stringify({
    workflow_id: "WF-003",
    resolutions: challengeBody,
    onchain_claim_state: finalState,
    challenged_onchain: challengedOnchain,
    resolved_onchain: resolvedOnchain,
    resolution_approved: resolutionApproved,
    timestamp: runtime.now().toISOString(),
  });
  const resolutionResp = confidentialClient.sendRequest(runtime, {
    vaultDonSecrets: [
      { key: "aesEncryptionKey", owner: config.owner },
    ],
    request: {
      url: `${config.callbackServiceUrl}/v1/callbacks/challenge-resolved`,
      method: "POST",
      bodyString: resolutionJsonStr,
      multiHeaders: {
        "Content-Type": { values: ["application/json"] },
      },
      encryptOutput: true,
    },
  }).result();

  const resOk = ok(resolutionResp);
  runtime.log(`WF-003: Resolution notification: ${resOk ? "Provider notified of challenge outcome" : "FAILED — manual follow-up required"}`);

  // Workflow output — serialized to CRE simulate logs and consumed by the
  // dashboard's outcome verification banner to compare expected vs actual results.
  return JSON.stringify({
    workflow: "WF-003-ChallengeResolution",
    status: resOk ? "COMPLETED" : "CALLBACK_FAILED",
    onchain_claim_state: finalState,
    challenged_onchain: challengedOnchain,
    resolved_onchain: resolvedOnchain,
    resolution_approved: resolutionApproved,
    timestamp: runtime.now().toISOString(),
  });
};

// ---------------------------------------------------------------------------
// Workflow init
// ---------------------------------------------------------------------------
// CronCapability serves as the trigger mechanism. In staging, workflows run on
// a cron schedule. The dashboard invokes them on-demand via `cre workflow simulate`.
export const initWorkflow = (config: Config) => {
  const cron = new CronCapability();

  return [
    handler(
      cron.trigger({ schedule: config.schedule }),
      onChallengeResolutionCheck
    ),
  ];
};

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------
export async function main() {
  const runner = await Runner.newRunner<Config>();
  await runner.run(initWorkflow);
}
