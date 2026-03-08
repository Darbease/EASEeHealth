import express from "express"
import { correlationMiddleware, logger } from "@proofpa/observability"
import { z } from "zod"
import { CLINICAL, loadSyntheaData } from "@proofpa/schemas"

const app = express()
app.use(express.json())
app.use(correlationMiddleware)

// Hardcoded demo provider allowlist (stub per spec)
const VALID_PROVIDERS = new Set([
  "0x" + "b2".repeat(32), // demo provider 1
  "0x" + "c3".repeat(32), // demo provider 2
])

const VerifyRequestSchema = z.object({
  provider_id_hash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  service_date: z.string(),
})

app.post("/v1/credentials/verify", (req, res) => {
  const parsed = VerifyRequestSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.issues })
    return
  }
  const { provider_id_hash } = parsed.data
  const valid = VALID_PROVIDERS.has(provider_id_hash)
  const provider = CLINICAL.providerByHash(provider_id_hash)

  logger.info(
    { correlation_id: req.correlationId, provider_id_hash, valid },
    provider
      ? `Credential verification: ${provider.name}, ${provider.credentials} (NPI: ${provider.npi}) — ${valid ? "VALID" : "INVALID"}`
      : `Credential verification: ${valid ? "VALID" : "INVALID"}`
  )

  res.json({
    valid,
    provider_id_hash,
    clinical_context: provider
      ? {
          provider_name: `${provider.name}, ${provider.credentials}`,
          npi: provider.npi,
          specialty: provider.specialty,
          practice: provider.practice,
          license_status: valid ? "ACTIVE" : "INVALID",
        }
      : undefined,
  })
})

// ---------------------------------------------------------------------------
// Provider/Organization Registry — Synthea-format provider and org data
// Consumed by CRE workflows via ConfidentialHTTPRequest.
// ---------------------------------------------------------------------------
const synthea = loadSyntheaData()

app.get("/v1/registry/providers", (req, res) => {
  const orgId = req.query.organization as string | undefined
  const specialty = req.query.specialty as string | undefined
  let filtered = synthea.providers
  if (orgId) filtered = filtered.filter((p) => p.Organization === orgId)
  if (specialty) filtered = filtered.filter((p) => p.Speciality.toLowerCase().includes(specialty.toLowerCase()))
  // Enrich providers with organization name to avoid needing a separate org lookup call
  const enriched = filtered.map((p) => {
    const org = synthea.organizations.find((o) => o.Id === p.Organization)
    return { ...p, OrganizationName: org?.Name ?? "Unknown" }
  })
  logger.info({ correlation_id: req.correlationId }, `Registry query: returning ${enriched.length} providers`)
  res.json({ providers: enriched, count: enriched.length })
})

app.get("/v1/registry/providers/:id", (req, res) => {
  const provider = synthea.providers.find((p) => p.Id === req.params.id)
  if (!provider) { res.status(404).json({ error: "Provider not found" }); return }
  const org = synthea.organizations.find((o) => o.Id === provider.Organization)
  const encounters = synthea.encounters.filter((e) => e.Provider === provider.Id)
  res.json({ provider, organization: org, recent_encounters: encounters.length })
})

app.get("/v1/registry/organizations", (req, res) => {
  logger.info({ correlation_id: req.correlationId }, `Registry query: returning ${synthea.organizations.length} organizations`)
  res.json({ organizations: synthea.organizations, count: synthea.organizations.length })
})

app.get("/v1/registry/organizations/:id", (req, res) => {
  const org = synthea.organizations.find((o) => o.Id === req.params.id)
  if (!org) { res.status(404).json({ error: "Organization not found" }); return }
  const providers = synthea.providers.filter((p) => p.Organization === org.Id)
  res.json({ organization: org, providers, provider_count: providers.length })
})

app.get("/healthz", (_req, res) => res.json({ status: "ok" }))

const PORT = parseInt(process.env.PORT ?? "3002")
app.listen(PORT, () => logger.info({ port: PORT }, "credential-service started"))

export default app
