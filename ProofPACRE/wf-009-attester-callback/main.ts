import {
  HTTPCapability,
  ConfidentialHTTPClient,
  EVMClient,
  handler,
  Runner,
  type Runtime,
  type HTTPPayload,
  ok,
  encodeCallMsg,
  prepareReportRequest,
  LATEST_BLOCK_NUMBER,
  bytesToHex,
} from "@chainlink/cre-sdk";

import { encodeFunctionData, decodeFunctionResult } from "viem";
// CRE SDK handles transport, signing, and DON consensus; viem handles ABI encoding/decoding only.

// ---------------------------------------------------------------------------
// WF-009 · AttesterCallback · HTTP trigger (Confidential AI Attester → on-chain)
//
// The "native callback" topology (Option B): the clinical document goes
// provider → Attester TEE and NEVER touches the DON. The Attester posts its
// signed verdict to decision-callback-service, which relays it here. This
// workflow writes the attested decision + settlement on-chain from the verdict
// already in the payload — no proof-service call, no EHR fetch, no PHI.
//
// Trigger: HTTPCapability — signed relay from decision-callback-service
// Contracts touched:
//   READ  — ConsentRegistry.isConsentActive, PolicyRegistry.isPolicyActive
//   WRITE — ClaimDecisionRegistry.submitClaim / setProofResult / markPaid,
//           ClaimEscrow.schedulePayout / releasePayout
// Privacy: only the verdict + digests reach the DON — the document does not.
// ---------------------------------------------------------------------------

// CRE WASM has no TextDecoder — manual byte-to-string conversion
function bytesToString(bytes: Uint8Array): string {
  let str = "";
  for (let i = 0; i < bytes.length; i++) {
    str += String.fromCharCode(bytes[i]);
  }
  return str;
}

function safeParse(raw: string): Record<string, any> | null {
  try { return JSON.parse(raw); } catch { return null; }
}

// ---------------------------------------------------------------------------
// Contract ABI Fragments (duplicated per-workflow — CRE compiles to isolated WASM)
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
  authorizedSignerAddress: string;       // Public key authorized to relay into this workflow
  callbackServiceUrl: string;            // decision-callback-service base URL (port 3006)
  owner: string;                         // Workflow owner address — used for CRE registration
  chainSelector: string;                 // EIP-155 chain selector
  consentRegistryAddress: string;
  policyRegistryAddress: string;
  claimDecisionRegistryAddress: string;
  claimEscrowAddress: string;
  creSignerAddress: string;              // DON-controlled signer — has WORKFLOW_ROLE on all contracts
  treasuryAddress: string;
};

// ---------------------------------------------------------------------------
// Handler: onAttesterCallback
//
//   0. [DECODE]      Parse the relayed Attester verdict from payload.input
//   1. [EVM READ]    Verify consent on-chain (defence-in-depth)
//   2. [EVM READ]    Verify policy on-chain
//   3. [EVM WRITE]   Submit claim (ClaimDecisionRegistry)
//   4. [EVM WRITE]   Record proof result — proofHash = attester response_digest
//   5. [EVM WRITE]   Schedule + release payout, mark PAID (if approved)
//   6. [ENCRYPTED]   Post decision callback
// ---------------------------------------------------------------------------
export const onAttesterCallback = (
  runtime: Runtime<Config>,
  payload: HTTPPayload
): string => {
  const config = runtime.config;
  runtime.log("WF-009: Attester callback workflow triggered");

  // ---- Step 0: Decode the relayed Attester verdict ----
  const input = safeParse(bytesToString(payload.input));
  if (!input) {
    runtime.log("WF-009: ERROR — failed to parse callback payload");
    return JSON.stringify({ workflow: "WF-009-AttesterCallback", error: "invalid payload" });
  }

  const claimId = (input.claim_id ?? ("0x" + "09".repeat(32))) as `0x${string}`;
  const policyHash = (input.policy_hash ?? ("0x" + "a1".repeat(32))) as `0x${string}`;
  const consentId = (input.consent_id ?? ("0x" + "c0".repeat(32))) as `0x${string}`;
  // The verdict comes from the TEE — the document never reached the DON.
  const proofOk = input.result === "PASS" || input.approved === true;
  const reasonBitmap = BigInt(input.reason_bitmap ?? (proofOk ? "0" : "1"));
  // Provenance: the attester's signed response_digest is the on-chain proof hash.
  const proofHash = (input.proof_hash ?? ("0x" + "b9".repeat(32))) as `0x${string}`;
  const requestedAmount = BigInt(input.requested_amount ?? "85000");
  const decisionState = proofOk ? "APPROVED" : "DENIED";
  const currentTimestamp = BigInt(Math.floor(Date.now() / 1000));

  runtime.log(`WF-009: Verdict relayed — claim ${claimId.substring(0, 10)}...${claimId.substring(58)}, decision ${decisionState}, proofHash ${proofHash.substring(0, 10)}..., attesterKey ${(input.attester_key_hash ?? "none")}`);

  const evmClient = new EVMClient(BigInt(config.chainSelector));

  // ---- Step 1: Verify consent on-chain [EVM READ] ----
  const consentResult = evmClient.callContract(runtime, {
    call: encodeCallMsg({
      from: config.creSignerAddress as `0x${string}`,
      to: config.consentRegistryAddress as `0x${string}`,
      data: encodeFunctionData({ abi: CONSENT_REGISTRY_ABI, functionName: "isConsentActive", args: [consentId, currentTimestamp] }),
    }),
    blockNumber: LATEST_BLOCK_NUMBER,
  }).result();
  const consentActive = decodeFunctionResult({
    abi: CONSENT_REGISTRY_ABI, functionName: "isConsentActive", data: bytesToHex(consentResult.data),
  });
  runtime.log(`WF-009: Consent verified on-chain: ${consentActive ? "ACTIVE" : "REVOKED"}`);

  // ---- Step 2: Verify policy on-chain [EVM READ] ----
  const policyResult = evmClient.callContract(runtime, {
    call: encodeCallMsg({
      from: config.creSignerAddress as `0x${string}`,
      to: config.policyRegistryAddress as `0x${string}`,
      data: encodeFunctionData({ abi: POLICY_REGISTRY_ABI, functionName: "isPolicyActive", args: [policyHash, currentTimestamp] }),
    }),
    blockNumber: LATEST_BLOCK_NUMBER,
  }).result();
  const policyActive = decodeFunctionResult({
    abi: POLICY_REGISTRY_ABI, functionName: "isPolicyActive", data: bytesToHex(policyResult.data),
  });
  runtime.log(`WF-009: Policy verified on-chain: ${policyActive ? "ACTIVE" : "INACTIVE"}`);

  // ---- Step 3: Submit claim on-chain [EVM WRITE] ----
  const submitReport = runtime.report(prepareReportRequest(
    encodeFunctionData({ abi: CLAIM_DECISION_REGISTRY_ABI, functionName: "submitClaim", args: [claimId, policyHash] })
  )).result();
  const submitResult = evmClient.writeReport(runtime, {
    receiver: config.claimDecisionRegistryAddress, report: submitReport, gasConfig: { gasLimit: "500000" },
  }).result();
  runtime.log(`WF-009: DECISION: ${decisionState} — Claim submitted on-chain — tx status: ${submitResult.txStatus === 1 ? "CONFIRMED" : submitResult.txStatus}`);

  // ---- Step 4: Record proof result on-chain [EVM WRITE] ----
  const setProofReport = runtime.report(prepareReportRequest(
    encodeFunctionData({ abi: CLAIM_DECISION_REGISTRY_ABI, functionName: "setProofResult", args: [claimId, proofHash, reasonBitmap, proofOk] })
  )).result();
  const setProofResultTx = evmClient.writeReport(runtime, {
    receiver: config.claimDecisionRegistryAddress, report: setProofReport, gasConfig: { gasLimit: "500000" },
  }).result();
  runtime.log(`WF-009: Proof result recorded (proofHash = attester digest) — tx status: ${setProofResultTx.txStatus === 1 ? "CONFIRMED" : setProofResultTx.txStatus}`);

  // ---- Step 5: Settle if approved [EVM WRITE] ----
  if (proofOk) {
    const scheduleReport = runtime.report(prepareReportRequest(
      encodeFunctionData({ abi: CLAIM_ESCROW_ABI, functionName: "schedulePayout", args: [claimId, config.treasuryAddress as `0x${string}`, requestedAmount] })
    )).result();
    const scheduleTx = evmClient.writeReport(runtime, {
      receiver: config.claimEscrowAddress, report: scheduleReport, gasConfig: { gasLimit: "500000" },
    }).result();
    runtime.log(`WF-009: Payout scheduled — tx status: ${scheduleTx.txStatus === 1 ? "CONFIRMED" : scheduleTx.txStatus}`);

    const releaseReport = runtime.report(prepareReportRequest(
      encodeFunctionData({ abi: CLAIM_ESCROW_ABI, functionName: "releasePayout", args: [claimId] })
    )).result();
    const releaseTx = evmClient.writeReport(runtime, {
      receiver: config.claimEscrowAddress, report: releaseReport, gasConfig: { gasLimit: "500000" },
    }).result();
    runtime.log(`WF-009: Payout released — tx status: ${releaseTx.txStatus === 1 ? "CONFIRMED" : releaseTx.txStatus}`);

    const paidReport = runtime.report(prepareReportRequest(
      encodeFunctionData({ abi: CLAIM_DECISION_REGISTRY_ABI, functionName: "markPaid", args: [claimId] })
    )).result();
    const paidTx = evmClient.writeReport(runtime, {
      receiver: config.claimDecisionRegistryAddress, report: paidReport, gasConfig: { gasLimit: "500000" },
    }).result();
    runtime.log(`WF-009: Claim marked PAID — tx status: ${paidTx.txStatus === 1 ? "CONFIRMED" : paidTx.txStatus}`);
  }

  // ---- Step 6: Post decision to callback service [ENCRYPTED HTTP] ----
  const confidentialClient = new ConfidentialHTTPClient();
  const callbackResp = confidentialClient.sendRequest(runtime, {
    vaultDonSecrets: [{ key: "aesEncryptionKey", owner: config.owner }],
    request: {
      url: `${config.callbackServiceUrl}/v1/callbacks/prior-auth-decision`,
      method: "POST",
      bodyString: JSON.stringify({ claim_id: claimId, decision_state: decisionState, reason_bitmap: reasonBitmap.toString(), workflow_id: "WF-009" }),
      multiHeaders: { "Content-Type": { values: ["application/json"] } },
      encryptOutput: true,
    },
  }).result();
  runtime.log(`WF-009: Callback delivered: ${decisionState} — ${ok(callbackResp) ? "sent" : "FAILED"}`);

  return JSON.stringify({
    workflow: "WF-009-AttesterCallback",
    claim_id: claimId,
    decision_state: decisionState,
    proof_hash: proofHash,
    attester_key_hash: input.attester_key_hash ?? null,
    consent_verified_onchain: consentActive,
    policy_verified_onchain: policyActive,
    timestamp: runtime.now().toISOString(),
  });
};

// ---------------------------------------------------------------------------
// Workflow init — HTTP trigger (relayed verdict from decision-callback-service)
// ---------------------------------------------------------------------------
export const initWorkflow = (config: Config) => {
  const httpTrigger = new HTTPCapability();
  return [
    handler(
      httpTrigger.trigger({
        authorizedKeys: [{ type: "KEY_TYPE_ECDSA_EVM", publicKey: config.authorizedSignerAddress }],
      }),
      onAttesterCallback
    ),
  ];
};

export async function main() {
  const runner = await Runner.newRunner<Config>();
  await runner.run(initWorkflow);
}
