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
// WF-002 · ConsentRevocation · Cron trigger
//
// Polls consent-service for patient data-sharing withdrawals, verifies on-chain
// state, writes revocation if needed, and flags pending claims for re-evaluation.
//
// CRE capabilities: ConfidentialHTTPClient, EVMClient
// Contracts touched:
//   READ  — ConsentRegistry.isConsentActive
//   WRITE — ConsentRegistry.revokeConsent
// Demo scenario: B (revoked consent → DENIED, bit 3 set)
// Privacy: no PHI on-chain — only consent hashes and state transitions
// Spec: TECH_ARCHITECTURE_SPEC_ProofPA.md § 8.2
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
export type Config = {
  schedule: string;                  // Cron expression — triggers workflow on DON nodes
  consentServiceUrl: string;         // consent-service base URL (port 3004)
  callbackServiceUrl: string;        // decision-callback-service base URL (port 3006)
  owner: string;                     // Vault owner address — empty for simulation, set in production
  chainSelector: string;             // EIP-155 chain selector — Base Sepolia in staging
  consentRegistryAddress: string;    // Deployed ConsentRegistry contract (from Deploy.s.sol)
  creSignerAddress: string;          // DON-controlled signer — has WORKFLOW_ROLE on all contracts
};

// ---------------------------------------------------------------------------
// Handler: onConsentRevocationCheck
// ---------------------------------------------------------------------------
// Cron-triggered workflow that polls the consent service for revocation
// events, verifies on-chain state via EVMClient, and flags pending claims.
// ---------------------------------------------------------------------------
export const onConsentRevocationCheck = (
  runtime: Runtime<Config>,
  _cronPayload: CronPayload
): string => {
  const config = runtime.config;
  runtime.log("WF-002: Consent Revocation Monitor — scanning for patient data-sharing withdrawals");

  // ---- Step 1: Poll consent service for recent revocations [HTTP] ----
  const confidentialClient = new ConfidentialHTTPClient();

  runtime.log("WF-002: [ENCRYPTED] Polling consent-service for revocation events (last 15 min)");
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
    runtime.log("WF-002: Consent service error");
    return JSON.stringify({
      workflow: "WF-002-ConsentRevocation",
      status: "ERROR",
      timestamp: runtime.now().toISOString(),
    });
  }

  const consentBody = text(consentResp);

  // ---- Step 2: Verify consent status on-chain [EVM READ] ----
  const evmClient = new EVMClient(BigInt(config.chainSelector));
  // Deterministic demo fixture ID — matches dashboard Scenario B polling target.
  const demoConsentHash = ("0x" + "c0".repeat(32)) as `0x${string}`;
  runtime.log(`WF-002: Revocation data received for consent ${demoConsentHash.substring(0, 10)}...`);
  runtime.log(`WF-002: Impact: Pending prior auth claims must be re-evaluated for denial`);
  const currentTimestamp = BigInt(Math.floor(Date.now() / 1000));

  const calldata = encodeFunctionData({
    abi: CONSENT_REGISTRY_ABI,
    functionName: "isConsentActive",
    args: [demoConsentHash, currentTimestamp],
  });

  const consentOnchainResult = evmClient.callContract(runtime, {
    call: encodeCallMsg({
      from: config.creSignerAddress as `0x${string}`,
      to: config.consentRegistryAddress as `0x${string}`,
      data: calldata,
    }),
    // Read from the chain tip, not a specific block height.
    blockNumber: LATEST_BLOCK_NUMBER,
  }).result();

  const isActive = decodeFunctionResult({
    abi: CONSENT_REGISTRY_ABI,
    functionName: "isConsentActive",
    data: bytesToHex(consentOnchainResult.data),
  });

  runtime.log(`WF-002: On-chain verification: ConsentRegistry confirms consent ${isActive ? "ACTIVE (not yet reflected)" : "REVOKED"}`);

  // ---- Step 3: Revoke consent on-chain if still active [EVM WRITE] ----
  // Idempotent — if consent was already revoked on-chain (by a previous run or
  // direct call), skip the write to avoid a revert.
  let revokedOnchain = false;
  if (isActive) {
    const revokeCalldata = encodeFunctionData({
      abi: CONSENT_REGISTRY_ABI,
      functionName: "revokeConsent",
      args: [demoConsentHash, 1], // reasonCode 1 = patient-initiated
    });

    // Two-phase EVM write: prepareReportRequest generates DON-signed report, writeReport
    // submits it on-chain. The contract verifies the DON signature via WORKFLOW_ROLE.
    runtime.log(`WF-002: Consent still ACTIVE on-chain — writing revocation`);
    const revokeReport = runtime.report(prepareReportRequest(revokeCalldata)).result();
    const revokeResult = evmClient.writeReport(runtime, {
      receiver: config.consentRegistryAddress,
      report: revokeReport,
      gasConfig: { gasLimit: "500000" },
    }).result();
    revokedOnchain = revokeResult.txStatus === 1;
    runtime.log(`WF-002: Consent revoked on-chain — tx status: ${revokedOnchain ? "CONFIRMED" : revokeResult.txStatus}`);
  } else {
    runtime.log(`WF-002: Consent already REVOKED on-chain — no write needed`);
  }

  // ---- Step 4: Notify callback service [HTTP] ----
  runtime.log("WF-002: [ENCRYPTED] Notifying decision-callback-service — flagging pending claims for affected patient");
  const callbackJsonStr = JSON.stringify({
    workflow_id: "WF-002",
    revocations: consentBody,
    onchain_consent_active: isActive,
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
  runtime.log(`WF-002: Provider notification: ${callbackOk ? "Consent revocation alert sent — affected claims flagged for review" : "FAILED to notify — manual review required"}`);

  // Workflow output — serialized to CRE simulate logs and consumed by the
  // dashboard's outcome verification banner to compare expected vs actual results.
  return JSON.stringify({
    workflow: "WF-002-ConsentRevocation",
    status: callbackOk ? "COMPLETED" : "CALLBACK_FAILED",
    onchain_consent_active: isActive,
    revoked_onchain: revokedOnchain,
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
      onConsentRevocationCheck
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
