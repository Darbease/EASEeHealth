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

// ---------------------------------------------------------------------------
// WF-006 · MedicationPaymentVerification · Cron trigger
//
// Pharmaceutical benefit check: fetch medication needing prior auth →
// verify consent + policy on-chain → check formulary coverage via proof
// service → submit claim → schedule + release payout → callback.
//
// CRE capabilities: ConfidentialHTTPClient, EVMClient
// Contracts touched:
//   READ  — ConsentRegistry.isConsentActive, PolicyRegistry.isPolicyActive
//   WRITE — ClaimDecisionRegistry.submitClaim / setProofResult / markPaid,
//           ClaimEscrow.schedulePayout / releasePayout
// Demo scenario: Maria Garcia — Clopidogrel 75mg ($280.00, payer covers $238.00)
// Privacy: no PHI on-chain — only hashes, RxNorm codes, state transitions
// ---------------------------------------------------------------------------

function safeParse(raw: string): Record<string, any> | null {
  try { return JSON.parse(raw); } catch { return null; }
}

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
  schedule: string;
  policyServiceUrl: string;
  proofServiceUrl: string;
  callbackServiceUrl: string;
  ehrServiceUrl: string;
  owner: string;
  chainSelector: string;
  consentRegistryAddress: string;
  policyRegistryAddress: string;
  claimDecisionRegistryAddress: string;
  claimEscrowAddress: string;
  creSignerAddress: string;
  treasuryAddress: string;
};

// ---------------------------------------------------------------------------
// Handler: onMedicationPaymentCron
// ---------------------------------------------------------------------------
export const onMedicationPaymentCron = (
  runtime: Runtime<Config>,
  _cronPayload: CronPayload
): string => {
  const config = runtime.config;
  runtime.log("WF-006: Medication Payment Verification workflow triggered");

  // Deterministic demo fixture IDs
  const claimId = ("0x" + "06".repeat(32)) as `0x${string}`;
  const policyHash = ("0x" + "a1".repeat(32)) as `0x${string}`;
  const consentHash = ("0x" + "c0".repeat(32)) as `0x${string}`;
  const proofHash = ("0x" + "d6".repeat(32)) as `0x${string}`;
  const currentTimestamp = BigInt(Math.floor(Date.now() / 1000));

  // Defaults for demo happy path (Maria Garcia — Clopidogrel 75mg)
  let medicationCode = "309362";
  let payerCoverageAmt = 23800n; // $238.00 in cents
  let medicationAmount = 28000; // $280.00 in cents

  const confidentialClient = new ConfidentialHTTPClient();

  // ---- Step 0: Fetch medications needing prior auth [ENCRYPTED HTTP] ----
  runtime.log("WF-006: [ENCRYPTED] Fetching medications pending authorization");
  const ehrResp = confidentialClient.sendRequest(runtime, {
    vaultDonSecrets: [
      { key: "aesEncryptionKey", owner: config.owner },
    ],
    request: {
      url: `${config.ehrServiceUrl}/v1/ehr/medications/pending-auth`,
      method: "GET",
      multiHeaders: {
        "Content-Type": { values: ["application/json"] },
      },
      encryptOutput: true,
    },
  }).result();

  if (ok(ehrResp)) {
    const ehrData = safeParse(text(ehrResp));
    if (ehrData && Array.isArray(ehrData.pending_medications) && ehrData.pending_medications.length > 0) {
      const med = ehrData.pending_medications[0] as Record<string, unknown>;
      medicationCode = (med.code as string) ?? medicationCode;
      const baseCost = parseFloat((med.base_cost as string) ?? "280.00");
      const payerCov = parseFloat((med.payer_coverage as string) ?? "238.00");
      medicationAmount = Math.round(baseCost * 100);
      payerCoverageAmt = BigInt(Math.round(payerCov * 100));
      runtime.log(`WF-006: EHR data loaded — ${ehrData.pending_medications.length} medications pending auth, first: RxNorm ${medicationCode}`);
    }
  } else {
    runtime.log("WF-006: EHR fetch failed — using default medication data");
  }

  // ---- Step 1: Fetch active policy + formulary from policy-service [ENCRYPTED HTTP] ----
  runtime.log("WF-006: [ENCRYPTED] Fetching policy and formulary data");
  const policyResp = confidentialClient.sendRequest(runtime, {
    vaultDonSecrets: [
      { key: "aesEncryptionKey", owner: config.owner },
    ],
    request: {
      url: `${config.policyServiceUrl}/v1/policies/payer-demo-001/v1`,
      method: "GET",
      multiHeaders: {
        "Content-Type": { values: ["application/json"] },
      },
      encryptOutput: true,
    },
  }).result();

  const policyData = safeParse(text(policyResp));
  runtime.log(`WF-006: Policy fetched — formulary ${policyData?.predicates?.formulary ? "loaded" : "missing"}`);

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

  runtime.log(`WF-006: Consent verified on-chain: ${consentActive ? "ACTIVE" : "REVOKED"}`);

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

  runtime.log(`WF-006: Policy verified on-chain: ${policyActive ? "ACTIVE" : "INACTIVE"}`);

  // ---- Step 4: Call proof-service-stub with medication fields [ENCRYPTED HTTP] ----
  runtime.log(`WF-006: [ENCRYPTED] Evaluating formulary coverage — RxNorm ${medicationCode}, amount ${medicationAmount}`);
  const proofJsonStr = JSON.stringify({
    claim_id: claimId,
    policy_hash: policyHash,
    procedure_code: "PROC_KNEE_MRI", // base procedure for backward compat
    requested_amount: "0", // medication amount checked separately
    medication_code: medicationCode,
    medication_amount: medicationAmount.toString(),
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
  const proofOk = proofHttpOk && proofData?.result === "PASS";
  const decisionState = proofOk ? "APPROVED" : "DENIED";
  runtime.log(`WF-006: [ENCRYPTED] Proof evaluation: ${proofOk ? "PASSED" : "FAILED"}`);

  // ---- Step 5: Submit claim on-chain [EVM WRITE] ----
  const submitCalldata = encodeFunctionData({
    abi: CLAIM_DECISION_REGISTRY_ABI,
    functionName: "submitClaim",
    args: [claimId, policyHash],
  });

  runtime.log(`WF-006: DECISION: ${decisionState} — Submitting claim ${claimId.substring(0, 10)}...${claimId.substring(58)} to ClaimDecisionRegistry`);
  const submitReport = runtime.report(prepareReportRequest(submitCalldata)).result();
  const submitResult = evmClient.writeReport(runtime, {
    receiver: config.claimDecisionRegistryAddress,
    report: submitReport,
    gasConfig: { gasLimit: "500000" },
  }).result();
  runtime.log(`WF-006: Claim submitted on-chain — tx status: ${submitResult.txStatus === 1 ? "CONFIRMED" : submitResult.txStatus}`);

  // ---- Step 6: Record proof result on-chain [EVM WRITE] ----
  const reasonBitmap = proofOk ? 0n : BigInt(proofData?.reason_bitmap ?? "1");
  const setProofCalldata = encodeFunctionData({
    abi: CLAIM_DECISION_REGISTRY_ABI,
    functionName: "setProofResult",
    args: [claimId, proofHash, reasonBitmap, proofOk],
  });

  runtime.log(`WF-006: Recording proof result — reason bitmap: ${reasonBitmap === 0n ? "0 (no denial flags)" : reasonBitmap.toString()}`);
  const proofReport = runtime.report(prepareReportRequest(setProofCalldata)).result();
  const proofWriteResult = evmClient.writeReport(runtime, {
    receiver: config.claimDecisionRegistryAddress,
    report: proofReport,
    gasConfig: { gasLimit: "500000" },
  }).result();
  runtime.log(`WF-006: Proof result recorded on-chain — tx status: ${proofWriteResult.txStatus === 1 ? "CONFIRMED" : proofWriteResult.txStatus}`);

  // ---- Steps 7-9: Payout path (only if approved) ----
  if (proofOk) {
    // Step 7: Schedule payout
    const scheduleCalldata = encodeFunctionData({
      abi: CLAIM_ESCROW_ABI,
      functionName: "schedulePayout",
      args: [
        claimId,
        config.treasuryAddress as `0x${string}`,
        payerCoverageAmt,
      ],
    });

    runtime.log(`WF-006: PAYOUT: scheduling ${payerCoverageAmt} minor units to treasury`);
    const payoutReport = runtime.report(prepareReportRequest(scheduleCalldata)).result();
    const payoutResult = evmClient.writeReport(runtime, {
      receiver: config.claimEscrowAddress,
      report: payoutReport,
      gasConfig: { gasLimit: "500000" },
    }).result();
    runtime.log(`WF-006: Payout scheduled on-chain — tx status: ${payoutResult.txStatus === 1 ? "CONFIRMED" : payoutResult.txStatus}`);

    // Step 8: Release payout
    const releaseCalldata = encodeFunctionData({
      abi: CLAIM_ESCROW_ABI,
      functionName: "releasePayout",
      args: [claimId],
    });

    runtime.log("WF-006: Releasing payout — executing ERC-20 transfer");
    const releaseReport = runtime.report(prepareReportRequest(releaseCalldata)).result();
    const releaseResult = evmClient.writeReport(runtime, {
      receiver: config.claimEscrowAddress,
      report: releaseReport,
      gasConfig: { gasLimit: "500000" },
    }).result();
    runtime.log(`WF-006: Payout released on-chain — tx status: ${releaseResult.txStatus === 1 ? "CONFIRMED" : releaseResult.txStatus}`);

    // Step 9: Mark claim PAID
    const markPaidCalldata = encodeFunctionData({
      abi: CLAIM_DECISION_REGISTRY_ABI,
      functionName: "markPaid",
      args: [claimId],
    });

    runtime.log("WF-006: Marking claim PAID (terminal state)");
    const paidReport = runtime.report(prepareReportRequest(markPaidCalldata)).result();
    const paidResult = evmClient.writeReport(runtime, {
      receiver: config.claimDecisionRegistryAddress,
      report: paidReport,
      gasConfig: { gasLimit: "500000" },
    }).result();
    runtime.log(`WF-006: Claim marked PAID on-chain — tx status: ${paidResult.txStatus === 1 ? "CONFIRMED" : paidResult.txStatus}`);
  }

  // ---- Step 10: Post decision to callback service [ENCRYPTED HTTP] ----
  runtime.log(`WF-006: [ENCRYPTED] Notifying provider of decision: ${decisionState}`);
  const callbackJsonStr = JSON.stringify({
    claim_id: claimId,
    decision_state: decisionState,
    reason_bitmap: proofBody,
    workflow_id: "WF-006",
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

  runtime.log(`WF-006: Callback delivered: ${decisionState} — ${callbackOk ? "sent" : "FAILED"}`);

  return JSON.stringify({
    workflow: "WF-006-MedicationPaymentVerification",
    claim_id: claimId,
    decision_state: decisionState,
    medication_code: medicationCode,
    consent_verified_onchain: consentActive,
    policy_verified_onchain: policyActive,
    proof_response: proofBody,
    timestamp: runtime.now().toISOString(),
  });
};

// ---------------------------------------------------------------------------
// Workflow init
// ---------------------------------------------------------------------------
export const initWorkflow = (config: Config) => {
  const cron = new CronCapability();

  return [
    handler(
      cron.trigger({ schedule: config.schedule }),
      onMedicationPaymentCron
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
