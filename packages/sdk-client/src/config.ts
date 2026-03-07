import type { Address, Chain } from "viem"
import { baseSepolia } from "viem/chains"

export interface ProofPAConfig {
  chain: Chain
  consentRegistryAddress: Address
  policyRegistryAddress: Address
  claimDecisionRegistryAddress: Address
  claimEscrowAddress: Address
  mockUsdcAddress: Address
}

export function loadConfigFromEnv(): ProofPAConfig {
  return {
    chain: baseSepolia,
    consentRegistryAddress: (process.env.CONSENT_REGISTRY_ADDRESS ?? "0x") as Address,
    policyRegistryAddress: (process.env.POLICY_REGISTRY_ADDRESS ?? "0x") as Address,
    claimDecisionRegistryAddress: (process.env.CLAIM_DECISION_REGISTRY_ADDRESS ?? "0x") as Address,
    claimEscrowAddress: (process.env.CLAIM_ESCROW_ADDRESS ?? "0x") as Address,
    mockUsdcAddress: (process.env.MOCK_USDC_ADDRESS ?? "0x") as Address,
  }
}
