import express from "express"
import { correlationMiddleware, logger, emitEvent } from "@proofpa/observability"
import { z } from "zod"
import { keccak256, encodePacked } from "viem"
import { randomUUID } from "node:crypto"
import { CLINICAL } from "@proofpa/schemas"

const app = express()
app.use(express.json())
app.use(correlationMiddleware)

const Bytes32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/)

const PriorAuthSubmitSchema = z.object({
  request_id: z.string().uuid(),
  payer_id: z.string().min(1),
  provider_id_hash: Bytes32,
  encounter_ref_hash: Bytes32,
  procedure_code: z.string().min(1),
  requested_amount: z.string().min(1),
  currency: z.string().default("USDC_6"),
  consent_id: Bytes32,
  attestation_jws: z.string().min(1),
  service_date: z.string().min(1),
  callback_url: z.string().url().optional(),
  nonce: z.string().optional(),
  issued_at: z.string().optional(),
  expires_at: z.string().optional(),
  signature: z.string().optional(),
})

function computeClaimId(
  payerId: string,
  providerIdHash: `0x${string}`,
  encounterRefHash: `0x${string}`,
  procedureCode: string,
  serviceDate: string,
): `0x${string}` {
  return keccak256(
    encodePacked(
      ["string", "bytes32", "bytes32", "string", "string"],
      [payerId, providerIdHash, encounterRefHash, procedureCode, serviceDate],
    ),
  )
}

app.post("/v1/prior-auth/submit", (req, res) => {
  const parsed = PriorAuthSubmitSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.issues })
    return
  }

  const data = parsed.data
  const claim_id = computeClaimId(
    data.payer_id,
    data.provider_id_hash as `0x${string}`,
    data.encounter_ref_hash as `0x${string}`,
    data.procedure_code,
    data.service_date,
  )
  const workflow_id = `wf_${randomUUID().replace(/-/g, "")}`

  const proc = CLINICAL.procedures[data.procedure_code]
  const provider = CLINICAL.scenarioProvider(data.procedure_code)
  const patient = CLINICAL.scenarioPatient(data.procedure_code)

  emitEvent({
    correlation_id: req.correlationId,
    claim_id,
    workflow_id,
    stage: "prior_auth_submitted",
    status: "success",
    metadata: {
      request_id: data.request_id,
      payer_id: data.payer_id,
      procedure_code: data.procedure_code,
      requested_amount: data.requested_amount,
    },
  })

  logger.info(
    { correlation_id: req.correlationId, claim_id, workflow_id },
    `Prior auth submitted: ${provider.name} requesting ${proc?.description ?? data.procedure_code} (CPT ${proc?.cpt ?? "N/A"}) for ${patient.name} (MRN: ${patient.mrn}) — ${CLINICAL.formatAmount(data.requested_amount)} — triggers WF-001`
  )

  res.status(202).json({
    status: "ACCEPTED",
    claim_id,
    workflow_id,
    clinical_context: {
      request_summary: `${provider.name} requesting ${proc?.description ?? data.procedure_code} (CPT ${proc?.cpt ?? "N/A"}) for ${patient.name}`,
      provider: `${provider.name} — ${provider.practice}`,
      patient_mrn: patient.mrn,
      diagnosis: `${patient.diagnosis.code} — ${patient.diagnosis.display}`,
      procedure: `${proc?.description ?? data.procedure_code} (CPT ${proc?.cpt ?? "N/A"})`,
      amount: CLINICAL.formatAmount(data.requested_amount),
      payer: `${CLINICAL.payer.name} (${CLINICAL.payer.groupNumber})`,
    },
  })
})

app.get("/healthz", (_req, res) => res.json({ status: "ok" }))

const PORT = parseInt(process.env.PORT ?? "3005")
app.listen(PORT, () => logger.info({ port: PORT }, "provider-adapter-api started"))

export default app
