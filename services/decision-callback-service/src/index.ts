import express from "express"
import { correlationMiddleware, logger, emitEvent } from "@proofpa/observability"
import { z } from "zod"
import { CLINICAL } from "@proofpa/schemas"

const app = express()
app.use(express.json())
app.use(correlationMiddleware)

const CallbackSchema = z.object({
  claim_id: z.string(),
  decision_state: z.string(),
  reason_bitmap: z.string().optional(),
  tx_hash: z.string().optional(),
  correlation_id: z.string().optional(),
  workflow_id: z.string().optional(),
})

function shortId(id: string): string {
  return id.length > 16 ? `${id.substring(0, 10)}...${id.substring(id.length - 4)}` : id;
}

function decisionNarrative(state: string, bitmap: string | undefined): string {
  if (state === "APPROVED") return "APPROVED — All medical necessity criteria met";
  if (state === "PAID") return "PAID — Payout released to provider treasury";
  if (state === "CHALLENGED") return "CHALLENGED — Payout blocked pending clinical review";
  if (state === "DENIED") {
    const bm = parseInt(bitmap ?? "0");
    const reasons = bm > 0 ? CLINICAL.decodeBitmap(bm) : [];
    return `DENIED — ${reasons.length > 0 ? reasons.join("; ") : "See reason bitmap"}`;
  }
  return state;
}

app.post("/v1/callbacks/prior-auth-decision", (req, res) => {
  const parsed = CallbackSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid callback payload" })
    return
  }

  const data = parsed.data

  emitEvent({
    correlation_id: data.correlation_id ?? req.correlationId,
    claim_id: data.claim_id,
    workflow_id: data.workflow_id,
    stage: "callback_received",
    status: "success",
    metadata: {
      decision_state: data.decision_state,
      reason_bitmap: data.reason_bitmap,
      tx_hash: data.tx_hash,
    },
  })

  const narrative = decisionNarrative(data.decision_state, data.reason_bitmap);
  logger.info(
    { claim_id: data.claim_id, state: data.decision_state },
    `Decision callback: ${narrative} — claim ${shortId(data.claim_id)}`
  )
  res.json({
    status: "received",
    clinical_context: {
      decision_display: narrative,
      claim_id_short: shortId(data.claim_id),
      next_action: data.decision_state === "APPROVED"
        ? "Payout scheduled to provider treasury"
        : data.decision_state === "CHALLENGED"
          ? "Payout blocked — awaiting ops resolution"
          : data.decision_state === "PAID"
            ? "Complete — no further action"
            : "Claim closed",
    },
  })
})

app.post("/v1/callbacks/consent-revoked", (req, res) => {
  logger.info(
    { correlation_id: req.correlationId },
    `Consent revocation callback: ${CLINICAL.patients.primary.name} consent revoked — flagging pending claims for review`
  )
  emitEvent({
    correlation_id: req.correlationId,
    stage: "consent_revocation_callback",
    status: "success",
    metadata: req.body,
  })
  res.json({
    status: "received",
    flagged_claims: 0,
    clinical_context: {
      patient_name: CLINICAL.patients.primary.name,
      impact: "All pending prior auth claims flagged for re-evaluation",
    },
  })
})

app.get("/v1/callbacks/pending-challenges", (req, res) => {
  const patient = CLINICAL.patients.secondary;
  const proc = CLINICAL.procedures["PROC_CARDIAC_CT"];
  logger.info(
    { correlation_id: req.correlationId },
    `Pending challenges poll: ${proc.description} (CPT ${proc.cpt}) for ${patient.name} — ${CLINICAL.formatAmount(120000)} challenged by ops-reviewer-1`
  )
  res.json({
    challenges: [
      {
        claim_id: ("0x" + "e5".repeat(32)) as string,
        challenged_at: new Date(Date.now() - 600_000).toISOString(),
        challenger: "ops-reviewer-1",
        reason: "Amount exceeds usual range",
        clinical_context: {
          challenger_display: "Clinical Review Team (ops-reviewer-1)",
          procedure: `${proc.description} (CPT ${proc.cpt})`,
          patient: `${patient.name} (MRN: ${patient.mrn})`,
          requested_amount: CLINICAL.formatAmount(120000),
          plan_cap: CLINICAL.formatAmount(proc.cap),
          impact: "Payout blocked pending manual review",
        },
      },
    ],
    count: 1,
  })
})

app.post("/v1/callbacks/challenge-resolved", (req, res) => {
  const patient = CLINICAL.patients.secondary;
  logger.info(
    { correlation_id: req.correlationId },
    `Challenge resolved: ${patient.name} claim reviewed — resolution posted to provider notification system`
  )
  emitEvent({
    correlation_id: req.correlationId,
    stage: "challenge_resolution_callback",
    status: "success",
    metadata: req.body,
  })
  res.json({
    status: "received",
    resolved_count: 1,
    clinical_context: {
      patient_name: patient.name,
      resolution_narrative: "Clinical review complete — challenge resolved by ops team",
    },
  })
})

app.get("/healthz", (_req, res) => res.json({ status: "ok" }))

const PORT = parseInt(process.env.PORT ?? "3006")
app.listen(PORT, () => logger.info({ port: PORT }, "decision-callback-service started"))

export default app
