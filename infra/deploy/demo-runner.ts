/**
 * EASE eHealth Demo Runner
 *
 * Runs all 3 demo scenarios against running services.
 * Usage: npx tsx infra/deploy/demo-runner.ts
 */

const PROVIDER_URL = process.env.PROVIDER_ADAPTER_URL ?? "http://localhost:3005"
const PROOF_URL = process.env.PROOF_SERVICE_URL ?? "http://localhost:3003"
const CONSENT_URL = process.env.CONSENT_SERVICE_URL ?? "http://localhost:3004"
const CALLBACK_URL = process.env.CALLBACK_SERVICE_URL ?? "http://localhost:3006"

function log(scenario: string, step: string, data?: unknown) {
  console.log(`[${scenario}] ${step}`, data ? JSON.stringify(data, null, 2) : "")
}

async function scenarioA() {
  log("A", "=== Scenario A: Happy Path (APPROVED → PAID) ===")

  // 1. Submit prior auth request
  log("A", "Step 1: Submitting prior auth request...")
  const submitRes = await fetch(`${PROVIDER_URL}/v1/prior-auth/submit`, {
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
      attestation_jws: "eyJhbGciOiJFUzI1NiJ9.demo-attestation",
      service_date: "2026-03-03",
    }),
  })
  const submitBody = await submitRes.json()
  log("A", `Step 1 result: ${submitRes.status}`, submitBody)

  // 2. Evaluate proof (simulating WF-001 proof step)
  log("A", "Step 2: Evaluating proof...")
  const proofRes = await fetch(`${PROOF_URL}/v1/proofs/medical-necessity`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      claim_id: submitBody.claim_id,
      policy_hash: "0x" + "a1".repeat(32),
      procedure_code: "PROC_KNEE_MRI",
      requested_amount: "85000",
      consent_active: true,
      credential_valid: true,
      policy_predicates: {
        covered_procedures: ["PROC_KNEE_MRI"],
        amount_caps: { PROC_KNEE_MRI: 100000 },
        attestation_max_age_seconds: 86400,
      },
    }),
  })
  const proofBody = await proofRes.json()
  log("A", `Step 2 result: ${proofBody.result}`, proofBody)

  // 3. Send callback
  log("A", "Step 3: Sending decision callback...")
  await fetch(`${CALLBACK_URL}/v1/callbacks/prior-auth-decision`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      claim_id: submitBody.claim_id,
      decision_state: proofBody.result === "PASS" ? "PAID" : "DENIED",
      reason_bitmap: proofBody.reason_bitmap,
    }),
  })
  log("A", `=== Scenario A Complete: ${proofBody.result === "PASS" ? "APPROVED → PAID" : "DENIED"} ===`)
}

async function scenarioB() {
  log("B", "=== Scenario B: Revoked Consent (DENIED, bit 3) ===")

  // 1. Revoke consent
  log("B", "Step 1: Revoking consent...")
  const revokeRes = await fetch(`${CONSENT_URL}/v1/consents/revoke`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ consent_id: "0x" + "77".repeat(32), reason_code: 1 }),
  })
  const revokeBody = await revokeRes.json()
  log("B", "Step 1 result:", revokeBody)

  // 2. Evaluate proof with consent_active=false
  log("B", "Step 2: Evaluating proof with revoked consent...")
  const proofRes = await fetch(`${PROOF_URL}/v1/proofs/medical-necessity`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      claim_id: "0x" + "bb".repeat(32),
      policy_hash: "0x" + "a1".repeat(32),
      consent_active: false,
      credential_valid: true,
    }),
  })
  const proofBody = await proofRes.json()
  const bitmap = parseInt(proofBody.reason_bitmap)
  log("B", `Step 2 result: ${proofBody.result}, bitmap: ${bitmap} (bit 3 set: ${(bitmap & 8) === 8})`, proofBody)
  log("B", `=== Scenario B Complete: DENIED (consent bit ${(bitmap & 8) === 8 ? "SET" : "NOT SET"}) ===`)
}

async function scenarioC() {
  log("C", "=== Scenario C: Challenge (payout blocked → resolution) ===")

  // 1. Submit and approve a claim first
  log("C", "Step 1: Submitting prior auth request...")
  const submitRes = await fetch(`${PROVIDER_URL}/v1/prior-auth/submit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      request_id: crypto.randomUUID(),
      payer_id: "payer-demo-001",
      provider_id_hash: "0x" + "b2".repeat(32),
      encounter_ref_hash: "0x" + "e5".repeat(32),
      procedure_code: "PROC_CARDIAC_CT",
      requested_amount: "120000",
      consent_id: "0x" + "77".repeat(32),
      attestation_jws: "eyJhbGciOiJFUzI1NiJ9.demo",
      service_date: "2026-03-03",
    }),
  })
  const submitBody = await submitRes.json()
  log("C", "Step 1 result:", submitBody)

  // 2. Challenge notification
  log("C", "Step 2: Challenge — payout blocked")
  await fetch(`${CALLBACK_URL}/v1/callbacks/prior-auth-decision`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      claim_id: submitBody.claim_id,
      decision_state: "CHALLENGED",
      reason_bitmap: "0",
    }),
  })

  // 3. Resolution
  log("C", "Step 3: Resolution — approved after review")
  await fetch(`${CALLBACK_URL}/v1/callbacks/prior-auth-decision`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      claim_id: submitBody.claim_id,
      decision_state: "APPROVED",
      reason_bitmap: "0",
    }),
  })

  log("C", "=== Scenario C Complete: CHALLENGED → APPROVED ===")
}

async function main() {
  console.log("\n╔══════════════════════════════════════════╗")
  console.log("║     EASE eHealth MVP Demo Runner              ║")
  console.log("╚══════════════════════════════════════════╝\n")

  // Check services are up
  for (const [name, url] of [
    ["provider-adapter-api", PROVIDER_URL],
    ["proof-service-stub", PROOF_URL],
    ["consent-service", CONSENT_URL],
    ["callback-service", CALLBACK_URL],
  ] as const) {
    try {
      const res = await fetch(`${url}/healthz`)
      const body = await res.json() as { status: string }
      console.log(`  ${name}: ${body.status === "ok" ? "UP" : "DOWN"}`)
    } catch {
      console.log(`  ${name}: DOWN (${url})`)
      console.log("\nPlease start all services first: ./infra/deploy/start-services.sh")
      process.exit(1)
    }
  }
  console.log("")

  await scenarioA()
  console.log("")
  await scenarioB()
  console.log("")
  await scenarioC()

  console.log("\n╔══════════════════════════════════════════╗")
  console.log("║     All 3 Scenarios Complete!            ║")
  console.log("╚══════════════════════════════════════════╝\n")
}

main().catch(console.error)
