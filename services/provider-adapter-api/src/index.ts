import express, { type RequestHandler } from "express"
import { correlationMiddleware, logger, emitEvent } from "@proofpa/observability"
import { z } from "zod"
import { keccak256, encodePacked } from "viem"
import { randomUUID } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { CLINICAL, loadSyntheaData } from "@proofpa/schemas"

const app = express()
app.use(express.json())
// correlationMiddleware is typed against the shared package's express copy — cast to this service's handler type.
app.use(correlationMiddleware as unknown as RequestHandler)

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

// ---------------------------------------------------------------------------
// EHR Data Endpoints — Synthea-format patient/encounter/procedure/claim data
// Consumed by CRE workflows via ConfidentialHTTPRequest for off-chain verification.
// ---------------------------------------------------------------------------
const synthea = loadSyntheaData()

app.get("/v1/ehr/patients", (req, res) => {
  logger.info({ correlation_id: req.correlationId }, `EHR query: returning ${synthea.patients.length} patients`)
  res.json({ patients: synthea.patients, count: synthea.patients.length })
})

app.get("/v1/ehr/patients/:id", (req, res) => {
  const patient = synthea.patients.find((p) => p.Id === req.params.id)
  if (!patient) { res.status(404).json({ error: "Patient not found" }); return }
  const conditions = synthea.conditions.filter((c) => c.Patient === patient.Id)
  const encounters = synthea.encounters.filter((e) => e.Patient === patient.Id)
  res.json({ patient, conditions, encounters: encounters.length })
})

app.get("/v1/ehr/encounters", (req, res) => {
  const patientId = req.query.patient as string | undefined
  const filtered = patientId
    ? synthea.encounters.filter((e) => e.Patient === patientId)
    : synthea.encounters
  res.json({ encounters: filtered, count: filtered.length })
})

app.get("/v1/ehr/encounters/:id", (req, res) => {
  const enc = synthea.encounters.find((e) => e.Id === req.params.id)
  if (!enc) { res.status(404).json({ error: "Encounter not found" }); return }
  const procedures = synthea.procedures.filter((p) => p.Encounter === enc.Id)
  const conditions = synthea.conditions.filter((c) => c.Encounter === enc.Id)
  res.json({ encounter: enc, procedures, conditions })
})

app.get("/v1/ehr/procedures", (req, res) => {
  const patientId = req.query.patient as string | undefined
  const encounterId = req.query.encounter as string | undefined
  let filtered = synthea.procedures
  if (patientId) filtered = filtered.filter((p) => p.Patient === patientId)
  if (encounterId) filtered = filtered.filter((p) => p.Encounter === encounterId)
  res.json({ procedures: filtered, count: filtered.length })
})

app.get("/v1/ehr/conditions", (req, res) => {
  const patientId = req.query.patient as string | undefined
  const filtered = patientId
    ? synthea.conditions.filter((c) => c.Patient === patientId)
    : synthea.conditions
  res.json({ conditions: filtered, count: filtered.length })
})

app.get("/v1/ehr/claims/outstanding", (_req, res) => {
  const outstanding = synthea.claims.filter(
    (c) => c.Status1 === "BILLED" && parseFloat(c.Outstanding1 || "0") > 0,
  )
  const enriched = outstanding.map((claim) => {
    const patient = synthea.patients.find((p) => p.Id === claim["Patient ID"])
    const provider = synthea.providers.find((p) => p.Id === claim["Provider ID"])
    const encounter = synthea.encounters.find((e) => e.Id === claim["Appointment ID"])
    const procedures = encounter
      ? synthea.procedures.filter((p) => p.Encounter === encounter.Id)
      : []
    return {
      claim_id: claim.Id,
      patient_name: patient ? `${patient.First} ${patient.Last}` : "Unknown",
      provider_name: provider?.Name ?? "Unknown",
      service_date: claim["Service Date"],
      total_claim_cost: encounter?.Total_Claim_Cost,
      outstanding_amount: claim.Outstanding1,
      status: claim.Status1,
      diagnoses: [claim.Diagnosis1, claim.Diagnosis2].filter(Boolean),
      procedures: procedures.map((p) => ({
        code: p.Code,
        description: p.Description,
        cost: p.Base_Cost,
      })),
    }
  })
  res.json({
    outstanding_claims: enriched,
    count: enriched.length,
    total_outstanding: enriched.reduce((sum, c) => sum + parseFloat(c.outstanding_amount || "0"), 0).toFixed(2),
  })
})

app.get("/v1/ehr/claims", (req, res) => {
  const patientId = req.query.patient as string | undefined
  const status = req.query.status as string | undefined
  let filtered = synthea.claims
  if (patientId) filtered = filtered.filter((c) => c["Patient ID"] === patientId)
  if (status) filtered = filtered.filter((c) => c.Status1 === status)
  const enriched = filtered.map((claim) => {
    const txns = synthea.claimTransactions.filter((t) => t["Claim ID"] === claim.Id)
    const patient = synthea.patients.find((p) => p.Id === claim["Patient ID"])
    const provider = synthea.providers.find((p) => p.Id === claim["Provider ID"])
    return {
      ...claim,
      transactions: txns,
      patient_name: patient ? `${patient.First} ${patient.Last}` : undefined,
      provider_name: provider?.Name,
    }
  })
  logger.info({ correlation_id: req.correlationId }, `EHR query: returning ${enriched.length} claims`)
  res.json({ claims: enriched, count: enriched.length })
})

app.get("/v1/ehr/claims/:id", (req, res) => {
  const claim = synthea.claims.find((c) => c.Id === req.params.id)
  if (!claim) { res.status(404).json({ error: "Claim not found" }); return }
  const txns = synthea.claimTransactions.filter((t) => t["Claim ID"] === claim.Id)
  const patient = synthea.patients.find((p) => p.Id === claim["Patient ID"])
  const provider = synthea.providers.find((p) => p.Id === claim["Provider ID"])
  const encounter = synthea.encounters.find((e) => e.Id === claim["Appointment ID"])
  res.json({
    claim,
    transactions: txns,
    patient_name: patient ? `${patient.First} ${patient.Last}` : undefined,
    provider_name: provider?.Name,
    encounter,
  })
})

// ---------------------------------------------------------------------------
// Medication Endpoints — Synthea-format medication data for WF-006
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Transfer Claim Endpoints — TRANSFERIN data for WF-007
// ---------------------------------------------------------------------------
app.get("/v1/ehr/claims/transfers/pending", (_req, res) => {
  const transfersIn = synthea.claimTransactions.filter(
    (t) => t.Type === "TRANSFERIN"
  )
  const enriched = transfersIn.map((txn) => {
    const claim = synthea.claims.find((c) => c.Id === txn["Claim ID"])
    const encounter = claim
      ? synthea.encounters.find((e) => e.Id === claim["Appointment ID"])
      : undefined
    const patient = synthea.patients.find((p) => p.Id === txn["Patient ID"])
    const provider = claim
      ? synthea.providers.find((p) => p.Id === claim["Provider ID"])
      : undefined
    const payerCoverage = encounter
      ? (parseFloat(encounter.Payer_Coverage || "0") /
          parseFloat(encounter.Total_Claim_Cost || "1")) *
        parseFloat(txn.Amount || "0")
      : 0
    return {
      transaction_id: txn.Id,
      claim_id: txn["Claim ID"],
      patient_id: txn["Patient ID"],
      patient_name: patient ? `${patient.First} ${patient.Last}` : "Unknown",
      provider_name: provider?.Name ?? "Unknown",
      procedure_code: txn["Procedure Code"],
      amount: txn.Amount,
      payer_coverage: payerCoverage.toFixed(2),
      from_date: txn["From Date"],
      to_date: txn["To Date"],
    }
  })
  logger.info(
    { correlation_id: _req.correlationId },
    `EHR query: ${enriched.length} pending transfer claims`
  )
  res.json({ pending_transfers: enriched, count: enriched.length })
})

// ---------------------------------------------------------------------------
// Medication Endpoints — Synthea-format medication data for WF-006
// ---------------------------------------------------------------------------
app.get("/v1/ehr/medications", (req, res) => {
  const patientId = req.query.patient as string | undefined
  const filtered = patientId
    ? synthea.medications.filter((m) => m.PATIENT === patientId)
    : synthea.medications
  logger.info({ correlation_id: req.correlationId }, `EHR query: returning ${filtered.length} medications`)
  res.json({ medications: filtered, count: filtered.length })
})

app.get("/v1/ehr/medications/pending-auth", (_req, res) => {
  const now = new Date().toISOString().split("T")[0]
  const pending = synthea.medications.filter((m) => {
    const baseCost = parseFloat(m.BASE_COST || "0")
    const isActive = !m.STOP || m.STOP >= now
    return baseCost > 100 && isActive
  })
  const enriched = pending.map((m) => ({
    code: m.CODE,
    description: m.DESCRIPTION,
    base_cost: m.BASE_COST,
    payer_coverage: m.PAYER_COVERAGE,
    reason_code: m.REASONCODE,
    reason_description: m.REASONDESCRIPTION,
    patient_id: m.PATIENT,
    encounter_id: m.ENCOUNTER,
    payer_id: m.PAYER,
    start: m.START,
  }))
  logger.info({ correlation_id: _req.correlationId }, `EHR query: ${enriched.length} medications pending prior auth`)
  res.json({ pending_medications: enriched, count: enriched.length })
})

// ---------------------------------------------------------------------------
// Native callback topology (Phase 2): fire the Confidential AI Attester with a
// cre_callback so the clinical document goes provider → TEE and never touches
// the DON. The verdict returns to decision-callback-service → wf-009 → on-chain.
// ---------------------------------------------------------------------------
const LETTERS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "data", "necessity-letters")
const INFERENCE_BASE_URL = (process.env.INFERENCE_BASE_URL ?? "https://confidential-ai-dev-preview.cldev.cloud").replace(/\/$/, "")
const INFERENCE_MODEL = process.env.INFERENCE_MODEL ?? "gemma4"
const CALLBACK_SERVICE_URL = (process.env.CALLBACK_SERVICE_URL ?? "http://localhost:3006").replace(/\/$/, "")
const DEMO_POLICY_HASH = "0x" + "a1".repeat(32)

function loadNecessityLetter(procedureCode: string): string {
  const p = join(LETTERS_DIR, `${procedureCode}.md`)
  return existsSync(p) ? readFileSync(p, "utf8") : `Medical-necessity request for ${procedureCode}.`
}

app.post("/v1/prior-auth/submit-attested", (req, res) => {
  const parsed = PriorAuthSubmitSchema.safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ error: "Invalid request", details: parsed.error.issues }); return }
  const data = parsed.data
  const claim_id = computeClaimId(
    data.payer_id, data.provider_id_hash as `0x${string}`, data.encounter_ref_hash as `0x${string}`,
    data.procedure_code, data.service_date,
  )

  if (!process.env.INFERENCE_API_KEY) {
    res.status(503).json({ error: "INFERENCE_API_KEY not configured — attested submission unavailable", claim_id })
    return
  }

  // Claim correlation rides on the cre_callback query string (the Attester echoes only its result).
  const params = new URLSearchParams({
    claim_id, policy_hash: DEMO_POLICY_HASH, consent_id: data.consent_id,
    procedure_code: data.procedure_code, requested_amount: data.requested_amount,
  })
  const callbackUrl = `${CALLBACK_SERVICE_URL}/v1/callbacks/attester-result?${params.toString()}`
  const letter = loadNecessityLetter(data.procedure_code)

  const inferenceBody = {
    model: INFERENCE_MODEL,
    system_prompt: "You are a strict medical-necessity reviewer. Decide ONLY from the attached document and policy. Respond with ONLY a JSON object.",
    prompt: `Requested procedure ${data.procedure_code}, amount ${data.requested_amount} (USD minor units). Is it medically necessary for the documented diagnosis and within policy? Return ONLY {"approved":true,"reason":"...","predicates":{"procedure_covered":true,"amount_within_cap":true,"necessity_established":true}}`,
    resources: [{ filename: `${data.procedure_code}.md`, content_type: "text/markdown", content_base64: Buffer.from(letter, "utf8").toString("base64") }],
    cre_callback: { url: callbackUrl },
  }

  // Fire-and-forget: the verdict returns asynchronously to the callback URL.
  fetch(`${INFERENCE_BASE_URL}/v1/inference`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.INFERENCE_API_KEY}` },
    body: JSON.stringify(inferenceBody),
  })
    .then((r) => logger.info({ claim_id, status: r.status }, "Attester inference fired (cre_callback set)"))
    .catch((err) => logger.warn({ claim_id, err: String(err) }, "Attester inference dispatch failed"))

  emitEvent({
    correlation_id: req.correlationId, claim_id, stage: "attested_submission_dispatched", status: "success",
    metadata: { procedure_code: data.procedure_code, callback_url: callbackUrl },
  })
  res.status(202).json({
    status: "ACCEPTED_ATTESTED",
    claim_id,
    document: `${data.procedure_code}.md`,
    note: "Document sent provider→TEE; verdict returns to decision-callback-service → wf-009. The DON never sees the document.",
  })
})

app.get("/healthz", (_req, res) => res.json({ status: "ok" }))

const PORT = parseInt(process.env.PORT ?? "3005")
app.listen(PORT, () => logger.info({ port: PORT }, "provider-adapter-api started"))

export default app
