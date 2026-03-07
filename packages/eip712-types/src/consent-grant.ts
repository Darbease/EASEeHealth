export const ConsentGrantTypes = {
  ConsentGrant: [
    { name: "consent_id", type: "bytes32" },
    { name: "subject_id_hash", type: "bytes32" },
    { name: "consent_scope_hash", type: "bytes32" },
    { name: "expires_at", type: "string" },
    { name: "version", type: "uint32" },
    { name: "nonce", type: "string" },
    { name: "issued_at", type: "string" },
    { name: "expires_at_replay", type: "string" },
  ],
} as const
