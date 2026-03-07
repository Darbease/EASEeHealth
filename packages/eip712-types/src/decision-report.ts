export const DecisionReportTypes = {
  DecisionReport: [
    { name: "claim_id", type: "bytes32" },
    { name: "decision_state", type: "string" },
    { name: "policy_hash", type: "bytes32" },
    { name: "proof_hash", type: "bytes32" },
    { name: "reason_bitmap", type: "uint256" },
    { name: "tx_hash", type: "bytes32" },
  ],
} as const
