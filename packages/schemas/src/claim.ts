import { z } from "zod";
import type { Bytes32 } from "./common.js";
import { Bytes32Schema } from "./common.js";

// ---------------------------------------------------------------------------
// ClaimState enum — mirrors the on-chain state machine
// ---------------------------------------------------------------------------

export enum ClaimState {
  NONE = 0,
  SUBMITTED = 1,
  PROOF_PENDING = 2,
  APPROVED = 3,
  DENIED = 4,
  CHALLENGED = 5,
  PAID = 6,
}

export const ClaimStateSchema = z.nativeEnum(ClaimState);

// ---------------------------------------------------------------------------
// PriorAuthRequest — the payload submitted by the provider adapter
// ---------------------------------------------------------------------------

export interface PriorAuthRequest {
  request_id: string;
  claim_id: Bytes32;
  payer_id: string;
  provider_id_hash: Bytes32;
  encounter_ref_hash: Bytes32;
  procedure_code: string;
  requested_amount: string;
  currency: string;
  consent_id: Bytes32;
  attestation_jws: string;
  service_date: string;
  callback_url: string;
}

export const PriorAuthRequestSchema = z.object({
  request_id: z.string().min(1),
  claim_id: Bytes32Schema,
  payer_id: z.string().min(1),
  provider_id_hash: Bytes32Schema,
  encounter_ref_hash: Bytes32Schema,
  procedure_code: z.string().min(1),
  requested_amount: z.string().min(1),
  currency: z.string().min(1),
  consent_id: Bytes32Schema,
  attestation_jws: z.string().min(1),
  service_date: z.string().min(1),
  callback_url: z.string().url(),
});

// ---------------------------------------------------------------------------
// ClaimDecision — on-chain claim state snapshot
// ---------------------------------------------------------------------------

export interface ClaimDecision {
  claim_id: Bytes32;
  state: ClaimState;
  policy_hash: Bytes32;
  proof_hash: Bytes32;
  reason_bitmap: bigint;
  updated_at: bigint;
}

export const ClaimDecisionSchema = z.object({
  claim_id: Bytes32Schema,
  state: ClaimStateSchema,
  policy_hash: Bytes32Schema,
  proof_hash: Bytes32Schema,
  reason_bitmap: z.bigint(),
  updated_at: z.bigint(),
});

// ---------------------------------------------------------------------------
// ProofBundle — output from the proof service
// ---------------------------------------------------------------------------

export interface ProofBundle {
  proof_id: string;
  proof_hash: Bytes32;
  public_inputs_hash: Bytes32;
  verifier_key_hash: Bytes32;
  result: "PASS" | "FAIL";
  reason_bitmap: bigint;
}

export const ProofBundleSchema = z.object({
  proof_id: z.string().min(1),
  proof_hash: Bytes32Schema,
  public_inputs_hash: Bytes32Schema,
  verifier_key_hash: Bytes32Schema,
  result: z.enum(["PASS", "FAIL"]),
  reason_bitmap: z.bigint(),
});
