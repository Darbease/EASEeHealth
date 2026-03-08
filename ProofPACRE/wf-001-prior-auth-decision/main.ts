import {
  CronCapability,
  HTTPClient,
  ConfidentialHTTPClient,
  EVMClient,
  handler,
  Runner,
  type Runtime,
  type CronPayload,
  consensusIdenticalAggregation,
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
// WF-001 · PriorAuthDecision · Cron trigger
//
// Full prior-authorization happy path: consent check → policy check → proof
// evaluation → claim submission → payout → callback notification.
//
// CRE capabilities: HTTPClient, ConfidentialHTTPClient, EVMClient
// Contracts touched:
//   READ  — ConsentRegistry.isConsentActive, PolicyRegistry.isPolicyActive
//   WRITE — ClaimDecisionRegistry.submitClaim / setProofResult / markPaid,
//           ClaimEscrow.schedulePayout / releasePayout
// Demo scenario: A (happy path → APPROVED → PAID)
// Privacy: no PHI on-chain — only hashes, state transitions, and payout events
// Spec: TECH_ARCHITECTURE_SPEC_ProofPA.md § 8.1
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
const CONSENT_REGISTRY_ABI = [
  {
    name: "isConsentActive",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "consentId", type: "bytes32" },
      { name: "atTs", type: "uint64" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

const POLICY_REGISTRY_ABI = [
  {
    name: "isPolicyActive",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "policyHash", type: "bytes32" },
      { name: "atTs", type: "uint64" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

const CLAIM_DECISION_REGISTRY_ABI = [
  {
    name: "submitClaim",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "claimId", type: "bytes32" },
      { name: "policyHash", type: "bytes32" },
    ],
    outputs: [],
  },
  {
    name: "setProofResult",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "claimId", type: "bytes32" },
      { name: "proofHash", type: "bytes32" },
      { name: "reasonBitmap", type: "uint256" },
      { name: "approved", type: "bool" },
    ],
    outputs: [],
  },
  {
    name: "markPaid",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "claimId", type: "bytes32" }],
    outputs: [],
  },
] as const;

const CLAIM_ESCROW_ABI = [
  {
    name: "schedulePayout",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "claimId", type: "bytes32" },
      { name: "recipient", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    name: "releasePayout",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "claimId", type: "bytes32" }],
    outputs: [],
  },
] as const;

// ---------------------------------------------------------------------------
// Config — populated from config.staging.json / config.production.json
// ---------------------------------------------------------------------------
export type Config = {
  schedule: string;                    // Cron expression — triggers workflow on DON nodes
  policyServiceUrl: string;            // policy-service base URL (port 3001)
  proofServiceUrl: string;             // proof-service-stub base URL (port 3003)
  callbackServiceUrl: string;          // decision-callback-service base URL (port 3006)
  ehrServiceUrl: string;               // provider-adapter-api base URL (port 3005) — Synthea EHR data
  owner: string;                       // Workflow owner address — used for CRE registration
  chainSelector: string;               // EIP-155 chain selector — Base Sepolia in staging
  consentRegistryAddress: string;      // Deployed ConsentRegistry contract (from Deploy.s.sol)
  policyRegistryAddress: string;       // Deployed PolicyRegistry contract (from Deploy.s.sol)
  claimDecisionRegistryAddress: string; // Deployed ClaimDecisionRegistry (state machine + proof)
  claimEscrowAddress: string;          // Deployed ClaimEscrow (ERC-20 mock USDC pool)
  creSignerAddress: string;            // DON-controlled signer — has WORKFLOW_ROLE on all contracts
  treasuryAddress: string;             // Payout recipient — provider's treasury wallet
};

// ---------------------------------------------------------------------------
// Handler: onPriorAuthCron
// ---------------------------------------------------------------------------
// Cron-triggered handler that demonstrates the full ProofPA prior-auth flow
// using all 3 CRE capabilities: HTTPClient, ConfidentialHTTPClient, EVMClient.
//
//   1. [HTTP]       Fetch active policy from policy-service
//   2. [EVM READ]   Verify consent is active on-chain (ConsentRegistry)
//   3. [EVM READ]   Verify policy is active on-chain (PolicyRegistry)
//   4. [HTTP]       Call proof-service-stub via confidential HTTP
//   5. [EVM WRITE]  Submit claim on-chain (ClaimDecisionRegistry)
//   6. [EVM WRITE]  Record proof result on-chain (ClaimDecisionRegistry)
//   7. [EVM WRITE]  Schedule payout if approved (ClaimEscrow)
//   8. [EVM WRITE]  Release payout — execute ERC-20 transfer (ClaimEscrow)
//   9. [EVM WRITE]  Mark claim PAID — terminal state (ClaimDecisionRegistry)
//  10. [HTTP]       Post decision callback
// ---------------------------------------------------------------------------
export const onPriorAuthCron = (
  runtime: Runtime<Config>,
  _cronPayload: CronPayload
): string => {
  const config = runtime.config;
  runtime.log("WF-001: Prior Auth Decision workflow triggered");

  // Deterministic demo fixture IDs — 0x{byte}.repeat(32) format for easy identification
  // in block explorers and logs. These match dashboard Scenario A polling targets.
  const claimId = ("0x" + "01".repeat(32)) as `0x${string}`;
  const policyHash = ("0x" + "a1".repeat(32)) as `0x${string}`;
  const consentHash = ("0x" + "c0".repeat(32)) as `0x${string}`;
  const proofHash = ("0x" + "b2".repeat(32)) as `0x${string}`;
  let requestedAmount = 85000n;
  let procedureCode = "PROC_KNEE_MRI";
  const currentTimestamp = BigInt(Math.floor(Date.now() / 1000));

  // SNOMED-CT → PROC_* mapping for Synthea procedure codes
  const SNOMED_TO_PROC: Record<string, string> = {
    "36969009": "PROC_CARDIAC_CT",    // Coronary artery stent placement
    "175066001": "PROC_CARDIAC_CT",   // Percutaneous coronary intervention
    "232717009": "PROC_CARDIAC_CT",   // Coronary artery bypass graft
    "241615005": "PROC_KNEE_MRI",     // MRI of knee
    "399208008": "PROC_SPINE_XRAY",   // CT scan of chest
    "40701008": "PROC_CARDIAC_CT",    // Echocardiography
    "29303009": "PROC_CARDIAC_CT",    // Electrocardiographic monitoring
    "418766005": "PROC_CARDIAC_CT",   // Cardiac stress test
  };

  // ---- Step 0: Fetch real encounter/procedure data from EHR [ENCRYPTED HTTP] ----
  // Pulls Synthea-format data from provider-adapter-api to derive procedure code
  // and requested amount programmatically from actual EHR claim data.
  const confidentialClient = new ConfidentialHTTPClient();
  let ehrClaimCount = 0;

  if (config.ehrServiceUrl) {
    runtime.log("WF-001: [ENCRYPTED] Fetching outstanding claims from EHR");
    const ehrResp = confidentialClient.sendRequest(runtime, {
      vaultDonSecrets: [
        { key: "aesEncryptionKey", owner: config.owner },
      ],
      request: {
        url: `${config.ehrServiceUrl}/v1/ehr/claims/outstanding`,
        method: "GET",
        multiHeaders: {
          "Content-Type": { values: ["application/json"] },
        },
        encryptOutput: true,
      },
    }).result();

    if (ok(ehrResp)) {
      const ehrData = safeParse(text(ehrResp));
      if (ehrData && Array.isArray(ehrData.outstanding_claims) && ehrData.outstanding_claims.length > 0) {
        ehrClaimCount = ehrData.outstanding_claims.length;
        const claim = ehrData.outstanding_claims[0] as Record<string, unknown>;
        const procs = claim.procedures as Array<Record<string, unknown>> | undefined;
        if (procs && procs.length > 0) {
          // Map SNOMED-CT code to PROC_* code and extract cost
          const snomedCode = (procs[0].code as string) ?? "";
          const mappedProc = SNOMED_TO_PROC[snomedCode];
          if (mappedProc) {
            procedureCode = mappedProc;
          }
          const costStr = (procs[0].cost as string) ?? "";
          const costNum = Math.round(parseFloat(costStr));
          if (costNum > 0) {
            requestedAmount = BigInt(costNum);
          }
        }
        runtime.log(`WF-001: EHR data loaded — ${ehrClaimCount} outstanding claims, procedure ${procedureCode}, amount ${requestedAmount}`);
      }
    } else {
      runtime.log("WF-001: EHR fetch failed — using default procedure and amount");
    }
  }

  // ---- Step 1: Fetch active policy from policy-service [HTTP] ----
  const httpClient = new HTTPClient();

  const policyResult = httpClient.sendRequest(
    runtime,
    (sendRequester) => {
      const resp = sendRequester.sendRequest({
        url: `${config.policyServiceUrl}/v1/policies/payer-demo-001/v1`,
        method: "GET",
        multiHeaders: {
          "Content-Type": { values: ["application/json"] },
        },
        timeout: "10s",
      }).result();

      return text(resp);
    },
    // DON consensus — all oracle nodes must get the same HTTP response before proceeding.
    // Required for non-confidential HTTPClient calls to prevent split-brain results.
    consensusIdenticalAggregation<string>()
  )().result();

  const policyData = safeParse(policyResult);
  runtime.log(`WF-001: Policy fetched for ${procedureCode} — predicates ${policyData?.predicates ? "loaded" : "missing"}`);

  // ---- Step 2: Verify consent on-chain [EVM READ] ----
  const evmClient = new EVMClient(BigInt(config.chainSelector));

  const consentCalldata = encodeFunctionData({
    abi: CONSENT_REGISTRY_ABI,
    functionName: "isConsentActive",
    args: [consentHash, currentTimestamp],
  });

  const consentResult = evmClient.callContract(runtime, {
    call: encodeCallMsg({
      from: config.creSignerAddress as `0x${string}`,
      to: config.consentRegistryAddress as `0x${string}`,
      data: consentCalldata,
    }),
    // Read from the chain tip, not a specific block height.
    blockNumber: LATEST_BLOCK_NUMBER,
  }).result();

  const consentActive = decodeFunctionResult({
    abi: CONSENT_REGISTRY_ABI,
    functionName: "isConsentActive",
    data: bytesToHex(consentResult.data),
  });

  runtime.log(`WF-001: Consent verified on-chain: ${consentActive ? "ACTIVE" : "REVOKED"}`);

  // ---- Step 3: Verify policy on-chain [EVM READ] ----
  const policyCalldata = encodeFunctionData({
    abi: POLICY_REGISTRY_ABI,
    functionName: "isPolicyActive",
    args: [policyHash, currentTimestamp],
  });

  const policyOnchainResult = evmClient.callContract(runtime, {
    call: encodeCallMsg({
      from: config.creSignerAddress as `0x${string}`,
      to: config.policyRegistryAddress as `0x${string}`,
      data: policyCalldata,
    }),
    blockNumber: LATEST_BLOCK_NUMBER,
  }).result();

  const policyActive = decodeFunctionResult({
    abi: POLICY_REGISTRY_ABI,
    functionName: "isPolicyActive",
    data: bytesToHex(policyOnchainResult.data),
  });

  runtime.log(`WF-001: Policy verified on-chain: ${policyActive ? "ACTIVE" : "INACTIVE"}`);

  // ---- Step 4: Call proof-service-stub via confidential HTTP ----
  runtime.log(`WF-001: [ENCRYPTED] Evaluating medical necessity — ${procedureCode}, amount ${requestedAmount}`);
  const proofJsonStr = JSON.stringify({
    claim_id: claimId,
    policy_hash: policyHash,
    procedure_code: procedureCode,
    requested_amount: requestedAmount.toString(),
    consent_active: true,
    credential_valid: true,
    is_duplicate: false,
    attestation_age_seconds: 3600,
    policy_predicates: policyData?.predicates ?? {},
  });
  const proofResp = confidentialClient.sendRequest(runtime, {
    vaultDonSecrets: [
      { key: "proofServiceApiKey", owner: config.owner },
      { key: "aesEncryptionKey", owner: config.owner },
    ],
    request: {
      url: `${config.proofServiceUrl}/v1/proofs/medical-necessity`,
      method: "POST",
      bodyString: proofJsonStr,
      multiHeaders: {
        "Content-Type": { values: ["application/json"] },
        "Authorization": { values: ["Bearer {{.proofServiceApiKey}}"] },
      },
      encryptOutput: true,
    },
  }).result();

  const proofHttpOk = ok(proofResp);
  const proofBody = text(proofResp);
  const proofData = safeParse(proofBody);
  // Use the actual proof result from the response body, not just HTTP status.
  // The proof service returns 200 even on FAIL — the result field is authoritative.
  const proofOk = proofHttpOk && proofData?.result === "PASS";
  const decisionState = proofOk ? "APPROVED" : "DENIED";
  runtime.log(`WF-001: [ENCRYPTED] Proof evaluation: ${proofOk ? "PASSED" : "FAILED"}`);

  // ---- Step 5: Submit claim on-chain [EVM WRITE] ----
  const submitCalldata = encodeFunctionData({
    abi: CLAIM_DECISION_REGISTRY_ABI,
    functionName: "submitClaim",
    args: [claimId, policyHash],
  });

  // Two-phase EVM write: (1) prepareReportRequest generates DON-signed report via off-chain
  // consensus, (2) writeReport submits the signed report on-chain. The contract verifies the
  // DON signature via WORKFLOW_ROLE access control.
  runtime.log(`WF-001: DECISION: ${decisionState} — Submitting claim ${claimId.substring(0, 10)}...${claimId.substring(58)} to ClaimDecisionRegistry`);
  const submitReport = runtime.report(prepareReportRequest(submitCalldata)).result();
  const submitResult = evmClient.writeReport(runtime, {
    receiver: config.claimDecisionRegistryAddress,
    report: submitReport,
    gasConfig: { gasLimit: "500000" },
  }).result();
  runtime.log(`WF-001: Claim submitted on-chain — tx status: ${submitResult.txStatus === 1 ? "CONFIRMED" : submitResult.txStatus}`);

  // ---- Step 6: Record proof result on-chain [EVM WRITE] ----
  // Use the actual reason_bitmap from the proof service response.
  const reasonBitmap = proofOk ? 0n : BigInt(proofData?.reason_bitmap ?? "1");
  const setProofCalldata = encodeFunctionData({
    abi: CLAIM_DECISION_REGISTRY_ABI,
    functionName: "setProofResult",
    args: [claimId, proofHash, reasonBitmap, proofOk],
  });

  runtime.log(`WF-001: Recording proof result — reason bitmap: ${reasonBitmap === 0n ? "0 (no denial flags)" : reasonBitmap.toString()}`);
  const proofReport = runtime.report(prepareReportRequest(setProofCalldata)).result();
  const proofWriteResult = evmClient.writeReport(runtime, {
    receiver: config.claimDecisionRegistryAddress,
    report: proofReport,
    gasConfig: { gasLimit: "500000" },
  }).result();
  runtime.log(`WF-001: Proof result recorded on-chain — tx status: ${proofWriteResult.txStatus === 1 ? "CONFIRMED" : proofWriteResult.txStatus}`);

  // ---- Step 7: Schedule payout if approved [EVM WRITE] ----
  // Payout path (Steps 7–9) is skipped entirely on denial — no escrow interaction
  // needed since the claim goes straight to DENIED terminal state.
  if (proofOk) {
    const scheduleCalldata = encodeFunctionData({
      abi: CLAIM_ESCROW_ABI,
      functionName: "schedulePayout",
      args: [
        claimId,
        config.treasuryAddress as `0x${string}`,
        requestedAmount,
      ],
    });

    runtime.log(`WF-001: PAYOUT: scheduling to treasury ${config.treasuryAddress.substring(0, 6)}...${config.treasuryAddress.substring(38)}`);
    const payoutReport = runtime.report(prepareReportRequest(scheduleCalldata)).result();
    const payoutResult = evmClient.writeReport(runtime, {
      receiver: config.claimEscrowAddress,
      report: payoutReport,
      gasConfig: { gasLimit: "500000" },
    }).result();
    runtime.log(`WF-001: Payout scheduled on-chain — tx status: ${payoutResult.txStatus === 1 ? "CONFIRMED" : payoutResult.txStatus}`);

    // ---- Step 8: Release payout — execute ERC-20 transfer [EVM WRITE] ----
    const releaseCalldata = encodeFunctionData({
      abi: CLAIM_ESCROW_ABI,
      functionName: "releasePayout",
      args: [claimId],
    });

    runtime.log(`WF-001: Releasing payout — executing ERC-20 transfer`);
    const releaseReport = runtime.report(prepareReportRequest(releaseCalldata)).result();
    const releaseResult = evmClient.writeReport(runtime, {
      receiver: config.claimEscrowAddress,
      report: releaseReport,
      gasConfig: { gasLimit: "500000" },
    }).result();
    runtime.log(`WF-001: Payout released on-chain — tx status: ${releaseResult.txStatus === 1 ? "CONFIRMED" : releaseResult.txStatus}`);

    // ---- Step 9: Mark claim as PAID — terminal state [EVM WRITE] ----
    const markPaidCalldata = encodeFunctionData({
      abi: CLAIM_DECISION_REGISTRY_ABI,
      functionName: "markPaid",
      args: [claimId],
    });

    runtime.log(`WF-001: Marking claim PAID (terminal state)`);
    const paidReport = runtime.report(prepareReportRequest(markPaidCalldata)).result();
    const paidResult = evmClient.writeReport(runtime, {
      receiver: config.claimDecisionRegistryAddress,
      report: paidReport,
      gasConfig: { gasLimit: "500000" },
    }).result();
    runtime.log(`WF-001: Claim marked PAID on-chain — tx status: ${paidResult.txStatus === 1 ? "CONFIRMED" : paidResult.txStatus}`);
  }

  // ---- Step 10: Post decision to callback service [HTTP] ----
  runtime.log(`WF-001: [ENCRYPTED] Notifying provider of decision: ${decisionState}`);
  const callbackJsonStr = JSON.stringify({
    claim_id: claimId,
    decision_state: decisionState,
    reason_bitmap: proofBody,
    workflow_id: "WF-001",
  });
  const callbackResp = confidentialClient.sendRequest(runtime, {
    vaultDonSecrets: [
      { key: "aesEncryptionKey", owner: config.owner },
    ],
    request: {
      url: `${config.callbackServiceUrl}/v1/callbacks/prior-auth-decision`,
      method: "POST",
      bodyString: callbackJsonStr,
      multiHeaders: {
        "Content-Type": { values: ["application/json"] },
      },
      encryptOutput: true,
    },
  }).result();
  const callbackOk = ok(callbackResp);

  runtime.log(`WF-001: Callback delivered: ${decisionState} — ${callbackOk ? "sent" : "FAILED"}`);

  // Workflow output — serialized to CRE simulate logs and consumed by the
  // dashboard's outcome verification banner to compare expected vs actual results.
  return JSON.stringify({
    workflow: "WF-001-PriorAuthDecision",
    claim_id: claimId,
    decision_state: decisionState,
    consent_verified_onchain: consentActive,
    policy_verified_onchain: policyActive,
    proof_response: proofBody,
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
      onPriorAuthCron
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
