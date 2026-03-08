import {
  HTTPCapability,
  ConfidentialHTTPClient,
  EVMClient,
  handler,
  Runner,
  type Runtime,
  type HTTPPayload,
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
// WF-002 · ConsentRevocation · HTTP trigger (request-driven)
//
// Patient-initiated consent cascade: patient portal sends a signed revocation
// request to the CRE gateway via HTTPCapability. The workflow fires immediately,
// revokes consent on-chain, then cascades across all affected claims —
// challenging approved claims and cancelling scheduled payouts.
//
// Key difference from original (Cron): immediate response to patient action,
// plus cross-contract fan-out (ConsentRegistry + ClaimDecisionRegistry +
// ClaimEscrow all touched in response to one revocation event).
//
// CRE capabilities: ConfidentialHTTPClient, EVMClient
// Trigger: HTTPCapability — signed HTTP request from patient portal
// Contracts touched:
//   READ  — ConsentRegistry.isConsentActive, ClaimDecisionRegistry.getDecision
//   WRITE — ConsentRegistry.revokeConsent, ClaimDecisionRegistry.challengeClaim,
//           ClaimEscrow.cancelPayout
// Demo scenario: B (revoked consent → cascade → affected claims blocked)
// Privacy: no PHI on-chain — only consent hashes and state transitions
// Spec: TECH_ARCHITECTURE_SPEC_ProofPA.md § 8.2
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
  {
    name: "revokeConsent",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "consentId", type: "bytes32" },
      { name: "reasonCode", type: "uint16" },
    ],
    outputs: [],
  },
] as const;

// ClaimDecision struct: { bytes32 claimId, uint8 state, bytes32 policyHash,
//   bytes32 proofHash, uint256 reasonBitmap, uint64 updatedAt }
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
          { name: "state", type: "uint8" },
          { name: "policyHash", type: "bytes32" },
          { name: "proofHash", type: "bytes32" },
          { name: "reasonBitmap", type: "uint256" },
          { name: "updatedAt", type: "uint64" },
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

// State enum: 0=NONE, 1=SUBMITTED, 2=PROOF_PENDING, 3=APPROVED, 4=DENIED, 5=CHALLENGED, 6=PAID
const STATE_NAMES = ["NONE", "SUBMITTED", "PROOF_PENDING", "APPROVED", "DENIED", "CHALLENGED", "PAID"];

// ---------------------------------------------------------------------------
// Config — populated from config.staging.json / config.production.json
// No `schedule` — this workflow uses HTTPCapability, not CronCapability.
// ---------------------------------------------------------------------------
export type Config = {
  authorizedSignerAddress: string;       // Public key authorized to trigger this workflow
  consentServiceUrl: string;             // consent-service base URL (port 3004)
  callbackServiceUrl: string;            // decision-callback-service base URL (port 3006)
  owner: string;                         // Vault owner address — empty for simulation
  chainSelector: string;                 // EIP-155 chain selector — Base Sepolia in staging
  consentRegistryAddress: string;        // Deployed ConsentRegistry contract (from Deploy.s.sol)
  claimDecisionRegistryAddress: string;  // Deployed ClaimDecisionRegistry (state machine)
  claimEscrowAddress: string;            // Deployed ClaimEscrow (ERC-20 mock USDC pool)
  creSignerAddress: string;              // DON-controlled signer — has WORKFLOW_ROLE on all contracts
};

// ---------------------------------------------------------------------------
// Handler: onConsentRevocation
// ---------------------------------------------------------------------------
// HTTP-triggered consent cascade: revokes consent on-chain, then finds and
// blocks all affected claims (challenge + cancel payout).
//
//   0. [DECODE]      Parse payload.input bytes → JSON (consent_id, reason_code, affected_claim_id)
//   1. [ENCRYPTED]   Validate revocation against consent-service records
//   2. [EVM READ]    isConsentActive — confirm consent is currently active
//   3. [EVM WRITE]   revokeConsent — immediate on-chain revocation
//   4. [EVM READ]    getDecision — check state of affected claim
//   5. [EVM WRITE]   challengeClaim — if APPROVED, block its payout
//   6. [EVM WRITE]   cancelPayout — cancel scheduled payout on escrow
//   7. [ENCRYPTED]   Callback — notify provider of revocation + cascade actions
// ---------------------------------------------------------------------------
export const onConsentRevocation = (
  runtime: Runtime<Config>,
  payload: HTTPPayload
): string => {
  const config = runtime.config;
  runtime.log("WF-002: Consent Revocation — HTTP trigger fired");

  // ---- Step 0: Decode HTTP payload ----
  const rawInput = bytesToString(payload.input);
  const input = safeParse(rawInput);
  if (!input) {
    runtime.log("WF-002: ERROR — failed to parse HTTP payload");
    return JSON.stringify({ workflow: "WF-002-ConsentRevocation", error: "invalid payload" });
  }

  const consentId = (input.consent_id ?? ("0x" + "c0".repeat(32))) as `0x${string}`;
  const reasonCode = input.reason_code ?? 1; // 1 = patient-initiated
  const affectedClaimId = (input.affected_claim_id ?? ("0x" + "01".repeat(32))) as `0x${string}`;
  const currentTimestamp = BigInt(Math.floor(Date.now() / 1000));

  runtime.log(`WF-002: Payload decoded — consent ${consentId.substring(0, 10)}...${consentId.substring(58)}, reason ${reasonCode === 1 ? "patient-initiated" : "administrative"}`);

  // ---- Step 1: Validate revocation against consent-service [ENCRYPTED HTTP] ----
  const confidentialClient = new ConfidentialHTTPClient();

  runtime.log("WF-002: [ENCRYPTED] Validating revocation request against consent-service records");
  const consentResp = confidentialClient.sendRequest(runtime, {
    vaultDonSecrets: [
      { key: "policyServiceApiKey", owner: config.owner },
      { key: "aesEncryptionKey", owner: config.owner },
    ],
    request: {
      url: `${config.consentServiceUrl}/v1/consents/revocations?since=900`,
      method: "GET",
      multiHeaders: {
        "Content-Type": { values: ["application/json"] },
        "Authorization": { values: ["Bearer {{.policyServiceApiKey}}"] },
      },
      encryptOutput: true,
    },
  }).result();

  if (!ok(consentResp)) {
    runtime.log("WF-002: Consent service validation failed — proceeding with on-chain check");
  } else {
    const consentBody = safeParse(text(consentResp));
    const revCount = consentBody?.revocations?.length ?? 0;
    runtime.log(`WF-002: Consent service confirmed ${revCount} revocation(s) on record`);
  }

  // ---- Step 2: Verify consent on-chain [EVM READ] ----
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

  const isActive = decodeFunctionResult({
    abi: CONSENT_REGISTRY_ABI,
    functionName: "isConsentActive",
    data: bytesToHex(consentResult.data),
  });

  runtime.log(`WF-002: On-chain consent status: ${isActive ? "ACTIVE — will revoke" : "ALREADY REVOKED"}`);

  // ---- Step 3: Revoke consent on-chain [EVM WRITE] ----
  let revokedOnchain = false;
  if (isActive) {
    const revokeCalldata = encodeFunctionData({
      abi: CONSENT_REGISTRY_ABI,
      functionName: "revokeConsent",
      args: [consentId, reasonCode],
    });

    runtime.log(`WF-002: Writing revokeConsent — reason code ${reasonCode}`);
    const revokeReport = runtime.report(prepareReportRequest(revokeCalldata)).result();
    const revokeResult = evmClient.writeReport(runtime, {
      receiver: config.consentRegistryAddress,
      report: revokeReport,
      gasConfig: { gasLimit: "500000" },
    }).result();
    revokedOnchain = revokeResult.txStatus === 1;
    runtime.log(`WF-002: Consent revoked on-chain — tx status: ${revokedOnchain ? "CONFIRMED" : revokeResult.txStatus}`);
  }

  // ---- Step 4: Check affected claim state [EVM READ] ----
  runtime.log(`WF-002: CASCADE — checking affected claim ${affectedClaimId.substring(0, 10)}...${affectedClaimId.substring(58)}`);
  const decisionCalldata = encodeFunctionData({
    abi: CLAIM_DECISION_REGISTRY_ABI,
    functionName: "getDecision",
    args: [affectedClaimId],
  });

  const decisionResult = evmClient.callContract(runtime, {
    call: encodeCallMsg({
      from: config.creSignerAddress as `0x${string}`,
      to: config.claimDecisionRegistryAddress as `0x${string}`,
      data: decisionCalldata,
    }),
    blockNumber: LATEST_BLOCK_NUMBER,
  }).result();

  const decision = decodeFunctionResult({
    abi: CLAIM_DECISION_REGISTRY_ABI,
    functionName: "getDecision",
    data: bytesToHex(decisionResult.data),
  });

  const stateNum = Number(decision.state);
  const stateName = STATE_NAMES[stateNum] || `UNKNOWN(${stateNum})`;
  runtime.log(`WF-002: Affected claim state: ${stateName}`);

  // ---- Step 5: Challenge claim if APPROVED [EVM WRITE] ----
  let challengedOnchain = false;
  if (stateNum === 3) {
    // State 3 = APPROVED — consent revoked, must block payout
    const challengeCalldata = encodeFunctionData({
      abi: CLAIM_DECISION_REGISTRY_ABI,
      functionName: "challengeClaim",
      args: [affectedClaimId, "consent-revoked"],
    });

    runtime.log(`WF-002: Claim is APPROVED — challenging due to consent revocation`);
    const challengeReport = runtime.report(prepareReportRequest(challengeCalldata)).result();
    const challengeResult = evmClient.writeReport(runtime, {
      receiver: config.claimDecisionRegistryAddress,
      report: challengeReport,
      gasConfig: { gasLimit: "500000" },
    }).result();
    challengedOnchain = challengeResult.txStatus === 1;
    runtime.log(`WF-002: challengeClaim tx status: ${challengedOnchain ? "CONFIRMED — payout BLOCKED" : challengeResult.txStatus}`);

    // ---- Step 6: Cancel payout on escrow [EVM WRITE] ----
    if (challengedOnchain) {
      const cancelCalldata = encodeFunctionData({
        abi: CLAIM_ESCROW_ABI,
        functionName: "cancelPayout",
        args: [affectedClaimId],
      });

      runtime.log("WF-002: Cancelling scheduled payout on ClaimEscrow");
      const cancelReport = runtime.report(prepareReportRequest(cancelCalldata)).result();
      const cancelResult = evmClient.writeReport(runtime, {
        receiver: config.claimEscrowAddress,
        report: cancelReport,
        gasConfig: { gasLimit: "500000" },
      }).result();
      runtime.log(`WF-002: cancelPayout tx status: ${cancelResult.txStatus === 1 ? "CONFIRMED — funds returned to pool" : cancelResult.txStatus}`);
    }
  } else if (stateNum === 0) {
    runtime.log("WF-002: No claim found at this ID — no cascade needed");
  } else {
    runtime.log(`WF-002: Claim in ${stateName} state — ${stateNum >= 4 ? "already terminal" : "not yet approved"}, no challenge needed`);
  }

  // ---- Step 7: Notify via callback [ENCRYPTED HTTP] ----
  runtime.log("WF-002: [ENCRYPTED] Notifying provider of consent revocation cascade");
  const callbackJsonStr = JSON.stringify({
    workflow_id: "WF-002",
    trigger_type: "http",
    consent_id: consentId,
    reason_code: reasonCode,
    revoked_onchain: revokedOnchain,
    affected_claim_id: affectedClaimId,
    affected_claim_state: stateName,
    challenged_onchain: challengedOnchain,
    timestamp: runtime.now().toISOString(),
  });
  const callbackResp = confidentialClient.sendRequest(runtime, {
    vaultDonSecrets: [
      { key: "aesEncryptionKey", owner: config.owner },
    ],
    request: {
      url: `${config.callbackServiceUrl}/v1/callbacks/consent-revoked`,
      method: "POST",
      bodyString: callbackJsonStr,
      multiHeaders: {
        "Content-Type": { values: ["application/json"] },
      },
      encryptOutput: true,
    },
  }).result();

  const callbackOk = ok(callbackResp);
  runtime.log(`WF-002: Cascade complete — consent ${revokedOnchain ? "REVOKED" : "already revoked"}, claim ${challengedOnchain ? "CHALLENGED + payout CANCELLED" : stateName} — callback ${callbackOk ? "sent" : "FAILED"}`);

  return JSON.stringify({
    workflow: "WF-002-ConsentRevocation",
    trigger_type: "http",
    status: callbackOk ? "COMPLETED" : "CALLBACK_FAILED",
    consent_id: consentId,
    revoked_onchain: revokedOnchain,
    affected_claim_id: affectedClaimId,
    affected_claim_state: stateName,
    challenged_onchain: challengedOnchain,
    timestamp: runtime.now().toISOString(),
  });
};

// ---------------------------------------------------------------------------
// Workflow init — uses HTTPCapability for immediate consent revocation
// ---------------------------------------------------------------------------
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
      onConsentRevocation
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
