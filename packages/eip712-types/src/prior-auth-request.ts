export const PriorAuthRequestTypes = {
  PriorAuthRequest: [
    { name: "request_id", type: "string" },
    { name: "payer_id", type: "string" },
    { name: "provider_id_hash", type: "bytes32" },
    { name: "encounter_ref_hash", type: "bytes32" },
    { name: "procedure_code", type: "string" },
    { name: "requested_amount", type: "string" },
    { name: "consent_id", type: "bytes32" },
    { name: "service_date", type: "string" },
    { name: "nonce", type: "string" },
    { name: "issued_at", type: "string" },
    { name: "expires_at", type: "string" },
  ],
} as const
