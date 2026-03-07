export const ConsentRevokeTypes = {
  ConsentRevoke: [
    { name: "consent_id", type: "bytes32" },
    { name: "reason_code", type: "uint16" },
    { name: "nonce", type: "string" },
    { name: "issued_at", type: "string" },
    { name: "expires_at", type: "string" },
  ],
} as const
