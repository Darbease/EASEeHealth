/**
 * Scenario B: Revoked consent → DENIED (reason bit 3)
 */
import { describe, it, expect } from "vitest"

const PROOF_SERVICE_URL = process.env.PROOF_SERVICE_URL ?? "http://localhost:3003"
const CONSENT_SERVICE_URL = process.env.CONSENT_SERVICE_URL ?? "http://localhost:3004"

describe("Scenario B: Revoked consent (DENIED, bit 3)", () => {
  it("proof service returns FAIL with consent bit when consent is inactive", async () => {
    const res = await fetch(`${PROOF_SERVICE_URL}/v1/proofs/medical-necessity`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        claim_id: "0x" + "bb".repeat(32),
        policy_hash: "0x" + "a1".repeat(32),
        procedure_code: "PROC_KNEE_MRI",
        requested_amount: "85000",
        consent_active: false, // Consent revoked
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
    expect(body.result).toBe("FAIL")
    // Bit 3 = 8 (consent invalid)
    expect(parseInt(body.reason_bitmap) & (1 << 3)).toBe(8)
  })

  it("consent service accepts revocation request", async () => {
    const res = await fetch(`${CONSENT_SERVICE_URL}/v1/consents/revoke`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        consent_id: "0x" + "77".repeat(32),
        reason_code: 1,
      }),
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe("ACCEPTED")
  })
})
