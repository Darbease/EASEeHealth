import type { TypedDataDomain } from "viem"

/**
 * Build the ProofPA EIP-712 domain for a given chain. Defaults to the runtime
 * chain id (Anvil 31337), overridable via PROOFPA_CHAIN_ID / CHAIN_ID so the
 * signing domain matches whatever network the deployment targets.
 *
 * NB: this was previously hardcoded to 84532 (Base Sepolia), which never matched
 * the Anvil/Eth-Sepolia runtime — see docs/ATTESTER_INTEGRATION_PLAN.md §8.
 */
export function buildProofpaDomain(chainId?: number): TypedDataDomain {
  const resolved = chainId ?? Number(process.env.PROOFPA_CHAIN_ID ?? process.env.CHAIN_ID ?? 31337)
  return {
    name: "ProofPA",
    version: "1",
    chainId: resolved,
  }
}

export const PROOFPA_DOMAIN: TypedDataDomain = buildProofpaDomain()
