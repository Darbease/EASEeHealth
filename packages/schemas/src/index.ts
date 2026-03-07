// ---------------------------------------------------------------------------
// @proofpa/schemas — barrel export
// ---------------------------------------------------------------------------

export {
  // Types
  type Bytes32,
  type CorrelationContext,
  type AntiReplayFields,
  // Schemas
  Bytes32Schema,
  CorrelationContextSchema,
  AntiReplayFieldsSchema,
  // Denial bitmap constants
  BIT_CREDENTIAL_INVALID,
  BIT_PROCEDURE_NOT_COVERED,
  BIT_AMOUNT_EXCEEDS_CAP,
  BIT_CONSENT_INVALID,
  BIT_DUPLICATE_NULLIFIER,
  BIT_STALE_ATTESTATION,
} from "./common.js";

export {
  // Enum & types
  ConsentStatus,
  type ConsentRecord,
  type ConsentRecordInput,
  // Schemas
  ConsentStatusSchema,
  ConsentRecordSchema,
  ConsentRecordInputSchema,
} from "./consent.js";

export {
  // Enum & types
  ClaimState,
  type PriorAuthRequest,
  type ClaimDecision,
  type ProofBundle,
  // Schemas
  ClaimStateSchema,
  PriorAuthRequestSchema,
  ClaimDecisionSchema,
  ProofBundleSchema,
} from "./claim.js";

export {
  // Types
  type PolicyVersion,
  // Schemas
  PolicyVersionSchema,
} from "./policy.js";

export {
  // Types
  type PriorAuthSubmitRequest,
  type PriorAuthSubmitResponse,
  type ConsentGrantRequest,
  type ConsentRevokeRequest,
  type ProofRequest,
  type ProofResponse,
  type CredentialVerifyRequest,
  type CredentialVerifyResponse,
  type PolicyLookupResponse,
  type CallbackPayload,
  // Schemas
  PriorAuthSubmitRequestSchema,
  PriorAuthSubmitResponseSchema,
  ConsentGrantRequestSchema,
  ConsentRevokeRequestSchema,
  ProofRequestSchema,
  ProofResponseSchema,
  CredentialVerifyRequestSchema,
  CredentialVerifyResponseSchema,
  PolicyLookupResponseSchema,
  CallbackPayloadSchema,
} from "./api.js";

export {
  // Types
  type ServiceEvent,
  // Schemas
  ServiceEventSchema,
} from "./events.js";

export { computeClaimId } from "./claim-id.js";
export { CLINICAL } from "./demo-clinical-data.js";
