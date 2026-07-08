import express, { type RequestHandler } from "express"
import { correlationMiddleware, logger, emitEvent } from "@proofpa/observability"
import { z } from "zod"
import { CLINICAL } from "@proofpa/schemas"

const app = express()
app.use(express.json())
// correlationMiddleware is typed against the shared package's express copy — cast to this service's handler type.
app.use(correlationMiddleware as unknown as RequestHandler)

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

// ---------------------------------------------------------------------------
// Attester async result sink (Phase 2 — native callback topology)
//
// The Confidential AI Attester POSTs its verdict here (cre_callback.url set by
// provider-adapter-api). We map it to the wf-009 HTTP-trigger payload and relay
// it on-chain. Claim correlation rides on the query string, since the Attester
// echoes only its own inference result.
// ---------------------------------------------------------------------------
const attesterResults = new Map<string, Record<string, unknown>>()

function parseFencedJson(output: string | undefined): Record<string, any> | null {
  if (!output) return null
  let t = output.trim()
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) t = fence[1].trim()
  const s = t.indexOf("{"), e = t.lastIndexOf("}")
  if (s === -1 || e === -1 || e < s) return null
  try { return JSON.parse(t.slice(s, e + 1)) } catch { return null }
}

const AttesterQuerySchema = z.object({
  claim_id: z.string().optional(),
  policy_hash: z.string().optional(),
  consent_id: z.string().optional(),
  procedure_code: z.string().optional(),
  requested_amount: z.string().optional(),
})

app.post("/v1/callbacks/attester-result", (req, res) => {
  const q = AttesterQuerySchema.safeParse(req.query)
  const query = q.success ? q.data : {}
  const body = (req.body ?? {}) as Record<string, any>
  const r0 = (Array.isArray(body.resources) ? body.resources[0] ?? {} : {}) as Record<string, any>

  const claim_id = query.claim_id ?? body.claim_id
  if (!claim_id) { res.status(400).json({ error: "missing claim_id (query or body)" }); return }

  // Map the Attester verdict → the wf-009 settlement payload.
  const verdict = parseFencedJson(body.output)
  const approved = verdict ? verdict.approved === true : (body.approved === true || body.result === "PASS")
  const payload = {
    claim_id,
    policy_hash: query.policy_hash ?? body.policy_hash ?? ("0x" + "a1".repeat(32)),
    consent_id: query.consent_id ?? body.consent_id ?? ("0x" + "c0".repeat(32)),
    procedure_code: query.procedure_code ?? body.procedure_code ?? null,
    requested_amount: query.requested_amount ?? body.requested_amount ?? null,
    result: approved ? "PASS" : "FAIL",
    reason_bitmap: String(body.reason_bitmap ?? (approved ? 0 : 1)),
    proof_hash: r0.response_digest ?? body.proof_hash ?? null,
    request_digest: r0.request_digest ?? body.request_digest ?? null,
    attester_key_hash: body.attester_key_hash ?? r0.attester_key_hash ?? null,
    signature: r0.signature ?? body.signature ?? null,
  }
  attesterResults.set(claim_id, payload)

  emitEvent({
    correlation_id: req.correlationId,
    claim_id,
    stage: "attester_result_received",
    status: "success",
    metadata: { result: payload.result, proof_hash: payload.proof_hash, attester_key_hash: payload.attester_key_hash },
  })

  // Relay into wf-009. In production decision-callback-service holds the
  // authorized signer key and POSTs to the CRE gateway; for the local demo we
  // store the mapped payload (GET below) and log the equivalent simulate command.
  const relayCommand = `cd ProofPACRE && cre workflow simulate ./wf-009-attester-callback --target=staging-settings --broadcast --non-interactive --trigger-index=0 --http-payload='${JSON.stringify(payload)}'`
  logger.info({ claim_id, result: payload.result }, `Attester result mapped → wf-009 relay ready: ${relayCommand}`)

  res.status(202).json({ status: "RELAYED", claim_id, wf009_payload: payload, relay_command: relayCommand })
})

app.get("/v1/callbacks/attester-result/:claimId", (req, res) => {
  const payload = attesterResults.get(req.params.claimId)
  if (!payload) { res.status(404).json({ error: "no attester result for claim" }); return }
  res.json({ claim_id: req.params.claimId, wf009_payload: payload })
})

app.get("/healthz", (_req, res) => res.json({ status: "ok" }))

const PORT = parseInt(process.env.PORT ?? "3006")
app.listen(PORT, () => logger.info({ port: PORT }, "decision-callback-service started"))

export default app
