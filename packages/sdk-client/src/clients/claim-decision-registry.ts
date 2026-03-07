import type { PublicClient, WalletClient, Address, Hex } from "viem"
import { claimDecisionRegistryAbi } from "../abis.js"

export async function getDecision(client: PublicClient, address: Address, claimId: Hex) {
  return client.readContract({
    address,
    abi: claimDecisionRegistryAbi,
    functionName: "getDecision",
    args: [claimId],
  })
}

export async function submitClaim(
  walletClient: WalletClient,
  publicClient: PublicClient,
  address: Address,
  claimId: Hex,
  policyHash: Hex,
) {
  const hash = await walletClient.writeContract({
    address,
    abi: claimDecisionRegistryAbi,
    functionName: "submitClaim",
    args: [claimId, policyHash],
    chain: walletClient.chain,
    account: walletClient.account!,
  })
  return publicClient.waitForTransactionReceipt({ hash })
}

export async function setProofResult(
  walletClient: WalletClient,
  publicClient: PublicClient,
  address: Address,
  claimId: Hex,
  proofHash: Hex,
  reasonBitmap: bigint,
  approved: boolean,
) {
  const hash = await walletClient.writeContract({
    address,
    abi: claimDecisionRegistryAbi,
    functionName: "setProofResult",
    args: [claimId, proofHash, reasonBitmap, approved],
    chain: walletClient.chain,
    account: walletClient.account!,
  })
  return publicClient.waitForTransactionReceipt({ hash })
}

export async function challengeClaim(
  walletClient: WalletClient,
  publicClient: PublicClient,
  address: Address,
  claimId: Hex,
  reasonCode: number,
) {
  const hash = await walletClient.writeContract({
    address,
    abi: claimDecisionRegistryAbi,
    functionName: "challengeClaim",
    args: [claimId, reasonCode],
    chain: walletClient.chain,
    account: walletClient.account!,
  })
  return publicClient.waitForTransactionReceipt({ hash })
}

export async function resolveChallenge(
  walletClient: WalletClient,
  publicClient: PublicClient,
  address: Address,
  claimId: Hex,
  approve: boolean,
) {
  const hash = await walletClient.writeContract({
    address,
    abi: claimDecisionRegistryAbi,
    functionName: "resolveChallenge",
    args: [claimId, approve],
    chain: walletClient.chain,
    account: walletClient.account!,
  })
  return publicClient.waitForTransactionReceipt({ hash })
}

export async function markPaid(
  walletClient: WalletClient,
  publicClient: PublicClient,
  address: Address,
  claimId: Hex,
) {
  const hash = await walletClient.writeContract({
    address,
    abi: claimDecisionRegistryAbi,
    functionName: "markPaid",
    args: [claimId],
    chain: walletClient.chain,
    account: walletClient.account!,
  })
  return publicClient.waitForTransactionReceipt({ hash })
}
