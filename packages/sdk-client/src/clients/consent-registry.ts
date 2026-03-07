import type { PublicClient, WalletClient, Address, Hex } from "viem"
import { consentRegistryAbi } from "../abis.js"

export async function isConsentActive(
  client: PublicClient,
  address: Address,
  consentId: Hex,
  atTs: bigint,
): Promise<boolean> {
  return client.readContract({
    address,
    abi: consentRegistryAbi,
    functionName: "isConsentActive",
    args: [consentId, atTs],
  })
}

export async function getConsent(client: PublicClient, address: Address, consentId: Hex) {
  return client.readContract({
    address,
    abi: consentRegistryAbi,
    functionName: "getConsent",
    args: [consentId],
  })
}

export async function upsertConsent(
  walletClient: WalletClient,
  publicClient: PublicClient,
  address: Address,
  input: { consentId: Hex; subjectIdHash: Hex; consentScopeHash: Hex; expiresAt: bigint; version: number },
) {
  const hash = await walletClient.writeContract({
    address,
    abi: consentRegistryAbi,
    functionName: "upsertConsent",
    args: [{ consentId: input.consentId, subjectIdHash: input.subjectIdHash, consentScopeHash: input.consentScopeHash, expiresAt: input.expiresAt, version: input.version }],
    chain: walletClient.chain,
    account: walletClient.account!,
  })
  return publicClient.waitForTransactionReceipt({ hash })
}

export async function revokeConsent(
  walletClient: WalletClient,
  publicClient: PublicClient,
  address: Address,
  consentId: Hex,
  reasonCode: number,
) {
  const hash = await walletClient.writeContract({
    address,
    abi: consentRegistryAbi,
    functionName: "revokeConsent",
    args: [consentId, reasonCode],
    chain: walletClient.chain,
    account: walletClient.account!,
  })
  return publicClient.waitForTransactionReceipt({ hash })
}
