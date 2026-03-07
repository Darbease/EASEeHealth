import {
  CronCapability,
  EVMClient,
  handler,
  Runner,
  type Runtime,
  type CronPayload,
  encodeCallMsg,
  LATEST_BLOCK_NUMBER,
  bytesToHex,
} from "@chainlink/cre-sdk";

import { encodeFunctionData, decodeFunctionResult } from "viem";
// CRE SDK handles transport, signing, and DON consensus; viem handles ABI encoding/decoding only.

// ---------------------------------------------------------------------------
// WF-004 · ReconciliationMonitor · Cron trigger (every 30s in staging)
//
// Read-only SLO compliance monitor. Detects stuck PROOF_PENDING claims,
// APPROVED claims without scheduled payouts, and state mismatches between
// ClaimDecisionRegistry and ClaimEscrow. No on-chain writes — alerts only.
//
// CRE capabilities: EVMClient (read-only)
// Contracts touched:
//   READ — ClaimDecisionRegistry.getDecision, ClaimEscrow.getPayout
// Demo scenario: standalone (runs after WF-001 to verify state consistency)
// Privacy: no PHI on-chain — reads only hashes and numeric state
// Spec: TECH_ARCHITECTURE_SPEC_ProofPA.md § 8.4
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Contract ABI Fragments
// CRE compiles each workflow to isolated WASM — no shared imports between
// workflows, so ABI fragments are duplicated per-file.
// ---------------------------------------------------------------------------
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
] as const;

const CLAIM_ESCROW_ABI = [
  {
    name: "getPayout",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "claimId", type: "bytes32" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "recipient", type: "address" },
          { name: "amount", type: "uint256" },
          { name: "status", type: "uint8" },
        ],
      },
    ],
  },
] as const;

// State enum: 0=NONE, 1=SUBMITTED, 2=PROOF_PENDING, 3=APPROVED, 4=DENIED, 5=CHALLENGED, 6=PAID
const STATE_NAMES = ["NONE", "SUBMITTED", "PROOF_PENDING", "APPROVED", "DENIED", "CHALLENGED", "PAID"];
// PayoutStatus: 0=NONE, 1=SCHEDULED, 2=RELEASED, 3=CANCELLED
const PAYOUT_STATUS_NAMES = ["NONE", "SCHEDULED", "RELEASED", "CANCELLED"];

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
export type Config = {
  schedule: string;                    // Cron expression — every 30s in staging for demo visibility
  chainSelector: string;              // EIP-155 chain selector — Base Sepolia in staging
  claimDecisionRegistryAddress: string; // Deployed ClaimDecisionRegistry (state machine)
  claimEscrowAddress: string;          // Deployed ClaimEscrow (ERC-20 mock USDC pool)
  creSignerAddress: string;            // DON-controlled signer — has WORKFLOW_ROLE on all contracts
  sloTargetSeconds: number;            // Max age for PROOF_PENDING before SLO violation (default 900s = 15 min)
};

// ---------------------------------------------------------------------------
// Handler: onReconciliationCheck
// ---------------------------------------------------------------------------
// Cron-triggered (every 30s in staging) reconciliation monitor.
// Uses EVMClient to read on-chain state and detect:
//   - Stuck PROOF_PENDING claims (should resolve within SLO target)
//   - APPROVED claims without scheduled payouts
//   - State mismatches between ClaimDecisionRegistry and ClaimEscrow
// ---------------------------------------------------------------------------
export const onReconciliationCheck = (
  runtime: Runtime<Config>,
  _cronPayload: CronPayload
): string => {
  const config = runtime.config;
  const now = runtime.now().toISOString();
  const sloDisplay = `${Math.floor(config.sloTargetSeconds / 60)} min`;
  runtime.log(`WF-004: Reconciliation Monitor — SLO compliance check at ${now}`);

  const evmClient = new EVMClient(BigInt(config.chainSelector));

  // Deterministic demo fixture ID — same as WF-001's claim, so reconciliation
  // can verify the state left behind by the prior-auth decision flow.
  const demoClaimId = ("0x" + "01".repeat(32)) as `0x${string}`;

  // ---- Read claim decision state [EVM READ] ----
  runtime.log("WF-004: Reading claim state from ClaimDecisionRegistry on Base Sepolia...");

  const decisionCalldata = encodeFunctionData({
    abi: CLAIM_DECISION_REGISTRY_ABI,
    functionName: "getDecision",
    args: [demoClaimId],
  });

  const decisionResult = evmClient.callContract(runtime, {
    call: encodeCallMsg({
      from: config.creSignerAddress as `0x${string}`,
      to: config.claimDecisionRegistryAddress as `0x${string}`,
      data: decisionCalldata,
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
  const updatedAt = Number(decision.updatedAt);

  runtime.log(`WF-004: Claim ${demoClaimId.substring(0, 10)}...: state=${stateName}, last updated ${updatedAt > 0 ? new Date(updatedAt * 1000).toISOString() : "never"}`);

  // PROOF_PENDING age check — config.sloTargetSeconds (default 900s = 15 min).
  // Claims stuck beyond this threshold indicate a proof-service failure that
  // WF-004 alerts on so ops can investigate.
  let stuckClaims = 0;
  if (stateNum === 2) { // PROOF_PENDING
    const ageSeconds = Math.floor(Date.now() / 1000) - updatedAt;
    const ageMin = Math.floor(ageSeconds / 60);
    const ageSec = ageSeconds % 60;
    if (ageSeconds > config.sloTargetSeconds) {
      runtime.log(`WF-004: SLO VIOLATION — Claim stuck in PROOF_PENDING for ${ageMin}m${ageSec}s (SLO target: ${sloDisplay})`);
      stuckClaims = 1;
    } else {
      runtime.log(`WF-004: Claim in PROOF_PENDING for ${ageMin}m${ageSec}s — within ${sloDisplay} SLO threshold`);
    }
  }

  // Cross-reference ClaimDecisionRegistry state against ClaimEscrow payout status.
  // PAID claims must have RELEASED payouts; APPROVED claims must have SCHEDULED payouts.
  // Mismatches indicate interrupted payout flows (e.g., escrow funding exhausted).
  let mismatches = 0;
  if (stateNum >= 3 && stateNum !== 4) { // APPROVED, CHALLENGED, or PAID
    const payoutCalldata = encodeFunctionData({
      abi: CLAIM_ESCROW_ABI,
      functionName: "getPayout",
      args: [demoClaimId],
    });

    const payoutResult = evmClient.callContract(runtime, {
      call: encodeCallMsg({
        from: config.creSignerAddress as `0x${string}`,
        to: config.claimEscrowAddress as `0x${string}`,
        data: payoutCalldata,
      }),
      blockNumber: LATEST_BLOCK_NUMBER,
    }).result();

    const payout = decodeFunctionResult({
      abi: CLAIM_ESCROW_ABI,
      functionName: "getPayout",
      data: bytesToHex(payoutResult.data),
    });

    const payoutStatusNum = Number(payout.status);
    const payoutStatusName = PAYOUT_STATUS_NAMES[payoutStatusNum] || `UNKNOWN(${payoutStatusNum})`;
    const payoutAmt = Number(payout.amount) > 0 ? `$${(Number(payout.amount) / 100).toFixed(2)}` : "$0.00";
    runtime.log(`WF-004: ClaimEscrow payout: ${payoutStatusName} — amount: ${payoutAmt} USDC`);

    // PAID state should have RELEASED payout
    if (stateNum === 6 && payoutStatusNum !== 2) {
      runtime.log(`WF-004: MISMATCH ALERT — Claim marked PAID but escrow shows ${payoutStatusName} — requires investigation`);
      mismatches = 1;
    }
    // APPROVED state should have SCHEDULED payout
    if (stateNum === 3 && payoutStatusNum === 0) {
      runtime.log(`WF-004: MISMATCH ALERT — Claim APPROVED but no payout scheduled in ClaimEscrow — possible escrow funding issue`);
      mismatches = 1;
    }
  } else {
    runtime.log(`WF-004: Claim state ${stateName} — no escrow reconciliation required`);
  }

  runtime.log(`WF-004: Reconciliation complete — SLO violations: ${stuckClaims}, state mismatches: ${mismatches} — ${stuckClaims === 0 && mismatches === 0 ? "ALL CLEAR" : "ACTION REQUIRED"}`);

  // Workflow output — serialized to CRE simulate logs and consumed by the
  // dashboard's outcome verification banner to compare expected vs actual results.
  return JSON.stringify({
    workflow: "WF-004-ReconciliationMonitor",
    claim_id: demoClaimId,
    onchain_state: stateName,
    stuck_claims: stuckClaims,
    mismatches: mismatches,
    timestamp: now,
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
      onReconciliationCheck
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
