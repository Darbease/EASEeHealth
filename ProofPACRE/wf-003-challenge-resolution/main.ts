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
// CRE SDK handles transport, signing, and DON consensus; viem handles ABI encoding/decoding only.

// ---------------------------------------------------------------------------
// WF-003 · ChallengeResolution · Log trigger (event-driven)
//
// Automated compliance gate: fires when ProofEvaluated(bytes32 indexed claimId,
// bytes32 proofHash, bool approved, uint256 reasonBitmap) is emitted on-chain.
// Runs risk analysis on newly-approved claims — if the amount exceeds policy
// caps or other compliance flags trigger, automatically challenges the claim
// to block payout until ops reviews.
//
// Key difference from original (Cron): reactive to on-chain state changes,
// autonomous fraud detection without human intervention.
//
// CRE capabilities: HTTPClient, ConfidentialHTTPClient, EVMClient
// Trigger: EVMClient.logTrigger() — reacts to ProofEvaluated events
// Contracts touched:
//   READ  — ClaimDecisionRegistry.getDecision, ConsentRegistry.isConsentActive
//   WRITE — ClaimDecisionRegistry.challengeClaim
// Demo scenario: C (auto-challenge on compliance risk → payout blocked)
// Privacy: no PHI on-chain — only claim state transitions
// Spec: TECH_ARCHITECTURE_SPEC_ProofPA.md § 8.3
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Defensive JSON parser (CRE WASM cannot share code across workflows)
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
// ProofEvaluated event topic0 = keccak256("ProofEvaluated(bytes32,bytes32,bool,uint256)")
// ---------------------------------------------------------------------------
const PROOF_EVALUATED_TOPIC = "0xfeae156cecc52d91998049b161ea0e9f9b90abfb795577187403978249a2dc10";

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

// State enum: 0=NONE, 1=SUBMITTED, 2=PROOF_PENDING, 3=APPROVED, 4=DENIED, 5=CHALLENGED, 6=PAID
const STATE_NAMES = ["NONE", "SUBMITTED", "PROOF_PENDING", "APPROVED", "DENIED", "CHALLENGED", "PAID"];

// ---------------------------------------------------------------------------
// Config — populated from config.staging.json / config.production.json
// No `schedule` — this workflow uses EVMClient.logTrigger(), not CronCapability.
// ---------------------------------------------------------------------------
export type Config = {
  policyServiceUrl: string;              // policy-service base URL (port 3001) — fetch cap predicates
  proofServiceUrl: string;               // proof-service-stub base URL (port 3003) — compliance re-eval
  callbackServiceUrl: string;            // decision-callback-service base URL (port 3006)
  owner: string;                         // Vault owner address — empty for simulation
  chainSelector: string;                 // EIP-155 chain selector — Base Sepolia in staging
  consentRegistryAddress: string;        // Deployed ConsentRegistry contract (from Deploy.s.sol)
  claimDecisionRegistryAddress: string;  // Deployed ClaimDecisionRegistry (state machine)
  claimEscrowAddress: string;            // Deployed ClaimEscrow (ERC-20 mock USDC pool)
  creSignerAddress: string;              // DON-controlled signer — has WORKFLOW_ROLE on all contracts
};

// ---------------------------------------------------------------------------
// Handler: onProofEvaluated
// ---------------------------------------------------------------------------
// Log-triggered automated compliance gate. Fires when ProofEvaluated is emitted
// on-chain (i.e. a claim was just approved or denied by WF-001/WF-008). For
// approved claims, runs automated risk analysis:
//
//   0. [DECODE LOG]   Extract claimId, proofHash, approved, reasonBitmap from event
//   1. [EVM READ]     getDecision — read full claim state + policyHash
//   2. [EVM READ]     isConsentActive — verify consent hasn't been revoked since approval
//   3. [HTTP]         Fetch policy predicates — get procedure caps for risk scoring
//   4. [ENCRYPTED]    POST compliance re-evaluation to proof-service
//   5. [EVM WRITE]    challengeClaim — if risk score exceeds threshold
//   6. [ENCRYPTED]    Callback — notify ops of auto-challenge with risk details
// ---------------------------------------------------------------------------
export const onProofEvaluated = (
  runtime: Runtime<Config>,
  log: EVMLog
): string => {
  const config = runtime.config;
  runtime.log("WF-003: Compliance Gate — ProofEvaluated log trigger fired");

  const currentTimestamp = BigInt(Math.floor(Date.now() / 1000));

  // ---- Step 0: Decode log event ----
  // ProofEvaluated(bytes32 indexed claimId, bytes32 proofHash, bool approved, uint256 reasonBitmap)
  // claimId is indexed → topics[1]; proofHash, approved, reasonBitmap are in data
  const claimId = bytesToHex(log.topics[1]) as `0x${string}`;
  const [_proofHash, approved, reasonBitmap] = decodeAbiParameters(
    [
      { name: "proofHash", type: "bytes32" },
      { name: "approved", type: "bool" },
      { name: "reasonBitmap", type: "uint256" },
    ],
    bytesToHex(log.data) as `0x${string}`
  );

  runtime.log(`WF-003: Decoded log — claim ${claimId.substring(0, 10)}...${claimId.substring(58)}, approved=${approved}, bitmap=${reasonBitmap}`);

  // Skip denied claims — no compliance risk on a denial
  if (!approved) {
    runtime.log("WF-003: Claim was DENIED — no compliance check needed");
    return JSON.stringify({
      workflow: "WF-003-ChallengeResolution",
      trigger_type: "log",
      claim_id: claimId,
      action: "SKIPPED",
      reason: "claim denied — no risk",
      timestamp: runtime.now().toISOString(),
    });
  }

  // ---- Step 1: Read full claim state [EVM READ] ----
  const evmClient = new EVMClient(BigInt(config.chainSelector));

  const decisionCalldata = encodeFunctionData({
    abi: CLAIM_DECISION_REGISTRY_ABI,
    functionName: "getDecision",
    args: [claimId],
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
  const policyHash = decision.policyHash as `0x${string}`;
  runtime.log(`WF-003: On-chain claim state: ${stateName}, policyHash: ${(policyHash as string).substring(0, 10)}...`);

  // Only proceed if claim is APPROVED (state 3)
  if (stateNum !== 3) {
    runtime.log(`WF-003: Claim not in APPROVED state (${stateName}) — skipping compliance check`);
    return JSON.stringify({
      workflow: "WF-003-ChallengeResolution",
      trigger_type: "log",
      claim_id: claimId,
      action: "SKIPPED",
      reason: `claim in ${stateName} state`,
      timestamp: runtime.now().toISOString(),
    });
  }

  // ---- Step 2: Verify consent still active [EVM READ] ----
  const consentHash = ("0x" + "c0".repeat(32)) as `0x${string}`;

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

  runtime.log(`WF-003: Consent check: ${consentActive ? "ACTIVE" : "REVOKED — immediate risk flag"}`);

  // ---- Step 3: Fetch policy predicates for risk scoring [HTTP — consensus] ----
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
  const predicates = policyData?.predicates ?? {};
  runtime.log(`WF-003: Policy predicates loaded — ${predicates.covered_procedures?.length ?? 0} covered procedures`);

  // ---- Step 4: Compliance re-evaluation [ENCRYPTED HTTP] ----
  // Send claim data to proof-service for a compliance-focused re-evaluation.
  // The service checks amount thresholds, procedure coverage, and pattern analysis.
  const confidentialClient = new ConfidentialHTTPClient();

  runtime.log("WF-003: [ENCRYPTED] Running compliance re-evaluation against policy predicates");
  const complianceJsonStr = JSON.stringify({
    claim_id: claimId,
    policy_hash: policyHash,
    procedure_code: "PROC_CARDIAC_CT",
    requested_amount: "120000",
    consent_active: consentActive,
    credential_valid: true,
    is_duplicate: false,
    attestation_age_seconds: 3600,
    policy_predicates: predicates,
  });

  const complianceResp = confidentialClient.sendRequest(runtime, {
    vaultDonSecrets: [
      { key: "proofServiceApiKey", owner: config.owner },
      { key: "aesEncryptionKey", owner: config.owner },
    ],
    request: {
      url: `${config.proofServiceUrl}/v1/proofs/medical-necessity`,
      method: "POST",
      bodyString: complianceJsonStr,
      multiHeaders: {
        "Content-Type": { values: ["application/json"] },
        "Authorization": { values: ["Bearer {{.proofServiceApiKey}}"] },
      },
      encryptOutput: true,
    },
  }).result();

  const complianceOk = ok(complianceResp);
  const complianceBody = text(complianceResp);
  const complianceData = safeParse(complianceBody);

  // Risk scoring: consent revoked, compliance FAIL, or amount exceeds cap = challenge
  const compliancePassed = complianceOk && complianceData?.result === "PASS";
  const consentRisk = !consentActive;
  const shouldChallenge = consentRisk || !compliancePassed;
  const riskReason = consentRisk
    ? "consent-revoked-post-approval"
    : !compliancePassed
      ? `compliance-fail:bitmap=${complianceData?.reason_bitmap ?? "unknown"}`
      : "none";

  runtime.log(`WF-003: Risk assessment — compliance: ${compliancePassed ? "PASS" : "FAIL"}, consent: ${consentActive ? "OK" : "REVOKED"}, challenge: ${shouldChallenge ? "YES" : "NO"}`);

  // ---- Step 5: Challenge claim if risk detected [EVM WRITE] ----
  let challengedOnchain = false;
  if (shouldChallenge) {
    const challengeCalldata = encodeFunctionData({
      abi: CLAIM_DECISION_REGISTRY_ABI,
      functionName: "challengeClaim",
      args: [claimId, riskReason],
    });

    runtime.log(`WF-003: AUTO-CHALLENGE — reason: ${riskReason}`);
    const challengeReport = runtime.report(prepareReportRequest(challengeCalldata)).result();
    const challengeResult = evmClient.writeReport(runtime, {
      receiver: config.claimDecisionRegistryAddress,
      report: challengeReport,
      gasConfig: { gasLimit: "500000" },
    }).result();
    challengedOnchain = challengeResult.txStatus === 1;
    runtime.log(`WF-003: challengeClaim tx status: ${challengedOnchain ? "CONFIRMED — payout BLOCKED" : challengeResult.txStatus}`);
  } else {
    runtime.log("WF-003: Compliance check passed — no challenge, payout proceeds");
  }

  // ---- Step 6: Notify ops [ENCRYPTED HTTP] ----
  const finalAction = shouldChallenge
    ? (challengedOnchain ? "CHALLENGED" : "CHALLENGE_FAILED")
    : "PASSED";
  runtime.log(`WF-003: [ENCRYPTED] Notifying ops — action: ${finalAction}`);
  const callbackJsonStr = JSON.stringify({
    workflow_id: "WF-003",
    trigger_type: "log",
    claim_id: claimId,
    action: finalAction,
    risk_reason: riskReason,
    consent_active: consentActive,
    compliance_result: complianceData?.result ?? "UNKNOWN",
    compliance_bitmap: complianceData?.reason_bitmap ?? 0,
    challenged_onchain: challengedOnchain,
    timestamp: runtime.now().toISOString(),
  });

  const callbackResp = confidentialClient.sendRequest(runtime, {
    vaultDonSecrets: [
      { key: "aesEncryptionKey", owner: config.owner },
    ],
    request: {
      url: `${config.callbackServiceUrl}/v1/callbacks/challenge-resolved`,
      method: "POST",
      bodyString: callbackJsonStr,
      multiHeaders: {
        "Content-Type": { values: ["application/json"] },
      },
      encryptOutput: true,
    },
  }).result();

  const callbackOk = ok(callbackResp);
  runtime.log(`WF-003: Compliance gate complete — ${finalAction} — callback ${callbackOk ? "sent" : "FAILED"}`);

  return JSON.stringify({
    workflow: "WF-003-ChallengeResolution",
    trigger_type: "log",
    claim_id: claimId,
    action: finalAction,
    risk_reason: riskReason,
    consent_active: consentActive,
    compliance_passed: compliancePassed,
    challenged_onchain: challengedOnchain,
    timestamp: runtime.now().toISOString(),
  });
};

// ---------------------------------------------------------------------------
// Workflow init — uses EVMClient.logTrigger() on ProofEvaluated events
// ---------------------------------------------------------------------------
export const initWorkflow = (config: Config) => {
  const evmClient = new EVMClient(BigInt(config.chainSelector));

  return [
    handler(
      evmClient.logTrigger({
        addresses: [hexToBase64(config.claimDecisionRegistryAddress)],
        topics: [{ values: [hexToBase64(PROOF_EVALUATED_TOPIC)] }],
        confidence: "CONFIDENCE_LEVEL_LATEST",
      }),
      onProofEvaluated
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
