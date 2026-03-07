/**
 * Scenario A: Happy path — valid submission → APPROVED → PAID
 *
 * Tests the full provider adapter → proof service → contract state flow.
 * Requires: Anvil running, all services running.
 */
import { describe, it, expect } from "vitest"

const PROVIDER_ADAPTER_URL = process.env.PROVIDER_ADAPTER_URL ?? "http://localhost:3005"
const PROOF_SERVICE_URL = process.env.PROOF_SERVICE_URL ?? "http://localhost:3003"

describe("Scenario A: Happy path (APPROVED → PAID)", () => {
  it("submits a valid prior auth request and gets ACCEPTED", async () => {
    const res = await fetch(`${PROVIDER_ADAPTER_URL}/v1/prior-auth/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        request_id: crypto.randomUUID(),
        payer_id: "payer-demo-001",
        provider_id_hash: "0x" + "b2".repeat(32),
        encounter_ref_hash: "0x" + "d4".repeat(32),
        procedure_code: "PROC_KNEE_MRI",
        requested_amount: "85000",
        currency: "USDC_6",
        consent_id: "0x" + "77".repeat(32),
        attestation_jws: "eyJhbGciOiJFUzI1NiJ9.demo",
        service_date: "2026-03-03",
      }),
    })

    expect(res.status).toBe(202)
    const body = await res.json()
    expect(body.status).toBe("ACCEPTED")
    expect(body.claim_id).toMatch(/^0x[0-9a-f]{64}$/)
    expect(body.workflow_id).toMatch(/^wf_/)
  })

  it("proof service returns PASS for valid inputs", async () => {
    const res = await fetch(`${PROOF_SERVICE_URL}/v1/proofs/medical-necessity`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        claim_id: "0x" + "ab".repeat(32),
        policy_hash: "0x" + "a1".repeat(32),
        procedure_code: "PROC_KNEE_MRI",
        requested_amount: "85000",
        consent_active: true,
        credential_valid: true,
        is_duplicate: false,
        attestation_age_seconds: 3600,
        policy_predicates: {
          covered_procedures: ["PROC_KNEE_MRI"],
          amount_caps: { PROC_KNEE_MRI: 100000 },
          attestation_max_age_seconds: 86400,
        },
      }),
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.result).toBe("PASS")
    expect(body.reason_bitmap).toBe("0")
    expect(body.proof_hash).toMatch(/^0x/)
  })
})
