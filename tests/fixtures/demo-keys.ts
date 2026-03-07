import { privateKeyToAccount } from "viem/accounts"

// Deterministic test keys — DO NOT use in production
export const DEPLOYER_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const
export const CRE_SIGNER_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const
export const OPS_KEY = "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a" as const
export const TREASURY_KEY = "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6" as const
export const PROVIDER_KEY = "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a" as const

export const deployer = privateKeyToAccount(DEPLOYER_KEY)
export const creSigner = privateKeyToAccount(CRE_SIGNER_KEY)
export const opsAccount = privateKeyToAccount(OPS_KEY)
export const treasuryAccount = privateKeyToAccount(TREASURY_KEY)
export const providerAccount = privateKeyToAccount(PROVIDER_KEY)
