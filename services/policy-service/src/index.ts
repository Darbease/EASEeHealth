import express from "express"
import { correlationMiddleware, logger } from "@proofpa/observability"
import { CLINICAL } from "@proofpa/schemas"

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

app.get("/healthz", (_req, res) => res.json({ status: "ok" }))

const PORT = parseInt(process.env.PORT ?? "3001")
app.listen(PORT, () => logger.info({ port: PORT }, "policy-service started"))

export default app
