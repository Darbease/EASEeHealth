import express from "express"
import { correlationMiddleware, logger } from "@proofpa/observability"
import { CLINICAL, loadSyntheaData } from "@proofpa/schemas"

const app = express()
app.use(express.json())
app.use(correlationMiddleware)

interface DemoPolicy {
  payer_id: string
  policy_version: string
  policy_hash: `0x${string}`
  active: boolean
  predicates: Record<string, unknown>
}

const DEMO_POLICIES: Record<string, Record<string, DemoPolicy>> = {
  "payer-demo-001": {
    v1: {
      payer_id: "payer-demo-001",
      policy_version: "v1",
      policy_hash: ("0x" + "a1".repeat(32)) as `0x${string}`,
      active: true,
      predicates: {
        covered_procedures: ["PROC_KNEE_MRI", "PROC_CARDIAC_CT", "PROC_SPINE_XRAY"],
        amount_caps: { PROC_KNEE_MRI: 100000, PROC_CARDIAC_CT: 150000, PROC_SPINE_XRAY: 50000 },
        attestation_max_age_seconds: 86400,
        formulary: {
          covered_medications: [
            "309362", "314076", "314231", "205532", "310261", "329528",
            "259255", "860975", "860999", "310534", "197805", "308182",
          ],
          medication_caps: {
            "309362": 35000, "314076": 6000, "314231": 15000, "205532": 45000,
            "310261": 100000, "329528": 5000, "259255": 25000, "860975": 5000,
            "860999": 8000, "310534": 8000, "197805": 4000, "308182": 5000,
          },
        },
      },
    },
  },
}

app.get("/v1/policies/:payerId/:policyVersion", (req, res) => {
  const { payerId, policyVersion } = req.params
  const policy = DEMO_POLICIES[payerId]?.[policyVersion]
  if (!policy) {
    res.status(404).json({ error: "Policy not found" })
    return
  }

  const caps = (policy.predicates.amount_caps ?? {}) as Record<string, number>
  const procs = ((policy.predicates.covered_procedures ?? []) as string[]).map((code) => {
    const p = CLINICAL.procedures[code]
    return {
      code,
      cpt: p?.cpt ?? "N/A",
      description: p?.description ?? code,
      cap: p ? CLINICAL.formatAmount(p.cap) : "N/A",
    }
  })

  logger.info(
    { correlation_id: req.correlationId, payer_id: payerId },
    `Policy lookup: ${CLINICAL.payer.name} (${policyVersion}) — ${procs.length} covered procedures`
  )

  res.json({
    ...policy,
    clinical_context: {
      plan_name: CLINICAL.payer.name,
      plan_type: CLINICAL.payer.planType,
      group_number: CLINICAL.payer.groupNumber,
      network: CLINICAL.payer.network,
      covered_procedures_display: procs,
    },
  })
})

// ---------------------------------------------------------------------------
// Payer Data Endpoints — Synthea-format payer and enrollment data
// Consumed by CRE workflows via ConfidentialHTTPRequest.
// ---------------------------------------------------------------------------
const synthea = loadSyntheaData()

app.get("/v1/payers", (req, res) => {
  logger.info({ correlation_id: req.correlationId }, `Payer query: returning ${synthea.payers.length} payers`)
  res.json({ payers: synthea.payers, count: synthea.payers.length })
})

app.get("/v1/payers/:id", (req, res) => {
  const payer = synthea.payers.find((p) => p.Id === req.params.id)
  if (!payer) { res.status(404).json({ error: "Payer not found" }); return }
  const members = synthea.payerTransitions.filter((t) => t.Payer === payer.Id)
  res.json({ payer, enrolled_members: members, member_count: members.length })
})

app.get("/v1/payers/:id/members", (req, res) => {
  const members = synthea.payerTransitions.filter((t) => t.Payer === req.params.id)
  const enriched = members.map((m) => {
    const patient = synthea.patients.find((p) => p.Id === m.Patient)
    return {
      ...m,
      patient_name: patient ? `${patient.First} ${patient.Last}` : undefined,
    }
  })
  res.json({ members: enriched, count: enriched.length })
})

app.get("/v1/payer-transitions", (req, res) => {
  const patientId = req.query.patient as string | undefined
  const filtered = patientId
    ? synthea.payerTransitions.filter((t) => t.Patient === patientId)
    : synthea.payerTransitions
  res.json({ transitions: filtered, count: filtered.length })
})

app.get("/healthz", (_req, res) => res.json({ status: "ok" }))

const PORT = parseInt(process.env.PORT ?? "3001")
app.listen(PORT, () => logger.info({ port: PORT }, "policy-service started"))

export default app
