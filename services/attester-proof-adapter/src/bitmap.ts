// ---------------------------------------------------------------------------
// Denial reason bitmap — bits 0..7 mirror services/proof-service-stub and the
// CLAUDE.md table; bit 8 is the NEW, additive medical-necessity axis the AI
// Attester introduces. reasonBitmap is uint256 on-chain, so bit 8 needs no
// contract change.
// ---------------------------------------------------------------------------
export const BIT_CREDENTIAL_INVALID = 1 << 0;
export const BIT_PROCEDURE_NOT_COVERED = 1 << 1;
export const BIT_AMOUNT_EXCEEDS_CAP = 1 << 2;
export const BIT_CONSENT_INVALID = 1 << 3;
export const BIT_DUPLICATE_NULLIFIER = 1 << 4;
export const BIT_STALE_ATTESTATION = 1 << 5;
export const BIT_MEDICATION_NOT_COVERED = 1 << 6;
export const BIT_MED_AMOUNT_EXCEEDS_CAP = 1 << 7;
export const BIT_MEDICAL_NECESSITY = 1 << 8; // 256 — necessity not established (AI Attester)

/** Mask of the structured policy/operational bits (0..7) the stub already owns. */
export const POLICY_BITS_MASK = 0xff;

export const BITMAP_LABELS: string[] = [
  "Provider credential invalid",
  "Procedure not covered",
  "Amount exceeds cap",
  "Consent invalid/revoked",
  "Duplicate/nullifier collision",
  "Stale attestation",
  "Medication not on formulary",
  "Medication amount exceeds cap",
  "Medical necessity not established",
];

export function decodeBitmap(bitmap: number): string[] {
  const reasons: string[] = [];
  for (let i = 0; i < BITMAP_LABELS.length; i++) {
    if (bitmap & (1 << i)) reasons.push(BITMAP_LABELS[i]);
  }
  return reasons;
}

export interface PredicateInputs {
  credential_valid: boolean;
  procedure_code: string;
  covered_procedures: string[];
  requested_amount: number;
  amount_caps: Record<string, number>;
  consent_active: boolean;
  is_duplicate: boolean;
  attestation_age_seconds: number;
  attestation_max_age_seconds: number;
  medication_code?: string;
  medication_amount?: number;
  covered_medications?: string[];
  medication_caps?: Record<string, number>;
}

/**
 * Deterministic structured-predicate evaluation (bits 0..7). Identical in
 * behaviour to services/proof-service-stub/src/logic/predicate-evaluator.ts —
 * preserved here so the adapter can keep the existing policy bits correct even
 * when the AI verdict is what drives `approved` + the necessity bit.
 */
export function evaluatePolicyBits(inputs: PredicateInputs): number {
  let bitmap = 0;
  if (!inputs.credential_valid) bitmap |= BIT_CREDENTIAL_INVALID;
  if (!inputs.covered_procedures.includes(inputs.procedure_code)) bitmap |= BIT_PROCEDURE_NOT_COVERED;

  const cap = inputs.amount_caps[inputs.procedure_code];
  if (cap !== undefined && inputs.requested_amount > cap) bitmap |= BIT_AMOUNT_EXCEEDS_CAP;

  if (!inputs.consent_active) bitmap |= BIT_CONSENT_INVALID;
  if (inputs.is_duplicate) bitmap |= BIT_DUPLICATE_NULLIFIER;
  if (inputs.attestation_age_seconds > inputs.attestation_max_age_seconds) bitmap |= BIT_STALE_ATTESTATION;

  if (inputs.medication_code && inputs.covered_medications) {
    if (!inputs.covered_medications.includes(inputs.medication_code)) bitmap |= BIT_MEDICATION_NOT_COVERED;
  }
  if (inputs.medication_code && inputs.medication_amount !== undefined && inputs.medication_caps) {
    const medCap = inputs.medication_caps[inputs.medication_code];
    if (medCap !== undefined && inputs.medication_amount > medCap) bitmap |= BIT_MED_AMOUNT_EXCEEDS_CAP;
  }
  return bitmap;
}
