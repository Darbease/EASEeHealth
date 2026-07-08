// ---------------------------------------------------------------------------
// attester-proof-adapter
//
// Drop-in replacement for proof-service-stub at the WF seam. Exposes the same
// POST /v1/proofs/medical-necessity contract, but the verdict comes from the
// Confidential AI Attester (LLM-in-TEE) reasoning over a clinical document —
// and `proof_hash` is the Attester's signed response_digest, not a fixture.
//
// On any attester failure it falls back to the deterministic policy evaluator
// (identical to proof-service-stub) so the demo always settles.
// ---------------------------------------------------------------------------
import express, { type RequestHandler } from "express";
import { correlationMiddleware, logger } from "@proofpa/observability";
import { z } from "zod";
import { keccak256, encodePacked, toHex } from "viem";
import { randomUUID } from "node:crypto";
import { CLINICAL } from "@proofpa/schemas";
import { loadConfig } from "./config.js";
import { resolveLettersDir, loadNecessityLetter } from "./documents.js";
import {
  evaluatePolicyBits,
  decodeBitmap,
  POLICY_BITS_MASK,
  BIT_CREDENTIAL_INVALID,
  BIT_PROCEDURE_NOT_COVERED,
  BIT_AMOUNT_EXCEEDS_CAP,
  BIT_CONSENT_INVALID,
  BIT_DUPLICATE_NULLIFIER,
  BIT_STALE_ATTESTATION,
  BIT_MEDICAL_NECESSITY,
} from "./bitmap.js";
import { runInference } from "./attester-client.js";
import { verifyEip712Signature, AttesterAttestationTypes, buildProofpaDomain } from "@proofpa/eip712-types";

const config = loadConfig();
const lettersDir = resolveLettersDir(config.lettersDir);

const app = express();
app.use(express.json({ limit: "2mb" }));
// correlationMiddleware is typed against the shared package's express copy — cast to this service's handler type.
app.use(correlationMiddleware as unknown as RequestHandler);

const Bytes32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/);

const ProofRequestSchema = z.object({
  claim_id: Bytes32,
  policy_hash: Bytes32,
  procedure_code: z.string().optional(),
  requested_amount: z.string().optional(),
  medication_code: z.string().optional(),
  medication_amount: z.string().optional(),
  consent_active: z.boolean().optional(),
  credential_valid: z.boolean().optional(),
  is_duplicate: z.boolean().optional(),
  attestation_age_seconds: z.number().optional(),
  policy_predicates: z
    .object({
      covered_procedures: z.array(z.string()).optional(),
      amount_caps: z.record(z.string(), z.number()).optional(),
      attestation_max_age_seconds: z.number().optional(),
      formulary: z
        .object({
          covered_medications: z.array(z.string()).optional(),
          medication_caps: z.record(z.string(), z.number()).optional(),
        })
        .optional(),
    })
    .optional(),
});

type Hex32 = `0x${string}`;

/** Normalise an attester digest to a bytes32; coerce by keccak if it isn't clean 32-byte hex. */
function coerceBytes32(s: string): Hex32 {
  const h = s.startsWith("0x") ? s.slice(2) : s;
  if (/^[0-9a-fA-F]{64}$/.test(h)) return `0x${h.toLowerCase()}` as Hex32;
  return keccak256(toHex(s));
}

interface PredicateCheck {
  check: string;
  status: "PASS" | "FAIL";
  detail: string;
}

function buildPredicateChecks(
  bitmap: number,
  procCode: string,
  requestedAmt: number,
  capForProc: number | undefined,
  proc: { description: string; cpt: string } | undefined,
  source: "attester" | "fallback",
  reason: string,
): PredicateCheck[] {
  const has = (bit: number) => (bitmap & bit) !== 0;
  const amt = CLINICAL.formatAmount(requestedAmt);
  const cap = capForProc !== undefined ? CLINICAL.formatAmount(capForProc) : "plan cap";
  return [
    {
      check: "Provider credential",
      status: has(BIT_CREDENTIAL_INVALID) ? "FAIL" : "PASS",
      detail: has(BIT_CREDENTIAL_INVALID) ? "Credential invalid or expired" : "Active NPI in network",
    },
    {
      check: "Procedure coverage",
      status: has(BIT_PROCEDURE_NOT_COVERED) ? "FAIL" : "PASS",
      detail: has(BIT_PROCEDURE_NOT_COVERED)
        ? `${procCode} not covered under plan`
        : `${proc?.description ?? procCode} (CPT ${proc?.cpt ?? "N/A"}) covered under plan`,
    },
    {
      check: "Amount within cap",
      status: has(BIT_AMOUNT_EXCEEDS_CAP) ? "FAIL" : "PASS",
      detail: has(BIT_AMOUNT_EXCEEDS_CAP) ? `${amt} exceeds ${cap} cap` : `${amt} within ${cap} plan cap`,
    },
    {
      check: "Patient consent",
      status: has(BIT_CONSENT_INVALID) ? "FAIL" : "PASS",
      detail: has(BIT_CONSENT_INVALID) ? "Consent invalid or revoked" : "Data sharing consent ACTIVE",
    },
    {
      check: "Duplicate check",
      status: has(BIT_DUPLICATE_NULLIFIER) ? "FAIL" : "PASS",
      detail: has(BIT_DUPLICATE_NULLIFIER) ? "Duplicate claim detected" : "No prior claim for this encounter",
    },
    {
      check: "Attestation freshness",
      status: has(BIT_STALE_ATTESTATION) ? "FAIL" : "PASS",
      detail: has(BIT_STALE_ATTESTATION) ? "Attestation exceeds freshness window" : "Attestation within freshness window",
    },
    {
      check: "Medical necessity (AI attester)",
      status: has(BIT_MEDICAL_NECESSITY) ? "FAIL" : "PASS",
      detail:
        source === "attester"
          ? reason || (has(BIT_MEDICAL_NECESSITY) ? "Necessity not established from document" : "Necessity established from document")
          : "Necessity inferred by deterministic fallback (attester unavailable)",
    },
  ];
}

app.post("/v1/proofs/medical-necessity", async (req, res) => {
  const parsed = ProofRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    return;
  }
  const data = parsed.data;
  const correlationId = (req as unknown as { correlationId?: string }).correlationId;

  const procCode = data.procedure_code ?? "PROC_KNEE_MRI";
  const requestedAmt = parseInt(data.requested_amount ?? "85000");
  const caps = data.policy_predicates?.amount_caps ?? { PROC_KNEE_MRI: 100000 };
  const coveredProcs = data.policy_predicates?.covered_procedures ?? ["PROC_KNEE_MRI"];
  const capForProc = caps[procCode];

  // Structured policy/operational bits (0..7) — identical to proof-service-stub.
  const policyBits = evaluatePolicyBits({
    credential_valid: data.credential_valid ?? true,
    procedure_code: procCode,
    covered_procedures: coveredProcs,
    requested_amount: requestedAmt,
    amount_caps: caps,
    consent_active: data.consent_active ?? true,
    is_duplicate: data.is_duplicate ?? false,
    attestation_age_seconds: data.attestation_age_seconds ?? 3600,
    attestation_max_age_seconds: data.policy_predicates?.attestation_max_age_seconds ?? 86400,
    medication_code: data.medication_code,
    medication_amount: data.medication_amount ? parseInt(data.medication_amount) : undefined,
    covered_medications: data.policy_predicates?.formulary?.covered_medications,
    medication_caps: data.policy_predicates?.formulary?.medication_caps,
  });

  // Resolve the unstructured document and ask the TEE attester to reason over it.
  const doc = loadNecessityLetter(procCode, lettersDir);
  const inference = await runInference(
    {
      procedureCode: procCode,
      requestedAmount: requestedAmt,
      coveredProcedures: coveredProcs,
      amountCap: capForProc,
      document: { content: doc.content, filename: doc.filename },
    },
    config,
  );
  const verdict = inference.verdict;
  if (!verdict && config.inferenceApiKey) {
    logger.warn(
      { correlation_id: correlationId, claim_id: data.claim_id, diagnostic: inference.diagnostic },
      "attester unavailable — using deterministic fallback",
    );
  }

  const proof_id = `proof_${randomUUID().replace(/-/g, "")}`;
  const claimId = data.claim_id as Hex32;
  const policyHash = data.policy_hash as Hex32;

  let bitmap = policyBits;
  let approved: boolean;
  let source: "attester" | "fallback";
  let reason: string;
  let proof_hash: Hex32;
  let public_inputs_hash: Hex32;

  if (verdict) {
    source = "attester";
    reason = verdict.reason;
    if (verdict.predicates.procedure_covered === false) bitmap |= BIT_PROCEDURE_NOT_COVERED;
    if (verdict.predicates.amount_within_cap === false) bitmap |= BIT_AMOUNT_EXCEEDS_CAP;
    const necessityOk = verdict.approved === true && verdict.predicates.necessity_established !== false;
    if (!necessityOk) bitmap |= BIT_MEDICAL_NECESSITY;
    approved = necessityOk && (bitmap & POLICY_BITS_MASK) === 0;

    // The signed response digest IS the on-chain proof hash (real provenance).
    proof_hash = verdict.responseDigest
      ? coerceBytes32(verdict.responseDigest)
      : keccak256(encodePacked(["string", "string", "uint256"], [proof_id, approved ? "PASS" : "FAIL", BigInt(bitmap)]));
    public_inputs_hash = verdict.requestDigest
      ? coerceBytes32(verdict.requestDigest)
      : keccak256(encodePacked(["bytes32", "bytes32"], [claimId, policyHash]));
  } else {
    // Deterministic fallback — mirrors proof-service-stub exactly.
    source = "fallback";
    approved = (bitmap & POLICY_BITS_MASK) === 0;
    reason = approved
      ? "Approved by deterministic policy evaluation (attester unavailable)"
      : decodeBitmap(bitmap).join("; ");
    proof_hash = keccak256(encodePacked(["string", "string", "uint256"], [proof_id, approved ? "PASS" : "FAIL", BigInt(bitmap)]));
    public_inputs_hash = keccak256(encodePacked(["bytes32", "bytes32"], [claimId, policyHash]));
  }

  const result: "PASS" | "FAIL" = approved ? "PASS" : "FAIL";

  // Phase 3: if the attester signed an EIP-712 AttesterAttestation and we know its
  // signer address, verify it on the way through. null when no signature/signer.
  let attestationVerified: boolean | null = null;
  if (verdict?.signature && config.attesterSignerAddress) {
    try {
      attestationVerified = await verifyEip712Signature(
        AttesterAttestationTypes as unknown as Record<string, Array<{ name: string; type: string }>>,
        "AttesterAttestation",
        { claim_id: claimId, request_digest: public_inputs_hash, response_digest: proof_hash, result, reason_bitmap: BigInt(bitmap) },
        verdict.signature as `0x${string}`,
        config.attesterSignerAddress as `0x${string}`,
        buildProofpaDomain(config.chainId),
      );
    } catch {
      attestationVerified = false;
    }
  }

  const proc = CLINICAL.procedures[procCode];
  const predicateChecks = buildPredicateChecks(bitmap, procCode, requestedAmt, capForProc, proc, source, reason);
  const passCount = predicateChecks.filter((c) => c.status === "PASS").length;
  const denial_reasons = bitmap > 0 ? decodeBitmap(bitmap) : [];

  logger.info(
    {
      correlation_id: correlationId,
      claim_id: data.claim_id,
      result,
      reason_bitmap: bitmap,
      verdict_source: source,
      proof_hash,
    },
    `Attester proof: ${proc?.description ?? procCode} — ${result} (${source}, ${passCount}/${predicateChecks.length} predicates)`,
  );

  res.json({
    proof_id,
    proof_hash,
    public_inputs_hash,
    result,
    reason_bitmap: String(bitmap),
    clinical_context: {
      predicate_checks: predicateChecks,
      checks_passed: passCount,
      checks_total: predicateChecks.length,
      denial_reasons,
    },
    // Additive provenance block — ignored by existing consumers; used in Phase 2/3.
    attester: {
      verdict_source: source,
      model: verdict?.model ?? null,
      reason,
      confidence: verdict?.confidence ?? null,
      risk_level: verdict?.risk_level ?? null,
      request_digest: verdict?.requestDigest ?? null,
      response_digest: verdict?.responseDigest ?? null,
      document_digest: verdict?.documentDigest ?? null,
      document: doc.filename,
      signature: verdict?.signature ?? null,
      attester_key_hash: verdict?.attesterKeyHash ?? null,
      attestation_verified: attestationVerified,
    },
  });
});

app.get("/healthz", (_req, res) => res.json({ status: "ok", attester: config.inferenceApiKey ? "configured" : "fallback-only" }));

app.listen(config.port, () =>
  logger.info(
    { port: config.port, attester: config.inferenceApiKey ? "live" : "fallback-only", lettersDir },
    "attester-proof-adapter started",
  ),
);

export default app;
