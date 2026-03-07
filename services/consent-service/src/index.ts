import express from "express"
import { correlationMiddleware, logger, emitEvent } from "@proofpa/observability"
import { z } from "zod"
import { CLINICAL } from "@proofpa/schemas"

const app = express()
app.use(express.json())
app.use(correlationMiddleware)

const Bytes32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/)

const ConsentGrantSchema = z.object({
  consent_id: Bytes32,
  subject_id_hash: Bytes32,
  consent_scope_hash: Bytes32,
  expires_at: z.string(),
  version: z.number().int().min(0),
  nonce: z.string().optional(),
  issued_at: z.string().optional(),
  expires_at_replay: z.string().optional(),
  signature: z.string().optional(),
})

const ConsentRevokeSchema = z.object({
  consent_id: Bytes32,
  reason_code: z.number().int().min(0),
  nonce: z.string().optional(),
  issued_at: z.string().optional(),
  expires_at: z.string().optional(),
  signature: z.string().optional(),
})

app.post("/v1/consents/grant", (req, res) => {
  const parsed = ConsentGrantSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.issues })
    return
  }
  const data = parsed.data

  emitEvent({
    correlation_id: req.correlationId,
    stage: "consent_grant_requested",
    status: "success",
    metadata: { consent_id: data.consent_id, version: data.version },
  })

  logger.info(
    { correlation_id: req.correlationId, consent_id: data.consent_id },
    `Consent granted: ${CLINICAL.consent.type} — scope: ${CLINICAL.consent.scope} — expires ${CLINICAL.consent.expiresDisplay}`
  )
  res.json({
    status: "ACCEPTED",
    consent_id: data.consent_id,
    correlation_id: req.correlationId,
    clinical_context: {
      consent_type: CLINICAL.consent.type,
      scope: CLINICAL.consent.scope,
      patient_name: CLINICAL.patients.primary.name,
      expires_display: CLINICAL.consent.expiresDisplay,
    },
  })
})

app.post("/v1/consents/revoke", (req, res) => {
  const parsed = ConsentRevokeSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.issues })
    return
  }
  const data = parsed.data

  emitEvent({
    correlation_id: req.correlationId,
    stage: "consent_revoke_requested",
    status: "success",
    metadata: { consent_id: data.consent_id, reason_code: data.reason_code },
  })

  const reasonDisplay = data.reason_code === 1 ? "Patient-initiated withdrawal" : "Administrative"
  logger.info(
    { correlation_id: req.correlationId, consent_id: data.consent_id },
    `Consent REVOKED: ${CLINICAL.patients.primary.name} — reason: ${reasonDisplay} — triggers WF-002`
  )
  res.json({
    status: "ACCEPTED",
    consent_id: data.consent_id,
    correlation_id: req.correlationId,
    clinical_context: {
      consent_type: CLINICAL.consent.type,
      scope: CLINICAL.consent.scope,
      patient_name: CLINICAL.patients.primary.name,
      reason_display: reasonDisplay,
      impact: "Pending prior auth claims for this patient will be flagged for review",
    },
  })
})

app.get("/v1/consents/revocations", (req, res) => {
  const since = parseInt(req.query.since as string) || 900
  logger.info(
    { correlation_id: req.correlationId, since_seconds: since },
    `Revocations poll: ${CLINICAL.patients.primary.name} revoked ${CLINICAL.consent.scope} consent (5 minutes ago)`
  )
  res.json({
    revocations: [
      {
        consent_id: ("0x" + "d4".repeat(32)) as string,
        revoked_at: new Date(Date.now() - 300_000).toISOString(),
        reason_code: 1,
        clinical_context: {
          patient_name: CLINICAL.patients.primary.name,
          reason_display: "Patient-initiated withdrawal of consent",
          scope: CLINICAL.consent.scope,
          impact: "Pending claims for this patient will be flagged for review",
        },
      },
    ],
    since_seconds: since,
    count: 1,
  })
})

app.get("/healthz", (_req, res) => res.json({ status: "ok" }))

const PORT = parseInt(process.env.PORT ?? "3004")
app.listen(PORT, () => logger.info({ port: PORT }, "consent-service started"))

export default app
