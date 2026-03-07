import { keccak256, toHex } from "viem"

export const DEMO_PAYER_ID = "payer-demo-001"
export const DEMO_POLICY_VERSION = "v1"

export const DEMO_POLICY_HASH = keccak256(toHex("demo-policy-v1"))
export const DEMO_VERIFIER_KEY_HASH = keccak256(toHex("demo-verifier-key"))

export const DEMO_POLICY = {
  payer_id: DEMO_PAYER_ID,
  policy_version: DEMO_POLICY_VERSION,
  policy_hash: DEMO_POLICY_HASH,
  active: true,
  predicates: {
    covered_procedures: ["PROC_KNEE_MRI", "PROC_CARDIAC_CT", "PROC_SPINE_XRAY"],
    amount_caps: { PROC_KNEE_MRI: 100000, PROC_CARDIAC_CT: 150000, PROC_SPINE_XRAY: 50000 },
    attestation_max_age_seconds: 86400,
  },
}
