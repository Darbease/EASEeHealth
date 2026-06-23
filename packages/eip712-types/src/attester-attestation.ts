// ---------------------------------------------------------------------------
// AttesterAttestation — the envelope a Confidential AI Attester signs over its
// verdict. Binds the on-chain claim to the request/response digests of the TEE
// inference plus the decision, so the signature proves "this verdict came from
// this model over this document". Verified via verifyEip712Signature.
// ---------------------------------------------------------------------------
export const AttesterAttestationTypes = {
  AttesterAttestation: [
    { name: "claim_id", type: "bytes32" },
    { name: "request_digest", type: "bytes32" },
    { name: "response_digest", type: "bytes32" },
    { name: "result", type: "string" },
    { name: "reason_bitmap", type: "uint256" },
  ],
} as const
