import {
  HTTPClient,
  ConfidentialHTTPClient,
  EVMClient,
  handler,
  Runner,
  type Runtime,
  type EVMLog,
  consensusIdenticalAggregation,
  ok,
  text,
  encodeCallMsg,
  prepareReportRequest,
  LATEST_BLOCK_NUMBER,
  bytesToHex,
} from "@chainlink/cre-sdk";

import { encodeFunctionData, decodeFunctionResult, decodeAbiParameters } from "viem";

// ---------------------------------------------------------------------------
// WF-007 · ClaimTransferSettlement · Log trigger (event-driven)
//
// First event-driven CRE workflow: fires when ClaimSubmitted(bytes32 indexed
// claimId, bytes32 policyHash) is emitted on-chain. Settles high-value
// TRANSFERIN claims (e.g. inter-department transfers pending authorization).
//
// CRE capabilities: ConfidentialHTTPClient, EVMClient
// Trigger: EVMClient.logTrigger() — reacts to ClaimSubmitted events
// Contracts touched:
//   READ  — ConsentRegistry.isConsentActive, PolicyRegistry.isPolicyActive
//   WRITE — ClaimDecisionRegistry.setProofResult / markPaid (NO submitClaim),
//           ClaimEscrow.schedulePayout / releasePayout
// Demo scenario: E (Maria Garcia — $38K coronary stent TRANSFERIN → payer $32.3K → PAID)
// Privacy: no PHI on-chain — only hashes, state transitions, and payout events
// Spec: TECH_ARCHITECTURE_SPEC_ProofPA.md § 8.7
// ---------------------------------------------------------------------------

function safeParse(raw: string): Record<string, any> | null {
  try { return JSON.parse(raw); } catch { return null; }
}

// ---------------------------------------------------------------------------
// Hex → Base64 helper for FilterLogTriggerRequestJson
// CRE protobuf JSON uses base64-encoded bytes, not hex.
// ---------------------------------------------------------------------------
function hexToBase64(hex: string): string {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.substring(i * 2, i * 2 + 2), 16);
  }
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let result = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    result += chars[b0 >> 2];
    result += chars[((b0 & 3) << 4) | (b1 >> 4)];
    result += i + 1 < bytes.length ? chars[((b1 & 15) << 2) | (b2 >> 6)] : "=";
    result += i + 2 < bytes.length ? chars[b2 & 63] : "=";
  }
  return result;
}

// ---------------------------------------------------------------------------
// ClaimSubmitted event topic0 = keccak256("ClaimSubmitted(bytes32,bytes32)")
// ---------------------------------------------------------------------------
const CLAIM_SUBMITTED_TOPIC = "0x4655773214d69732a8c6708c632565c6e71fc8ec47f1425534c2eda8e689f303";

// ---------------------------------------------------------------------------
// SNOMED-CT → PROC_* mapping (subset for transfer procedures)
// ---------------------------------------------------------------------------
const SNOMED_TO_PROC: Record<string, string> = {
  "36969009": "PROC_CARDIAC_CT",    // Coronary artery stent placement
  "175066001": "PROC_CARDIAC_CT",   // Percutaneous coronary intervention
  "232717009": "PROC_CARDIAC_CT",   // Coronary artery bypass graft
  "241615005": "PROC_KNEE_MRI",     // MRI of knee
};

// ---------------------------------------------------------------------------
// Contract ABI Fragments (duplicated per CRE WASM isolation)
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
// No `schedule` field — this workflow uses EVMClient.logTrigger(), not CronCapability.
// ---------------------------------------------------------------------------
export type Config = {
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
// Handler: onClaimTransferLog
// ---------------------------------------------------------------------------
// Log-triggered handler that reacts to ClaimSubmitted events and settles
// TRANSFERIN claims. Unlike WF-001, this workflow does NOT call submitClaim
// (the claim is already SUBMITTED — that's what triggered us).
//
//  0. [DECODE LOG]     Extract claimId from topics[1], policyHash from data
//  1. [ENCRYPTED HTTP] Fetch pending TRANSFERIN data from EHR
//  2. [EVM READ]       Verify consent on-chain (ConsentRegistry)
//  3. [EVM READ]       Verify policy on-chain (PolicyRegistry) — policyHash from log
//  4. [ENCRYPTED HTTP] Call proof-service-stub for medical necessity
//  5. [EVM WRITE]      setProofResult (skip submitClaim — already SUBMITTED)
//  6. [EVM WRITE]      schedulePayout if approved
//  7. [EVM WRITE]      releasePayout + markPaid if approved
//  8. [ENCRYPTED HTTP] Post decision callback
// ---------------------------------------------------------------------------
export const onClaimTransferLog = (
  runtime: Runtime<Config>,
  log: EVMLog
): string => {
  const config = runtime.config;
  runtime.log("WF-007: Claim Transfer Settlement — log trigger fired");

  // Deterministic demo fixture IDs
  const consentHash = ("0x" + "c0".repeat(32)) as `0x${string}`;
  const proofHash = ("0x" + "d7".repeat(32)) as `0x${string}`;
  const currentTimestamp = BigInt(Math.floor(Date.now() / 1000));

  // ---- Step 0: Decode log event ----
  // ClaimSubmitted(bytes32 indexed claimId, bytes32 policyHash)
  // claimId is indexed → topics[1]; policyHash is non-indexed → data
  const claimId = bytesToHex(log.topics[1]) as `0x${string}`;
  const [policyHash] = decodeAbiParameters(
    [{ name: "policyHash", type: "bytes32" }],
    bytesToHex(log.data) as `0x${string}`
  );

  runtime.log(`WF-007: Decoded log — claimId: ${claimId.substring(0, 10)}...${claimId.substring(58)}, policyHash: ${(policyHash as string).substring(0, 10)}...`);

  // Defaults for demo (Maria Garcia — $38K coronary stent TRANSFERIN)
  let procedureCode = "PROC_CARDIAC_CT";
  let payerCoverageAmt = 3230000n; // $32,300.00 in cents
  let transferAmount = 3800000; // $38,000.00 in cents

  // ---- Step 1: Fetch pending TRANSFERIN data [ENCRYPTED HTTP] ----
  const confidentialClient = new ConfidentialHTTPClient();

  runtime.log("WF-007: [ENCRYPTED] Fetching pending transfer claims from EHR");
  const ehrResp = confidentialClient.sendRequest(runtime, {
    vaultDonSecrets: [
      { key: "aesEncryptionKey", owner: config.owner },
    ],
    request: {
      url: `${config.ehrServiceUrl}/v1/ehr/claims/transfers/pending`,
      method: "GET",
      multiHeaders: {
        "Content-Type": { values: ["application/json"] },
      },
      encryptOutput: true,
    },
  }).result();

  if (ok(ehrResp)) {
    const ehrData = safeParse(text(ehrResp));
    if (ehrData && Array.isArray(ehrData.pending_transfers) && ehrData.pending_transfers.length > 0) {
      const transfer = ehrData.pending_transfers[0] as Record<string, unknown>;
      const snomedCode = (transfer.procedure_code as string) ?? "";
      const mappedProc = SNOMED_TO_PROC[snomedCode];
      if (mappedProc) {
        procedureCode = mappedProc;
      }
      const amt = parseFloat((transfer.amount as string) ?? "0");
      if (amt > 0) {
        transferAmount = Math.round(amt * 100);
      }
      const payerCov = parseFloat((transfer.payer_coverage as string) ?? "0");
      if (payerCov > 0) {
        payerCoverageAmt = BigInt(Math.round(payerCov * 100));
      }
      runtime.log(`WF-007: EHR data loaded — ${ehrData.pending_transfers.length} pending transfers, procedure ${procedureCode}, payer coverage ${payerCoverageAmt}`);
    }
  } else {
    runtime.log("WF-007: EHR fetch failed — using default transfer data");
  }

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
    blockNumber: LATEST_BLOCK_NUMBER,
  }).result();

  const consentActive = decodeFunctionResult({
    abi: CONSENT_REGISTRY_ABI,
    functionName: "isConsentActive",
    data: bytesToHex(consentResult.data),
  });

  runtime.log(`WF-007: Consent verified on-chain: ${consentActive ? "ACTIVE" : "REVOKED"}`);

  // ---- Step 3: Verify policy on-chain [EVM READ] ----
  // Uses policyHash decoded from the log event, not a fixture
  const policyCalldata = encodeFunctionData({
    abi: POLICY_REGISTRY_ABI,
    functionName: "isPolicyActive",
    args: [policyHash as `0x${string}`, currentTimestamp],
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

  runtime.log(`WF-007: Policy verified on-chain: ${policyActive ? "ACTIVE" : "INACTIVE"}`);

  // ---- Step 3b: Fetch policy predicates from policy-service [HTTP] ----
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
    consensusIdenticalAggregation<string>()
  )().result();

  const policyData = safeParse(policyResult);
  runtime.log(`WF-007: Policy predicates fetched — ${policyData?.predicates?.covered_procedures?.length ?? 0} covered procedures`);

  // ---- Step 4: Call proof-service-stub [ENCRYPTED HTTP] ----
  // requested_amount = "0" → skip procedure cap check; payout uses payer_coverage
  runtime.log(`WF-007: [ENCRYPTED] Evaluating medical necessity — ${procedureCode}, transfer amount ${transferAmount}`);
  const proofJsonStr = JSON.stringify({
    claim_id: claimId,
    policy_hash: policyHash,
    procedure_code: procedureCode,
    requested_amount: "0",
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
  runtime.log(`WF-007: [ENCRYPTED] Proof evaluation: ${proofOk ? "PASSED" : "FAILED"}`);

  // ---- Step 5: Record proof result on-chain [EVM WRITE] ----
  // No submitClaim — the claim is already SUBMITTED (that's what triggered this workflow)
  const reasonBitmap = proofOk ? 0n : BigInt(proofData?.reason_bitmap ?? "1");
  // Provenance: write the attester's signed response digest (proof_hash) on-chain,
  // not the demo fixture. Falls back to the fixture only if the service omits it.
  const attestedProofHash = (proofData?.proof_hash as `0x${string}` | undefined) ?? proofHash;
  const setProofCalldata = encodeFunctionData({
    abi: CLAIM_DECISION_REGISTRY_ABI,
    functionName: "setProofResult",
    args: [claimId, attestedProofHash, reasonBitmap, proofOk],
  });

  runtime.log(`WF-007: DECISION: ${decisionState} — Recording proof for claim ${claimId.substring(0, 10)}...${claimId.substring(58)}`);
  const proofReport = runtime.report(prepareReportRequest(setProofCalldata)).result();
  const proofWriteResult = evmClient.writeReport(runtime, {
    receiver: config.claimDecisionRegistryAddress,
    report: proofReport,
    gasConfig: { gasLimit: "500000" },
  }).result();
  runtime.log(`WF-007: Proof result recorded on-chain — tx status: ${proofWriteResult.txStatus === 1 ? "CONFIRMED" : proofWriteResult.txStatus}`);

  // ---- Steps 6-7: Payout path (only if approved) ----
  if (proofOk) {
    // Step 6: Schedule payout with payer coverage amount
    const scheduleCalldata = encodeFunctionData({
      abi: CLAIM_ESCROW_ABI,
      functionName: "schedulePayout",
      args: [
        claimId,
        config.treasuryAddress as `0x${string}`,
        payerCoverageAmt,
      ],
    });

    runtime.log(`WF-007: PAYOUT: scheduling ${payerCoverageAmt} minor units (payer coverage) to treasury`);
    const payoutReport = runtime.report(prepareReportRequest(scheduleCalldata)).result();
    const payoutResult = evmClient.writeReport(runtime, {
      receiver: config.claimEscrowAddress,
      report: payoutReport,
      gasConfig: { gasLimit: "500000" },
    }).result();
    runtime.log(`WF-007: Payout scheduled on-chain — tx status: ${payoutResult.txStatus === 1 ? "CONFIRMED" : payoutResult.txStatus}`);

    // Step 7a: Release payout — execute ERC-20 transfer
    const releaseCalldata = encodeFunctionData({
      abi: CLAIM_ESCROW_ABI,
      functionName: "releasePayout",
      args: [claimId],
    });

    runtime.log("WF-007: Releasing payout — executing ERC-20 transfer");
    const releaseReport = runtime.report(prepareReportRequest(releaseCalldata)).result();
    const releaseResult = evmClient.writeReport(runtime, {
      receiver: config.claimEscrowAddress,
      report: releaseReport,
      gasConfig: { gasLimit: "500000" },
    }).result();
    runtime.log(`WF-007: Payout released on-chain — tx status: ${releaseResult.txStatus === 1 ? "CONFIRMED" : releaseResult.txStatus}`);

    // Step 7b: Mark claim PAID — terminal state
    const markPaidCalldata = encodeFunctionData({
      abi: CLAIM_DECISION_REGISTRY_ABI,
      functionName: "markPaid",
      args: [claimId],
    });

    runtime.log("WF-007: Marking claim PAID (terminal state)");
    const paidReport = runtime.report(prepareReportRequest(markPaidCalldata)).result();
    const paidResult = evmClient.writeReport(runtime, {
      receiver: config.claimDecisionRegistryAddress,
      report: paidReport,
      gasConfig: { gasLimit: "500000" },
    }).result();
    runtime.log(`WF-007: Claim marked PAID on-chain — tx status: ${paidResult.txStatus === 1 ? "CONFIRMED" : paidResult.txStatus}`);
  }

  // ---- Step 8: Post decision to callback service [ENCRYPTED HTTP] ----
  runtime.log(`WF-007: [ENCRYPTED] Notifying provider of decision: ${decisionState}`);
  const callbackJsonStr = JSON.stringify({
    claim_id: claimId,
    decision_state: decisionState,
    reason_bitmap: proofBody,
    workflow_id: "WF-007",
    trigger_type: "log",
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

  runtime.log(`WF-007: Callback delivered: ${decisionState} — ${callbackOk ? "sent" : "FAILED"}`);

  return JSON.stringify({
    workflow: "WF-007-ClaimTransferSettlement",
    trigger_type: "log",
    claim_id: claimId,
    policy_hash: policyHash,
    decision_state: decisionState,
    consent_verified_onchain: consentActive,
    policy_verified_onchain: policyActive,
    proof_response: proofBody,
    timestamp: runtime.now().toISOString(),
  });
};

// ---------------------------------------------------------------------------
// Workflow init — uses EVMClient.logTrigger() instead of CronCapability
// ---------------------------------------------------------------------------
export const initWorkflow = (config: Config) => {
  const evmClient = new EVMClient(BigInt(config.chainSelector));

  return [
    handler(
      evmClient.logTrigger({
        addresses: [hexToBase64(config.claimDecisionRegistryAddress)],
        topics: [{ values: [hexToBase64(CLAIM_SUBMITTED_TOPIC)] }],
        confidence: "CONFIDENCE_LEVEL_LATEST",
      }),
      onClaimTransferLog
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
