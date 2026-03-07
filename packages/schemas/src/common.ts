import { z } from "zod";
import type { Hex } from "viem";

// ---------------------------------------------------------------------------
// Bytes32 — 0x-prefixed 32-byte (64-char) hex string
// ---------------------------------------------------------------------------

/** Branded alias for a 32-byte hex string (compatible with viem `Hex`). */
export type Bytes32 = Hex;

/** Zod schema that validates a 0x-prefixed, 32-byte hex string. */
export const Bytes32Schema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/, "Must be a 0x-prefixed 32-byte hex string");

// ---------------------------------------------------------------------------
// Correlation / anti-replay
// ---------------------------------------------------------------------------

export interface CorrelationContext {
  correlation_id: string;
  workflow_id?: string;
  claim_id?: Bytes32;
}

export const CorrelationContextSchema = z.object({
  correlation_id: z.string().min(1),
  workflow_id: z.string().optional(),
  claim_id: Bytes32Schema.optional(),
});

export interface AntiReplayFields {
  nonce: string;
  issued_at: string;
  expires_at: string;
}

export const AntiReplayFieldsSchema = z.object({
  nonce: z.string().min(1),
  issued_at: z.string().min(1),
  expires_at: z.string().min(1),
});

// ---------------------------------------------------------------------------
// Denial reason bitmap constants
// ---------------------------------------------------------------------------

/** Bit 0 — Provider credential invalid */
export const BIT_CREDENTIAL_INVALID = 1 << 0;

/** Bit 1 — Procedure not covered */
export const BIT_PROCEDURE_NOT_COVERED = 1 << 1;

/** Bit 2 — Amount exceeds cap */
export const BIT_AMOUNT_EXCEEDS_CAP = 1 << 2;

/** Bit 3 — Consent invalid / revoked */
export const BIT_CONSENT_INVALID = 1 << 3;

/** Bit 4 — Duplicate / nullifier collision */
export const BIT_DUPLICATE_NULLIFIER = 1 << 4;

/** Bit 5 — Stale attestation */
export const BIT_STALE_ATTESTATION = 1 << 5;
