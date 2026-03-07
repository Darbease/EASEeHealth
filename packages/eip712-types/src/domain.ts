import type { TypedDataDomain } from "viem"

export const PROOFPA_DOMAIN: TypedDataDomain = {
  name: "ProofPA",
  version: "1",
  chainId: 84532, // Base Sepolia
} as const
