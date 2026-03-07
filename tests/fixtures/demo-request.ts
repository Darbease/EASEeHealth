import { keccak256, toHex, encodePacked } from "viem"
import { randomUUID } from "node:crypto"

export const DEMO_PROVIDER_ID_HASH = ("0x" + "b2".repeat(32)) as `0x${string}`
export const DEMO_ENCOUNTER_REF_HASH = keccak256(toHex("encounter-demo-001"))
export const DEMO_PROCEDURE_CODE = "PROC_KNEE_MRI"
export const DEMO_REQUESTED_AMOUNT = "85000" // 85,000 USDC minor units
export const DEMO_SERVICE_DATE = "2026-03-03"

export function computeDemoClaimId(): `0x${string}` {
  return keccak256(
    encodePacked(
      ["string", "bytes32", "bytes32", "string", "string"],
      ["payer-demo-001", DEMO_PROVIDER_ID_HASH, DEMO_ENCOUNTER_REF_HASH, DEMO_PROCEDURE_CODE, DEMO_SERVICE_DATE],
    ),
  )
}

export function createDemoPriorAuthRequest(consentId: `0x${string}`) {
  return {
    request_id: randomUUID(),
    payer_id: "payer-demo-001",
    provider_id_hash: DEMO_PROVIDER_ID_HASH,
    encounter_ref_hash: DEMO_ENCOUNTER_REF_HASH,
    procedure_code: DEMO_PROCEDURE_CODE,
    requested_amount: DEMO_REQUESTED_AMOUNT,
    currency: "USDC_6",
    consent_id: consentId,
    attestation_jws: "eyJhbGciOiJFUzI1NiJ9.demo-attestation",
    service_date: DEMO_SERVICE_DATE,
    callback_url: "http://localhost:3006/v1/callbacks/prior-auth-decision",
  }
}
