import { z } from "zod";
import type { Bytes32 } from "./common.js";
import { Bytes32Schema } from "./common.js";

// ---------------------------------------------------------------------------
// ConsentStatus enum
// ---------------------------------------------------------------------------

export enum ConsentStatus {
  ACTIVE = 0,
  REVOKED = 1,
  EXPIRED = 2,
}

export const ConsentStatusSchema = z.nativeEnum(ConsentStatus);

// ---------------------------------------------------------------------------
// ConsentRecord — full on-chain representation
// ---------------------------------------------------------------------------

export interface ConsentRecord {
  consent_id: Bytes32;
  subject_id_hash: Bytes32;
  consent_scope_hash: Bytes32;
  issued_at: bigint;
  expires_at: bigint;
  status: ConsentStatus;
  version: number;
}

export const ConsentRecordSchema = z.object({
  consent_id: Bytes32Schema,
  subject_id_hash: Bytes32Schema,
  consent_scope_hash: Bytes32Schema,
  issued_at: z.bigint(),
  expires_at: z.bigint(),
  status: ConsentStatusSchema,
  version: z.number().int().nonnegative(),
});

// ---------------------------------------------------------------------------
// ConsentRecordInput — what the caller provides (no issued_at / status)
// ---------------------------------------------------------------------------

export interface ConsentRecordInput {
  consent_id: Bytes32;
  subject_id_hash: Bytes32;
  consent_scope_hash: Bytes32;
  expires_at: bigint;
  version: number;
}

export const ConsentRecordInputSchema = z.object({
  consent_id: Bytes32Schema,
  subject_id_hash: Bytes32Schema,
  consent_scope_hash: Bytes32Schema,
  expires_at: z.bigint(),
  version: z.number().int().nonnegative(),
});
