import express from "express"
import { correlationMiddleware, logger } from "@proofpa/observability"
import { z } from "zod"
import { evaluatePredicates } from "./logic/predicate-evaluator.js"
import { keccak256, encodePacked } from "viem"
import { randomUUID } from "node:crypto"
import { CLINICAL } from "@proofpa/schemas"

const app = express()
app.use(express.json())
app.use(correlationMiddleware)

const Bytes32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/)

const ProofRequestSchema = z.object({
  claim_id: Bytes32,
  policy_hash: Bytes32,
  procedure_code: z.string().optional(),
  requested_amount: z.string().optional(),
  consent_active: z.boolean().optional(),
  credential_valid: z.boolean().optional(),
  is_duplicate: z.boolean().optional(),
  attestation_age_seconds: z.number().optional(),
  policy_predicates: z.object({
    covered_procedures: z.array(z.string()).optional(),
    amount_caps: z.record(z.string(), z.number()).optional(),
    attestation_max_age_seconds: z.number().optional(),
  }).optional(),
})

app.post("/v1/proofs/medical-necessity", (req, res) => {
  const parsed = ProofRequestSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.issues })
    return
  }

  const data = parsed.data
  const procCode = data.procedure_code ?? "PROC_KNEE_MRI"
  const requestedAmt = parseInt(data.requested_amount ?? "85000")
  const proc = CLINICAL.procedures[procCode]
  const caps = data.policy_predicates?.amount_caps ?? { PROC_KNEE_MRI: 100000 }
  const capForProc = caps[procCode] ?? 0

  const evalResult = evaluatePredicates({
    credential_valid: data.credential_valid ?? true,
    procedure_code: procCode,
    covered_procedures: data.policy_predicates?.covered_procedures ?? ["PROC_KNEE_MRI"],
    requested_amount: requestedAmt,
    amount_caps: caps,
    consent_active: data.consent_active ?? true,
    is_duplicate: data.is_duplicate ?? false,
    attestation_age_seconds: data.attestation_age_seconds ?? 3600,
    attestation_max_age_seconds: data.policy_predicates?.attestation_max_age_seconds ?? 86400,
  })

  const proof_id = `proof_${randomUUID().replace(/-/g, "")}`
  const proof_hash = keccak256(
    encodePacked(["string", "string", "uint256"], [proof_id, evalResult.result, BigInt(evalResult.reason_bitmap)])
  )
  const public_inputs_hash = keccak256(
    encodePacked(["bytes32", "bytes32"], [data.claim_id as `0x${string}`, data.policy_hash as `0x${string}`])
  )

  const bitmap = evalResult.reason_bitmap
  const passCount = 6 - CLINICAL.decodeBitmap(bitmap).length
  const attestAge = data.attestation_age_seconds ?? 3600
  const attestMax = data.policy_predicates?.attestation_max_age_seconds ?? 86400

  const predicateChecks = [
    { check: "Provider credential", status: (bitmap & 1) ? "FAIL" : "PASS", detail: (bitmap & 1) ? "Credential invalid or expired" : "Active NPI in network" },
    { check: "Procedure coverage", status: (bitmap & 2) ? "FAIL" : "PASS", detail: (bitmap & 2) ? `${procCode} not covered under plan` : `${proc?.description ?? procCode} (CPT ${proc?.cpt ?? "N/A"}) covered under plan` },
    { check: "Amount within cap", status: (bitmap & 4) ? "FAIL" : "PASS", detail: (bitmap & 4) ? `${CLINICAL.formatAmount(requestedAmt)} exceeds ${CLINICAL.formatAmount(capForProc)} cap` : `${CLINICAL.formatAmount(requestedAmt)} within ${CLINICAL.formatAmount(capForProc)} plan cap` },
    { check: "Patient consent", status: (bitmap & 8) ? "FAIL" : "PASS", detail: (bitmap & 8) ? "Consent invalid or revoked" : "Data sharing consent ACTIVE" },
    { check: "Duplicate check", status: (bitmap & 16) ? "FAIL" : "PASS", detail: (bitmap & 16) ? "Duplicate claim detected" : "No prior claim for this encounter" },
    { check: "Attestation freshness", status: (bitmap & 32) ? "FAIL" : "PASS", detail: (bitmap & 32) ? `Attestation age ${Math.floor(attestAge / 3600)}h exceeds ${Math.floor(attestMax / 3600)}h window` : `Attestation age ${Math.floor(attestAge / 3600)}h within ${Math.floor(attestMax / 3600)}h window` },
  ]

  logger.info({
    correlation_id: req.correlationId,
    claim_id: data.claim_id,
    result: evalResult.result,
    reason_bitmap: evalResult.reason_bitmap,
  }, proc
    ? `Proof evaluation: ${proc.description} (CPT ${proc.cpt}) — ${evalResult.result} (${passCount}/6 predicates passed)`
    : `Proof evaluation complete: ${evalResult.result} (${passCount}/6 predicates passed)`
  )

  res.json({
    proof_id,
    proof_hash,
    public_inputs_hash,
    result: evalResult.result,
    reason_bitmap: String(evalResult.reason_bitmap),
    clinical_context: {
      predicate_checks: predicateChecks,
      checks_passed: passCount,
      checks_total: 6,
      denial_reasons: bitmap > 0 ? CLINICAL.decodeBitmap(bitmap) : [],
    },
  })
})

app.get("/healthz", (_req, res) => res.json({ status: "ok" }))

const PORT = parseInt(process.env.PORT ?? "3003")
app.listen(PORT, () => logger.info({ port: PORT }, "proof-service-stub started"))

export default app
