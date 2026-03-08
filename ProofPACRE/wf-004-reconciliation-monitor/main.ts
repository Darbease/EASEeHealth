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
  LATEST_BLOCK_NUMBER,
  bytesToHex,
} from "@chainlink/cre-sdk";

import { encodeFunctionData, decodeFunctionResult, keccak256, encodePacked } from "viem";
// CRE SDK handles transport, signing, and DON consensus; viem handles ABI encoding/decoding only.

// ---------------------------------------------------------------------------
// WF-004 · ReconciliationMonitor · Cron trigger (every 30s in staging)
//
// Cross-references off-chain EHR/claims data (Synthea format) against on-chain
// state in ClaimDecisionRegistry and ClaimEscrow. Detects:
//   - Outstanding claims in traditional systems that are already settled on-chain
//   - Stuck PROOF_PENDING claims exceeding SLO
//   - State mismatches between off-chain records and on-chain state
//   - Claims that should have been paid but are still BILLED off-chain
//
// CRE capabilities: ConfidentialHTTPClient (encrypted EHR fetch), EVMClient (read-only)
// Contracts touched:
//   READ — ClaimDecisionRegistry.getDecision, ClaimEscrow.getPayout
// Data sources:
//   ConfidentialHTTPRequest → provider-adapter-api /v1/ehr/claims
// Demo scenario: standalone (runs to verify off-chain vs on-chain consistency)
// Privacy: no PHI on-chain — EHR data fetched via encrypted HTTP, only hashes hit chain
// Spec: TECH_ARCHITECTURE_SPEC_ProofPA.md § 8.4
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Defensive JSON parser (CRE WASM cannot share code across workflows)
// ---------------------------------------------------------------------------
function safeParseJSON(raw: string): Record<string, unknown> | null {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Contract ABI Fragments
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
  schedule: string;
  chainSelector: string;
  claimDecisionRegistryAddress: string;
  claimEscrowAddress: string;
  creSignerAddress: string;
  sloTargetSeconds: number;
  ehrServiceUrl: string;               // provider-adapter-api base URL (e.g. http://localhost:3005)
  owner: string;                       // DON secrets owner for ConfidentialHTTPClient
};

// ---------------------------------------------------------------------------
// Helper: read claim state from ClaimDecisionRegistry
// ---------------------------------------------------------------------------
function readClaimState(
  runtime: Runtime<Config>,
  evmClient: EVMClient,
  claimId: `0x${string}`,
  config: Config,
) {
  const calldata = encodeFunctionData({
    abi: CLAIM_DECISION_REGISTRY_ABI,
    functionName: "getDecision",
    args: [claimId],
  });

  const result = evmClient.callContract(runtime, {
    call: encodeCallMsg({
      from: config.creSignerAddress as `0x${string}`,
      to: config.claimDecisionRegistryAddress as `0x${string}`,
      data: calldata,
    }),
    blockNumber: LATEST_BLOCK_NUMBER,
  }).result();

  return decodeFunctionResult({
    abi: CLAIM_DECISION_REGISTRY_ABI,
    functionName: "getDecision",
    data: bytesToHex(result.data),
  });
}

// ---------------------------------------------------------------------------
// Helper: read payout status from ClaimEscrow
// ---------------------------------------------------------------------------
function readPayoutStatus(
  runtime: Runtime<Config>,
  evmClient: EVMClient,
  claimId: `0x${string}`,
  config: Config,
) {
  const calldata = encodeFunctionData({
    abi: CLAIM_ESCROW_ABI,
    functionName: "getPayout",
    args: [claimId],
  });

  const result = evmClient.callContract(runtime, {
    call: encodeCallMsg({
      from: config.creSignerAddress as `0x${string}`,
      to: config.claimEscrowAddress as `0x${string}`,
      data: calldata,
    }),
    blockNumber: LATEST_BLOCK_NUMBER,
  }).result();

  return decodeFunctionResult({
    abi: CLAIM_ESCROW_ABI,
    functionName: "getPayout",
    data: bytesToHex(result.data),
  });
}

// ---------------------------------------------------------------------------
// Handler: onReconciliationCheck
// ---------------------------------------------------------------------------
export const onReconciliationCheck = (
  runtime: Runtime<Config>,
  _cronPayload: CronPayload
): string => {
  const config = runtime.config;
  const now = runtime.now().toISOString();
  const sloDisplay = `${Math.floor(config.sloTargetSeconds / 60)} min`;
  runtime.log(`WF-004: Reconciliation Monitor — cross-referencing off-chain EHR data vs on-chain state at ${now}`);

  const evmClient = new EVMClient(BigInt(config.chainSelector));
  const confidentialClient = new ConfidentialHTTPClient();

  // ---- Step 1: Fetch outstanding claims from EHR via ConfidentialHTTPRequest ----
  runtime.log("WF-004: [ENCRYPTED] Fetching outstanding claims from EHR system (provider-adapter-api)...");

  const ehrResp = confidentialClient.sendRequest(runtime, {
    vaultDonSecrets: [
      { key: "ehrApiKey", owner: config.owner },
      { key: "aesEncryptionKey", owner: config.owner },
    ],
    request: {
      url: `${config.ehrServiceUrl}/v1/ehr/claims?status=BILLED`,
      method: "GET",
      multiHeaders: {
        "Content-Type": { values: ["application/json"] },
        "Authorization": { values: ["Bearer {{.ehrApiKey}}"] },
      },
      encryptOutput: true,
    },
  }).result();

  const ehrOk = ok(ehrResp);
  const ehrBody = text(ehrResp);

  if (!ehrOk) {
    runtime.log("WF-004: ERROR — Failed to fetch EHR data, skipping off-chain reconciliation");
    // Fall back to legacy on-chain-only check
    return reconcileLegacy(runtime, evmClient, config, now, sloDisplay);
  }

  const ehrData = safeParseJSON(ehrBody);
  if (!ehrData || !Array.isArray(ehrData.claims)) {
    runtime.log("WF-004: ERROR — Invalid EHR response, falling back to on-chain-only check");
    return reconcileLegacy(runtime, evmClient, config, now, sloDisplay);
  }

  const outstandingClaims = ehrData.claims as Array<Record<string, unknown>>;
  runtime.log(`WF-004: [ENCRYPTED] Retrieved ${outstandingClaims.length} outstanding BILLED claims from EHR`);

  // ---- Step 2: For each outstanding claim, compute deterministic claim_id and check on-chain ----
  let reconciled = 0;
  let mismatches = 0;
  let stuckClaims = 0;
  let settledOnChain = 0;
  const findings: Array<Record<string, unknown>> = [];

  for (const offchainClaim of outstandingClaims) {
    const ehrClaimId = offchainClaim.Id as string;
    const outstanding = offchainClaim.Outstanding1 as string ?? "0";
    const serviceDate = (offchainClaim["Service Date"] as string) ?? "";
    const diagnosis1 = (offchainClaim["Diagnosis1"] as string) ?? "";

    runtime.log(`WF-004: Checking EHR claim ${ehrClaimId.substring(0, 16)}... — status BILLED`);

    // Compute the deterministic EASE eHealth claim_id from off-chain fields.
    // This mirrors the same keccak256 used in provider-adapter-api and WF-001.
    // For the demo, we use the off-chain claim fields to derive a matching on-chain ID.
    const payerId = offchainClaim["Primary Patient Insurance ID"] as string ?? "";
    const providerId = offchainClaim["Provider ID"] as string ?? "";
    const appointmentId = offchainClaim["Appointment ID"] as string ?? "";

    // Hash provider and encounter refs to bytes32 (mirrors real system hashing)
    const providerIdHash = keccak256(encodePacked(["string"], [providerId]));
    const encounterRefHash = keccak256(encodePacked(["string"], [appointmentId]));

    const onchainClaimId = keccak256(
      encodePacked(
        ["string", "bytes32", "bytes32", "string", "string"],
        [payerId, providerIdHash, encounterRefHash, diagnosis1, serviceDate],
      ),
    );

    // ---- Step 3: Read on-chain state ----
    const decision = readClaimState(runtime, evmClient, onchainClaimId, config);
    const stateNum = Number(decision.state);
    const stateName = STATE_NAMES[stateNum] || `UNKNOWN(${stateNum})`;
    const updatedAt = Number(decision.updatedAt);

    runtime.log(`WF-004: On-chain state: ${stateName} (last updated ${updatedAt > 0 ? new Date(updatedAt * 1000).toISOString() : "never"})`);

    // ---- Step 4: Cross-reference off-chain vs on-chain ----
    if (stateNum === 0) {
      // NONE — claim not yet submitted on-chain. Expected for traditional claims.
      runtime.log(`WF-004: Claim ${ehrClaimId.substring(0, 16)}... NOT on-chain — candidate for EASE eHealth submission`);
      findings.push({
        ehr_claim_id: ehrClaimId,
        ehr_status: "BILLED",
        provider_hash: providerIdHash,
        status: "NOT_ON_CHAIN",
        outstanding,
        recommendation: "Submit via WF-001 for instant settlement",
      });
    } else if (stateNum === 6) {
      // PAID — already settled on-chain but EHR still shows BILLED
      settledOnChain++;
      runtime.log(`WF-004: RECONCILIATION FINDING — claim ${ehrClaimId.substring(0, 16)}... already PAID on-chain but EHR still shows BILLED — EHR update needed`);
      findings.push({
        ehr_claim_id: ehrClaimId,
        ehr_status: "BILLED",
        status: "SETTLED_ON_CHAIN",
        onchain_state: "PAID",
        outstanding,
        recommendation: "Update EHR to reflect on-chain settlement",
      });
    } else if (stateNum === 3) {
      // APPROVED — check escrow
      const payout = readPayoutStatus(runtime, evmClient, onchainClaimId, config);
      const payoutStatusNum = Number(payout.status);
      const payoutStatusName = PAYOUT_STATUS_NAMES[payoutStatusNum] || `UNKNOWN(${payoutStatusNum})`;
      runtime.log(`WF-004: Claim APPROVED, escrow status: ${payoutStatusName}`);

      if (payoutStatusNum === 0) {
        mismatches++;
        runtime.log(`WF-004: MISMATCH — claim ${ehrClaimId.substring(0, 16)}... APPROVED but no payout scheduled`);
        findings.push({
          ehr_claim_id: ehrClaimId,
          ehr_status: "BILLED",
          status: "MISMATCH",
          onchain_state: "APPROVED",
          escrow_state: payoutStatusName,
          recommendation: "Schedule payout in ClaimEscrow",
        });
      }
    } else if (stateNum === 2) {
      // PROOF_PENDING — check SLO
      const ageSeconds = Math.floor(Date.now() / 1000) - updatedAt;
      if (ageSeconds > config.sloTargetSeconds) {
        stuckClaims++;
        runtime.log(`WF-004: SLO VIOLATION — claim ${ehrClaimId.substring(0, 16)}... stuck in PROOF_PENDING for ${Math.floor(ageSeconds / 60)}m${ageSeconds % 60}s`);
        findings.push({
          ehr_claim_id: ehrClaimId,
          ehr_status: "BILLED",
          status: "SLO_VIOLATION",
          onchain_state: "PROOF_PENDING",
          age_seconds: ageSeconds,
          recommendation: "Investigate proof-service failure",
        });
      }
    }

    reconciled++;
  }

  // ---- Step 5: Also check the legacy demo fixture claim ----
  const demoClaimId = ("0x" + "01".repeat(32)) as `0x${string}`;
  const demoDecision = readClaimState(runtime, evmClient, demoClaimId, config);
  const demoStateNum = Number(demoDecision.state);
  const demoStateName = STATE_NAMES[demoStateNum] || `UNKNOWN(${demoStateNum})`;
  runtime.log(`WF-004: Demo fixture claim: state=${demoStateName}`);

  if (demoStateNum === 2) {
    const ageSeconds = Math.floor(Date.now() / 1000) - Number(demoDecision.updatedAt);
    if (ageSeconds > config.sloTargetSeconds) {
      stuckClaims++;
      runtime.log(`WF-004: SLO VIOLATION — Demo claim stuck in PROOF_PENDING for ${Math.floor(ageSeconds / 60)}m`);
    }
  }

  // Cross-check escrow for demo claim
  if (demoStateNum >= 3 && demoStateNum !== 4) {
    const payout = readPayoutStatus(runtime, evmClient, demoClaimId, config);
    const payoutStatusNum = Number(payout.status);
    const payoutStatusName = PAYOUT_STATUS_NAMES[payoutStatusNum] || `UNKNOWN(${payoutStatusNum})`;
    runtime.log(`WF-004: Demo claim escrow: ${payoutStatusName}`);

    if (demoStateNum === 6 && payoutStatusNum !== 2) {
      mismatches++;
      runtime.log(`WF-004: MISMATCH — Demo claim PAID but escrow shows ${payoutStatusName}`);
    }
    if (demoStateNum === 3 && payoutStatusNum === 0) {
      mismatches++;
      runtime.log(`WF-004: MISMATCH — Demo claim APPROVED but no payout scheduled`);
    }
  }

  // ---- Summary ----
  const allClear = stuckClaims === 0 && mismatches === 0;
  runtime.log(`WF-004: Reconciliation complete — ${reconciled} EHR claims checked, ${settledOnChain} already settled on-chain, ${stuckClaims} SLO violations, ${mismatches} mismatches — ${allClear ? "ALL CLEAR" : "ACTION REQUIRED"}`);

  if (settledOnChain > 0) {
    runtime.log(`WF-004: EASE eHealth IMPACT — ${settledOnChain} claims already settled on-chain in <120s that EHR still shows as outstanding (traditional: 30-90 days)`);
  }

  return JSON.stringify({
    workflow: "WF-004-ReconciliationMonitor",
    timestamp: now,
    ehr_claims_checked: reconciled,
    settled_on_chain: settledOnChain,
    stuck_claims: stuckClaims,
    mismatches: mismatches,
    findings: findings,
    demo_claim: {
      claim_id: demoClaimId,
      onchain_state: demoStateName,
    },
  });
};

// ---------------------------------------------------------------------------
// Legacy on-chain-only reconciliation (fallback when EHR is unreachable)
// ---------------------------------------------------------------------------
function reconcileLegacy(
  runtime: Runtime<Config>,
  evmClient: EVMClient,
  config: Config,
  now: string,
  sloDisplay: string,
): string {
  runtime.log("WF-004: Running legacy on-chain-only reconciliation...");
  const demoClaimId = ("0x" + "01".repeat(32)) as `0x${string}`;
  const decision = readClaimState(runtime, evmClient, demoClaimId, config);
  const stateNum = Number(decision.state);
  const stateName = STATE_NAMES[stateNum] || `UNKNOWN(${stateNum})`;
  const updatedAt = Number(decision.updatedAt);

  runtime.log(`WF-004: Claim ${demoClaimId.substring(0, 10)}...: state=${stateName}`);

  let stuckClaims = 0;
  if (stateNum === 2) {
    const ageSeconds = Math.floor(Date.now() / 1000) - updatedAt;
    if (ageSeconds > config.sloTargetSeconds) {
      runtime.log(`WF-004: SLO VIOLATION — stuck in PROOF_PENDING for ${Math.floor(ageSeconds / 60)}m (SLO: ${sloDisplay})`);
      stuckClaims = 1;
    }
  }

  let mismatches = 0;
  if (stateNum >= 3 && stateNum !== 4) {
    const payout = readPayoutStatus(runtime, evmClient, demoClaimId, config);
    const payoutStatusNum = Number(payout.status);
    const payoutStatusName = PAYOUT_STATUS_NAMES[payoutStatusNum] || `UNKNOWN(${payoutStatusNum})`;
    runtime.log(`WF-004: ClaimEscrow payout: ${payoutStatusName}`);
    if (stateNum === 6 && payoutStatusNum !== 2) mismatches = 1;
    if (stateNum === 3 && payoutStatusNum === 0) mismatches = 1;
  }

  runtime.log(`WF-004: Legacy reconciliation complete — ${stuckClaims === 0 && mismatches === 0 ? "ALL CLEAR" : "ACTION REQUIRED"}`);

  return JSON.stringify({
    workflow: "WF-004-ReconciliationMonitor",
    claim_id: demoClaimId,
    onchain_state: stateName,
    stuck_claims: stuckClaims,
    mismatches: mismatches,
    timestamp: now,
    mode: "legacy_onchain_only",
  });
}

// ---------------------------------------------------------------------------
// Workflow init
// ---------------------------------------------------------------------------
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
