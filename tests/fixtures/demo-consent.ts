import { keccak256, toHex } from "viem"

export const DEMO_CONSENT_ID = keccak256(toHex("consent-demo-001"))
export const DEMO_SUBJECT_ID_HASH = keccak256(toHex("patient-demo-abc"))
export const DEMO_CONSENT_SCOPE_HASH = keccak256(toHex("scope-prior-auth-payment"))

export function createDemoConsentInput(expiresAt: bigint) {
  return {
    consentId: DEMO_CONSENT_ID,
    subjectIdHash: DEMO_SUBJECT_ID_HASH,
    consentScopeHash: DEMO_CONSENT_SCOPE_HASH,
    expiresAt,
    version: 1,
  }
}
