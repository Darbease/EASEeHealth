import { z } from "zod";
import type { Bytes32, CorrelationContext, AntiReplayFields } from "./common.js";
import {
  Bytes32Schema,
  CorrelationContextSchema,
  AntiReplayFieldsSchema,
} from "./common.js";
import type { PriorAuthRequest } from "./claim.js";
import { PriorAuthRequestSchema } from "./claim.js";

// ---------------------------------------------------------------------------
// Prior-Auth Submit (provider-adapter-api)
// ---------------------------------------------------------------------------

export type PriorAuthSubmitRequest = PriorAuthRequest & AntiReplayFields;

export const PriorAuthSubmitRequestSchema = PriorAuthRequestSchema.merge(
  AntiReplayFieldsSchema,
);

export interface PriorAuthSubmitResponse {
  status: "ACCEPTED";
  claim_id: Bytes32;
  workflow_id: string;
}

export const PriorAuthSubmitResponseSchema = z.object({
  status: z.literal("ACCEPTED"),
  claim_id: Bytes32Schema,
  workflow_id: z.string().min(1),
});

// ---------------------------------------------------------------------------
// Consent Grant / Revoke (consent-service)
// ---------------------------------------------------------------------------

export type ConsentGrantRequest = {
  consent_id: Bytes32;
  subject_id_hash: Bytes32;
  consent_scope_hash: Bytes32;
  expires_at: string;
  version: number;
} & AntiReplayFields;

export const ConsentGrantRequestSchema = z
  .object({
    consent_id: Bytes32Schema,
    subject_id_hash: Bytes32Schema,
    consent_scope_hash: Bytes32Schema,
    expires_at: z.string().min(1),
    version: z.number().int().nonnegative(),
  })
  .merge(AntiReplayFieldsSchema);

export type ConsentRevokeRequest = {
  consent_id: Bytes32;
  reason_code: number;
} & AntiReplayFields;

export const ConsentRevokeRequestSchema = z
  .object({
    consent_id: Bytes32Schema,
    reason_code: z.number().int(),
  })
  .merge(AntiReplayFieldsSchema);

// ---------------------------------------------------------------------------
// Proof Service (proof-service-stub)
// ---------------------------------------------------------------------------

export interface ProofRequest {
  claim_id: Bytes32;
  policy_hash: Bytes32;
  predicate_inputs_ref: string;
  attestation_refs: string[];
}

export const ProofRequestSchema = z.object({
  claim_id: Bytes32Schema,
  policy_hash: Bytes32Schema,
  predicate_inputs_ref: z.string().min(1),
  attestation_refs: z.array(z.string().min(1)),
});

export interface ProofResponse {
  proof_id: string;
  proof_hash: Bytes32;
  public_inputs_hash: Bytes32;
  result: "PASS" | "FAIL";
  reason_bitmap: string;
}

export const ProofResponseSchema = z.object({
  proof_id: z.string().min(1),
  proof_hash: Bytes32Schema,
  public_inputs_hash: Bytes32Schema,
  result: z.enum(["PASS", "FAIL"]),
  reason_bitmap: z.string(),
});

// ---------------------------------------------------------------------------
// Credential Service
// ---------------------------------------------------------------------------

export interface CredentialVerifyRequest {
  provider_id_hash: Bytes32;
  service_date: string;
}

export const CredentialVerifyRequestSchema = z.object({
  provider_id_hash: Bytes32Schema,
  service_date: z.string().min(1),
});

export interface CredentialVerifyResponse {
  valid: boolean;
  provider_id_hash: Bytes32;
}

export const CredentialVerifyResponseSchema = z.object({
  valid: z.boolean(),
  provider_id_hash: Bytes32Schema,
});

// ---------------------------------------------------------------------------
// Policy Lookup (policy-service)
// ---------------------------------------------------------------------------

export interface PolicyLookupResponse {
  payer_id: string;
  policy_version: string;
  policy_hash: Bytes32;
  active: boolean;
  predicates: Record<string, unknown>;
}

export const PolicyLookupResponseSchema = z.object({
  payer_id: z.string().min(1),
  policy_version: z.string().min(1),
  policy_hash: Bytes32Schema,
  active: z.boolean(),
  predicates: z.record(z.unknown()),
});

// ---------------------------------------------------------------------------
// Decision Callback (decision-callback-service)
// ---------------------------------------------------------------------------

export type CallbackPayload = {
  claim_id: Bytes32;
  decision_state: string;
  reason_bitmap: string;
  tx_hash?: string;
} & CorrelationContext;

export const CallbackPayloadSchema = z
  .object({
    claim_id: Bytes32Schema,
    decision_state: z.string().min(1),
    reason_bitmap: z.string(),
    tx_hash: z.string().optional(),
  })
  .merge(CorrelationContextSchema);
