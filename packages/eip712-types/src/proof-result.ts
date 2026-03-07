export const ProofResultTypes = {
  ProofResult: [
    { name: "claim_id", type: "bytes32" },
    { name: "proof_hash", type: "bytes32" },
    { name: "public_inputs_hash", type: "bytes32" },
    { name: "result", type: "string" },
    { name: "reason_bitmap", type: "uint256" },
  ],
} as const
