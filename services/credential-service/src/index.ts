import express from "express"
import { correlationMiddleware, logger } from "@proofpa/observability"
import { z } from "zod"
import { CLINICAL } from "@proofpa/schemas"

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

app.get("/healthz", (_req, res) => res.json({ status: "ok" }))

const PORT = parseInt(process.env.PORT ?? "3002")
app.listen(PORT, () => logger.info({ port: PORT }, "credential-service started"))

export default app
