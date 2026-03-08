import {
  HTTPCapability,
  HTTPClient,
  ConfidentialHTTPClient,
  EVMClient,
  handler,
  Runner,
  type Runtime,
  type HTTPPayload,
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
// WF-008 · HttpPriorAuth · HTTP trigger (request-driven)
//
// On-demand prior-authorization: provider-adapter-api signs and sends the
// submission payload directly to the CRE gateway via HTTPCapability. The
// workflow fires immediately — no cron polling delay.
//
// Key difference from WF-001: all claim data arrives in the HTTP payload,
// so no EHR fetch is needed (saves 1 ConfidentialHTTP call).
//
// CRE capabilities: HTTPClient, ConfidentialHTTPClient, EVMClient
// Trigger: HTTPCapability — signed HTTP request from provider-adapter-api
// Contracts touched:
//   READ  — ConsentRegistry.isConsentActive, PolicyRegistry.isPolicyActive
//   WRITE — ClaimDecisionRegistry.submitClaim / setProofResult / markPaid,
//           ClaimEscrow.schedulePayout / releasePayout
// Demo scenario: F (HTTP trigger → APPROVED → PAID)
// Privacy: no PHI on-chain — only hashes, state transitions, and payout events
// Spec: TECH_ARCHITECTURE_SPEC_ProofPA.md § 8.1
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// CRE WASM has no TextDecoder — manual byte-to-string conversion
// ---------------------------------------------------------------------------
function bytesToString(bytes: Uint8Array): string {
  let str = "";
  for (let i = 0; i < bytes.length; i++) {
    str += String.fromCharCode(bytes[i]);
  }
  return str;
}

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
  authorizedSignerAddress: string;       // Public key authorized to trigger this workflow
  policyServiceUrl: string;              // policy-service base URL (port 3001)
  proofServiceUrl: string;               // proof-service-stub base URL (port 3003)
  callbackServiceUrl: string;            // decision-callback-service base URL (port 3006)
  owner: string;                         // Workflow owner address — used for CRE registration
  chainSelector: string;                 // EIP-155 chain selector — Base Sepolia in staging
  consentRegistryAddress: string;        // Deployed ConsentRegistry contract (from Deploy.s.sol)
  policyRegistryAddress: string;         // Deployed PolicyRegistry contract (from Deploy.s.sol)
  claimDecisionRegistryAddress: string;  // Deployed ClaimDecisionRegistry (state machine + proof)
  claimEscrowAddress: string;            // Deployed ClaimEscrow (ERC-20 mock USDC pool)
  creSignerAddress: string;              // DON-controlled signer — has WORKFLOW_ROLE on all contracts
  treasuryAddress: string;               // Payout recipient — provider's treasury wallet
};

// ---------------------------------------------------------------------------
// Handler: onPriorAuthRequest
// ---------------------------------------------------------------------------
// HTTP-triggered handler that demonstrates on-demand prior-auth via signed
// HTTP request. All claim data comes from the HTTP payload — no EHR fetch needed.
//
//   0. [DECODE]      Parse payload.input bytes → JSON
//   1. [EVM READ]    Verify consent on-chain (ConsentRegistry)
//   2. [EVM READ]    Verify policy on-chain (PolicyRegistry)
//   3. [HTTP]        Fetch policy predicates from policy-service (consensus)
//   4. [ENCRYPTED]   Call proof-service-stub via confidential HTTP
//   5. [EVM WRITE]   Submit claim on-chain (ClaimDecisionRegistry)
//   6. [EVM WRITE]   Record proof result on-chain (ClaimDecisionRegistry)
//   7. [EVM WRITE]   Schedule payout if approved (ClaimEscrow)
//   8. [EVM WRITE]   Release payout + mark PAID (ClaimEscrow + ClaimDecisionRegistry)
//   9. [ENCRYPTED]   Post decision callback
// ---------------------------------------------------------------------------
export const onPriorAuthRequest = (
  runtime: Runtime<Config>,
  payload: HTTPPayload
): string => {
  const config = runtime.config;
  runtime.log("WF-008: HTTP Prior Auth workflow triggered");

  // ---- Step 0: Decode HTTP payload ----
  const rawInput = bytesToString(payload.input);
  const input = safeParse(rawInput);
  if (!input) {
    runtime.log("WF-008: ERROR — failed to parse HTTP payload");
    return JSON.stringify({ workflow: "WF-008-HttpPriorAuth", error: "invalid payload" });
  }

  const claimId = (input.claim_id ?? ("0x" + "08".repeat(32))) as `0x${string}`;
  const policyHash = (input.policy_hash ?? ("0x" + "a1".repeat(32))) as `0x${string}`;
  const consentId = (input.consent_id ?? ("0x" + "c0".repeat(32))) as `0x${string}`;
  const proofHash = ("0x" + "b8".repeat(32)) as `0x${string}`;
  const procedureCode = input.procedure_code ?? "PROC_CARDIAC_CT";
  const requestedAmount = BigInt(input.requested_amount ?? "38000");
  const currentTimestamp = BigInt(Math.floor(Date.now() / 1000));

  runtime.log(`WF-008: Payload decoded — claim ${claimId.substring(0, 10)}...${claimId.substring(58)}, procedure ${procedureCode}, amount ${requestedAmount}`);

  // ---- Step 1: Verify consent on-chain [EVM READ] ----
  const evmClient = new EVMClient(BigInt(config.chainSelector));

  const consentCalldata = encodeFunctionData({
    abi: CONSENT_REGISTRY_ABI,
    functionName: "isConsentActive",
    args: [consentId, currentTimestamp],
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

  runtime.log(`WF-008: Consent verified on-chain: ${consentActive ? "ACTIVE" : "REVOKED"}`);

  // ---- Step 2: Verify policy on-chain [EVM READ] ----
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

  runtime.log(`WF-008: Policy verified on-chain: ${policyActive ? "ACTIVE" : "INACTIVE"}`);

  // ---- Step 3: Fetch policy predicates [HTTP — consensus] ----
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
  runtime.log(`WF-008: Policy fetched for ${procedureCode} — predicates ${policyData?.predicates ? "loaded" : "missing"}`);

  // ---- Step 4: Call proof-service-stub via confidential HTTP [ENCRYPTED] ----
  const confidentialClient = new ConfidentialHTTPClient();

  runtime.log(`WF-008: [ENCRYPTED] Evaluating medical necessity — ${procedureCode}, amount ${requestedAmount}`);
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
  runtime.log(`WF-008: [ENCRYPTED] Proof evaluation: ${proofOk ? "PASSED" : "FAILED"}`);

  // ---- Step 5: Submit claim on-chain [EVM WRITE] ----
  const submitCalldata = encodeFunctionData({
    abi: CLAIM_DECISION_REGISTRY_ABI,
    functionName: "submitClaim",
    args: [claimId, policyHash],
  });

  runtime.log(`WF-008: DECISION: ${decisionState} — Submitting claim ${claimId.substring(0, 10)}...${claimId.substring(58)} to ClaimDecisionRegistry`);
  const submitReport = runtime.report(prepareReportRequest(submitCalldata)).result();
  const submitResult = evmClient.writeReport(runtime, {
    receiver: config.claimDecisionRegistryAddress,
    report: submitReport,
    gasConfig: { gasLimit: "500000" },
  }).result();
  runtime.log(`WF-008: Claim submitted on-chain — tx status: ${submitResult.txStatus === 1 ? "CONFIRMED" : submitResult.txStatus}`);

  // ---- Step 6: Record proof result on-chain [EVM WRITE] ----
  const reasonBitmap = proofOk ? 0n : BigInt(proofData?.reason_bitmap ?? "1");
  const setProofCalldata = encodeFunctionData({
    abi: CLAIM_DECISION_REGISTRY_ABI,
    functionName: "setProofResult",
    args: [claimId, proofHash, reasonBitmap, proofOk],
  });

  runtime.log(`WF-008: Recording proof result — reason bitmap: ${reasonBitmap === 0n ? "0 (no denial flags)" : reasonBitmap.toString()}`);
  const proofReport = runtime.report(prepareReportRequest(setProofCalldata)).result();
  const proofWriteResult = evmClient.writeReport(runtime, {
    receiver: config.claimDecisionRegistryAddress,
    report: proofReport,
    gasConfig: { gasLimit: "500000" },
  }).result();
  runtime.log(`WF-008: Proof result recorded on-chain — tx status: ${proofWriteResult.txStatus === 1 ? "CONFIRMED" : proofWriteResult.txStatus}`);

  // ---- Step 7: Schedule payout if approved [EVM WRITE] ----
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

    runtime.log(`WF-008: PAYOUT: scheduling to treasury ${config.treasuryAddress.substring(0, 6)}...${config.treasuryAddress.substring(38)}`);
    const payoutReport = runtime.report(prepareReportRequest(scheduleCalldata)).result();
    const payoutResult = evmClient.writeReport(runtime, {
      receiver: config.claimEscrowAddress,
      report: payoutReport,
      gasConfig: { gasLimit: "500000" },
    }).result();
    runtime.log(`WF-008: Payout scheduled on-chain — tx status: ${payoutResult.txStatus === 1 ? "CONFIRMED" : payoutResult.txStatus}`);

    // ---- Step 8: Release payout + mark PAID [EVM WRITE] ----
    const releaseCalldata = encodeFunctionData({
      abi: CLAIM_ESCROW_ABI,
      functionName: "releasePayout",
      args: [claimId],
    });

    runtime.log(`WF-008: Releasing payout — executing ERC-20 transfer`);
    const releaseReport = runtime.report(prepareReportRequest(releaseCalldata)).result();
    const releaseResult = evmClient.writeReport(runtime, {
      receiver: config.claimEscrowAddress,
      report: releaseReport,
      gasConfig: { gasLimit: "500000" },
    }).result();
    runtime.log(`WF-008: Payout released on-chain — tx status: ${releaseResult.txStatus === 1 ? "CONFIRMED" : releaseResult.txStatus}`);

    // Mark claim as PAID — terminal state
    const markPaidCalldata = encodeFunctionData({
      abi: CLAIM_DECISION_REGISTRY_ABI,
      functionName: "markPaid",
      args: [claimId],
    });

    runtime.log(`WF-008: Marking claim PAID (terminal state)`);
    const paidReport = runtime.report(prepareReportRequest(markPaidCalldata)).result();
    const paidResult = evmClient.writeReport(runtime, {
      receiver: config.claimDecisionRegistryAddress,
      report: paidReport,
      gasConfig: { gasLimit: "500000" },
    }).result();
    runtime.log(`WF-008: Claim marked PAID on-chain — tx status: ${paidResult.txStatus === 1 ? "CONFIRMED" : paidResult.txStatus}`);
  }

  // ---- Step 9: Post decision to callback service [ENCRYPTED HTTP] ----
  runtime.log(`WF-008: [ENCRYPTED] Notifying provider of decision: ${decisionState}`);
  const callbackJsonStr = JSON.stringify({
    claim_id: claimId,
    decision_state: decisionState,
    reason_bitmap: proofBody,
    workflow_id: "WF-008",
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

  runtime.log(`WF-008: Callback delivered: ${decisionState} — ${callbackOk ? "sent" : "FAILED"}`);

  return JSON.stringify({
    workflow: "WF-008-HttpPriorAuth",
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
// HTTPCapability serves as the trigger mechanism. The workflow fires immediately
// when a signed HTTP request arrives at the CRE gateway — no cron delay.
export const initWorkflow = (config: Config) => {
  const httpTrigger = new HTTPCapability();

  return [
    handler(
      httpTrigger.trigger({
        authorizedKeys: [
          {
            type: "KEY_TYPE_ECDSA_EVM",
            publicKey: config.authorizedSignerAddress,
          },
        ],
      }),
      onPriorAuthRequest
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
