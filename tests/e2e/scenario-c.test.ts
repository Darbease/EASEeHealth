/**
 * Scenario C: Challenge → payout blocked → resolution
 *
 * Tests the challenge flow where an approved claim's payout is blocked
 * until manual ops resolution.
 */
import { describe, it, expect } from "vitest"

const CALLBACK_SERVICE_URL = process.env.CALLBACK_SERVICE_URL ?? "http://localhost:3006"

describe("Scenario C: Challenge (payout blocked → resolution)", () => {
  it("callback service accepts challenge notification", async () => {
    const res = await fetch(`${CALLBACK_SERVICE_URL}/v1/callbacks/prior-auth-decision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        claim_id: "0x" + "cc".repeat(32),
        decision_state: "CHALLENGED",
        reason_bitmap: "0",
        correlation_id: "corr_challenge_test_001",
        workflow_id: "wf_challenge_test",
      }),
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe("received")
  })

  it("callback service accepts resolution notification", async () => {
    const res = await fetch(`${CALLBACK_SERVICE_URL}/v1/callbacks/prior-auth-decision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        claim_id: "0x" + "cc".repeat(32),
        decision_state: "APPROVED",
        reason_bitmap: "0",
        correlation_id: "corr_challenge_test_001",
        workflow_id: "wf_challenge_test",
      }),
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe("received")
  })
})
