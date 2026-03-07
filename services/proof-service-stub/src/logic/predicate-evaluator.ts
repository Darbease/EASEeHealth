export interface PredicateInputs {
  credential_valid: boolean
  procedure_code: string
  covered_procedures: string[]
  requested_amount: number
  amount_caps: Record<string, number>
  consent_active: boolean
  is_duplicate: boolean
  attestation_age_seconds: number
  attestation_max_age_seconds: number
}

export interface PredicateResult {
  result: "PASS" | "FAIL"
  reason_bitmap: number
}

const BIT_CREDENTIAL_INVALID = 1 << 0
const BIT_PROCEDURE_NOT_COVERED = 1 << 1
const BIT_AMOUNT_EXCEEDS_CAP = 1 << 2
const BIT_CONSENT_INVALID = 1 << 3
const BIT_DUPLICATE_NULLIFIER = 1 << 4
const BIT_STALE_ATTESTATION = 1 << 5

export function evaluatePredicates(inputs: PredicateInputs): PredicateResult {
  let bitmap = 0

  if (!inputs.credential_valid) bitmap |= BIT_CREDENTIAL_INVALID
  if (!inputs.covered_procedures.includes(inputs.procedure_code)) bitmap |= BIT_PROCEDURE_NOT_COVERED

  const cap = inputs.amount_caps[inputs.procedure_code]
  if (cap !== undefined && inputs.requested_amount > cap) bitmap |= BIT_AMOUNT_EXCEEDS_CAP

  if (!inputs.consent_active) bitmap |= BIT_CONSENT_INVALID
  if (inputs.is_duplicate) bitmap |= BIT_DUPLICATE_NULLIFIER
  if (inputs.attestation_age_seconds > inputs.attestation_max_age_seconds) bitmap |= BIT_STALE_ATTESTATION

  return {
    result: bitmap === 0 ? "PASS" : "FAIL",
    reason_bitmap: bitmap,
  }
}
