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

import { encodeFunctionData, decodeFunctionResult, encodePacked, keccak256, stringToHex } from "viem";
// CRE SDK handles transport, signing, and DON consensus; viem handles ABI encoding/decoding only.

// ---------------------------------------------------------------------------
// WF-010 · PriorAuth (v1 consolidated) · HTTP trigger
//
// The real prior-authorization business flow, end-to-end, against the shared
// on-chain backbone. Prior auth is two questions and a payment:
//   "Covered for this member?" → deterministic, adjudicated on-chain:
//       in-network (OrganizationRegistry) + eligible (CoverageRegistry)
//       + plan gates: covered / auth-required / cap (PolicyRegistry, payer-signed)
//   "Medically necessary?"     → judgment over documents, via the confidential
//       AI attester adapter (deterministic fallback while the Attester is gated)
//   Payment → ClaimEscrow, gated on APPROVED.
//
// Rules-first sequencing: if the deterministic coverage rules deny, the claim
// is DENIED without invoking the necessity step (mirrors real PA adjudication).
//
// Trigger: HTTPCapability — signed payload from provider-adapter-api's
//          POST /v1/prior-auth/fhir-submit (FHIR ServiceRequest-shaped intake)
// Contracts touched:
//   READ  — OrganizationRegistry.isInNetwork, CoverageRegistry.isEligible,
//           PolicyRegistry.checkCoverage / getPlanGate / getPlanCommitment
//   WRITE — ClaimDecisionRegistry.submitClaim / setProofResult / markPaid,
//           ClaimEscrow.schedulePayout / releasePayout
// Demo fixtures: sr-knee-mri-0001 (APPROVED→PAID), sr-acupuncture-0002
//   (DENIED: not covered), sr-knee-mri-oon-0003 (DENIED: out-of-network),
//   sr-knee-mri-inelig-0004 (DENIED: ineligible) — see docs/FHIR_SUBSTRATE.md
// Privacy: no PHI on-chain — only hashes, state transitions, and payout events.
//   Clinical resources (FHIR) travel over CRE confidential HTTP only.
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
// Denial reason bitmap (shared vocabulary — see CLAUDE.md)
// ---------------------------------------------------------------------------
const BIT_OUT_OF_NETWORK = 1n << 8n;
const BIT_MEMBER_INELIGIBLE = 1n << 9n;
const BIT_PLAN_INACTIVE = 1n << 10n; // also set on benefit-design hash mismatch

// CPT code → necessity-letter document code (attester adapter convention)
const CPT_TO_LETTER: Record<string, string> = {
  "73721": "PROC_KNEE_MRI",
  "70450": "PROC_CARDIAC_CT",
  "72040": "PROC_SPINE_XRAY",
};

// ---------------------------------------------------------------------------
// Contract ABI Fragments
// CRE compiles each workflow to isolated WASM — no shared imports between
// workflows, so ABI fragments are duplicated per-file.
// ---------------------------------------------------------------------------
const ORGANIZATION_REGISTRY_ABI = [
  {
    name: "isInNetwork",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "providerOrgId", type: "bytes32" },
      { name: "planHash", type: "bytes32" },
      { name: "atTs", type: "uint64" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

const COVERAGE_REGISTRY_ABI = [
  {
    name: "isEligible",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "memberId", type: "bytes32" },
      { name: "planHash", type: "bytes32" },
      { name: "atTs", type: "uint64" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

const POLICY_REGISTRY_ABI = [
  {
    name: "checkCoverage",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "policyHash", type: "bytes32" },
      { name: "procedureKey", type: "bytes32" },
      { name: "amount", type: "uint256" },
      { name: "atTs", type: "uint64" },
    ],
    outputs: [
      { name: "ok", type: "bool" },
      { name: "reasonBitmap", type: "uint256" },
      { name: "authRequired", type: "bool" },
    ],
  },
  {
    name: "getPlanGate",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "policyHash", type: "bytes32" },
      { name: "procedureKey", type: "bytes32" },
    ],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "exists", type: "bool" },
          { name: "covered", type: "bool" },
          { name: "authRequired", type: "bool" },
          { name: "capAmount", type: "uint256" },
        ],
      },
    ],
  },
  {
    name: "getPlanCommitment",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "policyHash", type: "bytes32" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "payerOrgId", type: "bytes32" },
          { name: "benefitDesignHash", type: "bytes32" },
          { name: "signer", type: "address" },
          { name: "signed", type: "bool" },
        ],
      },
    ],
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
  authorizedSignerAddress: string;         // Public key authorized to trigger this workflow
  providerAdapterUrl: string;              // provider-adapter-api base URL (port 3005) — FHIR source
  policyServiceUrl: string;                // policy-service base URL (port 3001) — signed benefit designs
  proofServiceUrl: string;                 // attester-proof-adapter base URL (port 3007) — necessity
  callbackServiceUrl: string;              // decision-callback-service base URL (port 3006)
  owner: string;                           // Workflow owner address — used for CRE registration
  chainSelector: string;                   // EIP-155 chain selector
  organizationRegistryAddress: string;     // Deployed OrganizationRegistry (network membership)
  coverageRegistryAddress: string;         // Deployed CoverageRegistry (member eligibility)
  policyRegistryAddress: string;           // Deployed PolicyRegistry (payer-signed plan + gates)
  claimDecisionRegistryAddress: string;    // Deployed ClaimDecisionRegistry (state machine + proof)
  claimEscrowAddress: string;              // Deployed ClaimEscrow (ERC-20 mock USDC pool)
  creSignerAddress: string;                // DON-controlled signer — has WORKFLOW_ROLE on all contracts
  treasuryAddress: string;                 // Payout recipient — provider's treasury wallet
};

// ---------------------------------------------------------------------------
// Handler: onPriorAuthSubmission
// ---------------------------------------------------------------------------
//   0. [DECODE]      Parse the fhir-submit payload → decision request
//   1. [ENCRYPTED]   Fetch FHIR ServiceRequest + Coverage from provider-adapter
//                    and cross-check them against the submitted payload
//   2. [EVM READ]    isInNetwork (OrganizationRegistry)
//   3. [EVM READ]    isEligible (CoverageRegistry)
//   4. [EVM READ]    checkCoverage — plan active + signed + covered + cap (PolicyRegistry)
//   5. [HTTP]        Verify the off-chain benefit design hash against the on-chain
//                    payer commitment (policy-service ↔ PolicyRegistry)
//   6. [ENCRYPTED]   Medical necessity via attester adapter (fallback-capable)
//                    — only when the deterministic rules pass (rules-first)
//   7. [EVM WRITE]   submitClaim + setProofResult (ClaimDecisionRegistry)
//   8. [EVM WRITE]   If APPROVED: schedulePayout → releasePayout → markPaid
//   9. [ENCRYPTED]   Decision callback to the provider
// ---------------------------------------------------------------------------
export const onPriorAuthSubmission = (
  runtime: Runtime<Config>,
  payload: HTTPPayload
): string => {
  const config = runtime.config;
  const startedAtMs = Date.now();
  runtime.log("WF-010: consolidated prior-auth decision workflow triggered");

  // ---- Step 0: Decode the fhir-submit payload ----
  const rawInput = bytesToString(payload.input);
  const input = safeParse(rawInput);
  if (!input) {
    runtime.log("WF-010: ERROR — failed to parse HTTP payload");
    return JSON.stringify({ workflow: "WF-010-PriorAuth", error: "invalid payload" });
  }

  const correlationId = String(input.correlation_id ?? "wf-010-no-correlation");
  const serviceRequestId = String(input.service_request_id ?? "");
  const patientId = String(input.patient_id ?? "");
  const memberIdString = String(input.member_id ?? "");
  const planHash = (input.plan_hash ?? "0x" + "00".repeat(32)) as `0x${string}`;
  const payerOrgIdString = String(input.payer_org_id ?? "");
  const providerOrgIdString = String(input.provider_org_id ?? "");
  const procedureCode = String(input.procedure_code ?? ""); // bare CPT, e.g. "73721"
  const amountUsdc = BigInt(input.amount_usdc ?? 0);
  const serviceDate = String(input.service_date ?? "");
  const currentTimestamp = BigInt(Math.floor(Date.now() / 1000));

  // Deterministic claim id — the canonical formula (CLAUDE.md):
  // keccak256(payer_id | provider_id_hash | encounter_ref_hash | procedure_code | service_date)
  const payerIdHash = keccak256(stringToHex(payerOrgIdString));
  const providerIdHash = keccak256(stringToHex(providerOrgIdString));
  const encounterRefHash = keccak256(stringToHex(serviceRequestId));
  const claimId = keccak256(
    encodePacked(
      ["bytes32", "bytes32", "bytes32", "string", "string"],
      [payerIdHash, providerIdHash, encounterRefHash, procedureCode, serviceDate]
    )
  );
  const memberId = keccak256(stringToHex(memberIdString));
  const procedureKey = keccak256(stringToHex(`CPT:${procedureCode}`));

  runtime.log(
    `WF-010: ${correlationId} — SR ${serviceRequestId}, CPT ${procedureCode}, amount ${amountUsdc} (USDC-6), claim ${claimId.substring(0, 10)}...`
  );

  // ---- Step 1: Fetch + cross-check FHIR source [ENCRYPTED] ----
  // The workflow does not trust the submitter's flat payload alone: it re-reads
  // the ServiceRequest and Coverage from the FHIR source over confidential HTTP
  // and requires them to corroborate the submission.
  const confidentialClient = new ConfidentialHTTPClient();
  let fhirVerified = false;
  let fhirMismatch = "";

  const srResp = confidentialClient.sendRequest(runtime, {
    vaultDonSecrets: [{ key: "aesEncryptionKey", owner: config.owner }],
    request: {
      url: `${config.providerAdapterUrl}/fhir/r4/ServiceRequest/${serviceRequestId}`,
      method: "GET",
      multiHeaders: { "Accept": { values: ["application/fhir+json"] } },
      encryptOutput: true,
    },
  }).result();

  if (ok(srResp)) {
    const sr = safeParse(text(srResp));
    const srPatient = String(sr?.subject?.reference ?? "");
    const coverageRef = String(sr?.insurance?.[0]?.reference ?? ""); // "Coverage/<id>"
    const coverageId = coverageRef.split("/")[1] ?? "";

    const covResp = confidentialClient.sendRequest(runtime, {
      vaultDonSecrets: [{ key: "aesEncryptionKey", owner: config.owner }],
      request: {
        url: `${config.providerAdapterUrl}/fhir/r4/Coverage/${coverageId}`,
        method: "GET",
        multiHeaders: { "Accept": { values: ["application/fhir+json"] } },
        encryptOutput: true,
      },
    }).result();

    const cov = ok(covResp) ? safeParse(text(covResp)) : null;
    const covPlanHash = String(
      (cov?.class ?? []).find((c: any) => c?.type?.coding?.[0]?.code === "plan")?.value ?? ""
    );
    const covMember = String(cov?.subscriberId ?? "");

    if (!srPatient.endsWith(patientId)) fhirMismatch = "ServiceRequest.subject != patient_id";
    else if (covPlanHash.toLowerCase() !== planHash.toLowerCase()) fhirMismatch = "Coverage plan class != plan_hash";
    else if (covMember !== memberIdString) fhirMismatch = "Coverage.subscriberId != member_id";
    else fhirVerified = true;
  } else {
    fhirMismatch = "ServiceRequest fetch failed";
  }

  runtime.log(`WF-010: [ENCRYPTED] FHIR cross-check: ${fhirVerified ? "VERIFIED" : `FAILED (${fhirMismatch})`}`);

  // ---- Steps 2-4: The deterministic coverage rules, read from shared on-chain state ----
  const evmClient = new EVMClient(BigInt(config.chainSelector));

  const readContract = (to: string, calldata: `0x${string}`) =>
    evmClient.callContract(runtime, {
      call: encodeCallMsg({
        from: config.creSignerAddress as `0x${string}`,
        to: to as `0x${string}`,
        data: calldata,
      }),
      blockNumber: LATEST_BLOCK_NUMBER,
    }).result();

  // Step 2: provider in-network for the member's plan? (OrganizationRegistry)
  const inNetworkResult = readContract(
    config.organizationRegistryAddress,
    encodeFunctionData({
      abi: ORGANIZATION_REGISTRY_ABI,
      functionName: "isInNetwork",
      args: [providerIdHash, planHash, currentTimestamp],
    })
  );
  const inNetwork = decodeFunctionResult({
    abi: ORGANIZATION_REGISTRY_ABI,
    functionName: "isInNetwork",
    data: bytesToHex(inNetworkResult.data),
  }) as boolean;
  runtime.log(`WF-010: [EVM] in-network: ${inNetwork ? "YES" : "NO"}`);

  // Step 3: member eligible / coverage active? (CoverageRegistry)
  const eligibleResult = readContract(
    config.coverageRegistryAddress,
    encodeFunctionData({
      abi: COVERAGE_REGISTRY_ABI,
      functionName: "isEligible",
      args: [memberId, planHash, currentTimestamp],
    })
  );
  const eligible = decodeFunctionResult({
    abi: COVERAGE_REGISTRY_ABI,
    functionName: "isEligible",
    data: bytesToHex(eligibleResult.data),
  }) as boolean;
  runtime.log(`WF-010: [EVM] member eligible: ${eligible ? "YES" : "NO"}`);

  // Step 4: benefit adjudication against the payer-signed plan gates (PolicyRegistry)
  const coverageCheckResult = readContract(
    config.policyRegistryAddress,
    encodeFunctionData({
      abi: POLICY_REGISTRY_ABI,
      functionName: "checkCoverage",
      args: [planHash, procedureKey, amountUsdc, currentTimestamp],
    })
  );
  const [benefitOk, planReasonBitmap, authRequired] = decodeFunctionResult({
    abi: POLICY_REGISTRY_ABI,
    functionName: "checkCoverage",
    data: bytesToHex(coverageCheckResult.data),
  }) as [boolean, bigint, boolean];
  runtime.log(
    `WF-010: [EVM] plan gates: ${benefitOk ? "COVERED" : `DENIED (bitmap ${planReasonBitmap})`}${authRequired ? " — prior auth required" : ""}`
  );

  const gateResult = readContract(
    config.policyRegistryAddress,
    encodeFunctionData({
      abi: POLICY_REGISTRY_ABI,
      functionName: "getPlanGate",
      args: [planHash, procedureKey],
    })
  );
  const planGate = decodeFunctionResult({
    abi: POLICY_REGISTRY_ABI,
    functionName: "getPlanGate",
    data: bytesToHex(gateResult.data),
  }) as { exists: boolean; covered: boolean; authRequired: boolean; capAmount: bigint };

  // ---- Step 5: Verify the off-chain benefit design against the on-chain commitment ----
  const commitmentResult = readContract(
    config.policyRegistryAddress,
    encodeFunctionData({
      abi: POLICY_REGISTRY_ABI,
      functionName: "getPlanCommitment",
      args: [planHash],
    })
  );
  const planCommitment = decodeFunctionResult({
    abi: POLICY_REGISTRY_ABI,
    functionName: "getPlanCommitment",
    data: bytesToHex(commitmentResult.data),
  }) as { payerOrgId: `0x${string}`; benefitDesignHash: `0x${string}`; signer: string; signed: boolean };

  const httpClient = new HTTPClient();
  const benefitDesignBody = httpClient.sendRequest(
    runtime,
    (sendRequester) => {
      const resp = sendRequester.sendRequest({
        url: `${config.policyServiceUrl}/v1/plans/${planHash}/benefit-design`,
        method: "GET",
        multiHeaders: { "Content-Type": { values: ["application/json"] } },
        timeout: "10s",
      }).result();
      return text(resp);
    },
    consensusIdenticalAggregation<string>()
  )().result();

  const benefitDesignHash = keccak256(stringToHex(benefitDesignBody.trim()));
  const benefitDesignVerified =
    planCommitment.signed && benefitDesignHash.toLowerCase() === planCommitment.benefitDesignHash.toLowerCase();
  runtime.log(
    `WF-010: benefit design ${benefitDesignVerified ? "VERIFIED against payer-signed on-chain commitment" : "MISMATCH vs on-chain commitment"} (payer ${planCommitment.payerOrgId.substring(0, 10)}..., signer ${planCommitment.signer.substring(0, 10)}...)`
  );

  // ---- Compose the deterministic ruling ----
  let rulesBitmap = planReasonBitmap;
  if (!inNetwork) rulesBitmap |= BIT_OUT_OF_NETWORK;
  if (!eligible) rulesBitmap |= BIT_MEMBER_INELIGIBLE;
  if (!benefitDesignVerified) rulesBitmap |= BIT_PLAN_INACTIVE;
  const rulesPass = rulesBitmap === 0n && fhirVerified;

  // ---- Step 6: Medical necessity — only when the rules pass (rules-first) ----
  let necessityOk = false;
  let proofHash = keccak256(
    stringToHex(JSON.stringify({ claim_id: claimId, denied_by: "coverage-rules", bitmap: rulesBitmap.toString() }))
  ) as `0x${string}`;
  let necessitySource = "skipped (deterministic rules denied)";
  let reasonBitmap = rulesBitmap;

  if (rulesPass) {
    const letterCode = CPT_TO_LETTER[procedureCode] ?? procedureCode;
    const amountDollars = (Number(amountUsdc) / 1e6).toFixed(0);
    const capDollars = Number(planGate.capAmount / 1_000_000n);

    runtime.log(`WF-010: [ENCRYPTED] medical necessity — ${letterCode}, $${amountDollars} (attester adapter, fallback-capable)`);
    const proofResp = confidentialClient.sendRequest(runtime, {
      vaultDonSecrets: [
        { key: "proofServiceApiKey", owner: config.owner },
        { key: "aesEncryptionKey", owner: config.owner },
      ],
      request: {
        url: `${config.proofServiceUrl}/v1/proofs/medical-necessity`,
        method: "POST",
        bodyString: JSON.stringify({
          claim_id: claimId,
          policy_hash: planHash,
          procedure_code: letterCode,
          requested_amount: amountDollars,
          consent_active: true,
          credential_valid: true,
          is_duplicate: false,
          attestation_age_seconds: 3600,
          policy_predicates: {
            covered_procedures: [letterCode],
            amount_caps: { [letterCode]: capDollars },
            attestation_max_age_seconds: 86400,
          },
        }),
        multiHeaders: {
          "Content-Type": { values: ["application/json"] },
          "Authorization": { values: ["Bearer {{.proofServiceApiKey}}"] },
        },
        encryptOutput: true,
      },
    }).result();

    const proofData = ok(proofResp) ? safeParse(text(proofResp)) : null;
    necessityOk = proofData?.result === "PASS";
    necessitySource = String(proofData?.attester?.verdict_source ?? "unknown");
    if (proofData?.proof_hash) proofHash = proofData.proof_hash as `0x${string}`;
    if (!necessityOk) reasonBitmap |= BigInt(proofData?.reason_bitmap ?? "1");
    runtime.log(`WF-010: [ENCRYPTED] necessity: ${necessityOk ? "ESTABLISHED" : "NOT ESTABLISHED"} (source: ${necessitySource})`);
  }

  const approved = rulesPass && necessityOk;
  const decisionState = approved ? "APPROVED" : "DENIED";

  // ---- Step 7: Record the decision on-chain [EVM WRITE] ----
  const writeContract = (receiver: string, calldata: `0x${string}`, label: string) => {
    const report = runtime.report(prepareReportRequest(calldata)).result();
    const result = evmClient.writeReport(runtime, {
      receiver,
      report,
      gasConfig: { gasLimit: "500000" },
    }).result();
    runtime.log(`WF-010: ${label} — tx status: ${result.txStatus === 1 ? "CONFIRMED" : result.txStatus}`);
    return result;
  };

  runtime.log(`WF-010: DECISION: ${decisionState} — bitmap ${reasonBitmap === 0n ? "0 (no denial flags)" : reasonBitmap}`);
  writeContract(
    config.claimDecisionRegistryAddress,
    encodeFunctionData({ abi: CLAIM_DECISION_REGISTRY_ABI, functionName: "submitClaim", args: [claimId, planHash] }),
    "claim submitted on-chain"
  );
  writeContract(
    config.claimDecisionRegistryAddress,
    encodeFunctionData({
      abi: CLAIM_DECISION_REGISTRY_ABI,
      functionName: "setProofResult",
      args: [claimId, proofHash, reasonBitmap, approved],
    }),
    "proof result recorded on-chain"
  );

  // ---- Step 8: If APPROVED, money moves — escrow gated on the on-chain decision ----
  if (approved) {
    writeContract(
      config.claimEscrowAddress,
      encodeFunctionData({
        abi: CLAIM_ESCROW_ABI,
        functionName: "schedulePayout",
        args: [claimId, config.treasuryAddress as `0x${string}`, amountUsdc],
      }),
      "payout scheduled"
    );
    writeContract(
      config.claimEscrowAddress,
      encodeFunctionData({ abi: CLAIM_ESCROW_ABI, functionName: "releasePayout", args: [claimId] }),
      "payout released (ERC-20 transfer)"
    );
    writeContract(
      config.claimDecisionRegistryAddress,
      encodeFunctionData({ abi: CLAIM_DECISION_REGISTRY_ABI, functionName: "markPaid", args: [claimId] }),
      "claim marked PAID (terminal)"
    );
  }

  // ---- Step 9: Decision callback [ENCRYPTED] ----
  const decisionLatencyMs = Date.now() - startedAtMs;
  const callbackResp = confidentialClient.sendRequest(runtime, {
    vaultDonSecrets: [{ key: "aesEncryptionKey", owner: config.owner }],
    request: {
      url: `${config.callbackServiceUrl}/v1/callbacks/prior-auth-decision`,
      method: "POST",
      bodyString: JSON.stringify({
        claim_id: claimId,
        correlation_id: correlationId,
        decision_state: decisionState,
        reason_bitmap: reasonBitmap.toString(),
        workflow_id: "WF-010",
      }),
      multiHeaders: { "Content-Type": { values: ["application/json"] } },
      encryptOutput: true,
    },
  }).result();
  runtime.log(`WF-010: callback delivered: ${decisionState} — ${ok(callbackResp) ? "sent" : "FAILED"}`);

  // Instrumented for the efficiency claim: decision latency measured, not asserted.
  return JSON.stringify({
    workflow: "WF-010-PriorAuth",
    correlation_id: correlationId,
    claim_id: claimId,
    service_request_id: serviceRequestId,
    decision_state: decisionState,
    reason_bitmap: reasonBitmap.toString(),
    checks: {
      fhir_source_verified: fhirVerified,
      in_network: inNetwork,
      member_eligible: eligible,
      benefit_adjudication_ok: benefitOk,
      auth_required: authRequired,
      benefit_design_verified: benefitDesignVerified,
      necessity_established: necessityOk,
      necessity_source: necessitySource,
    },
    decision_latency_ms: decisionLatencyMs,
    timestamp: runtime.now().toISOString(),
  });
};

// ---------------------------------------------------------------------------
// Workflow init
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
      onPriorAuthSubmission
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
