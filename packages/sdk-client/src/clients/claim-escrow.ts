import type { PublicClient, WalletClient, Address, Hex } from "viem"
import { claimEscrowAbi } from "../abis.js"

export async function getPayout(client: PublicClient, address: Address, claimId: Hex) {
  return client.readContract({
    address,
    abi: claimEscrowAbi,
    functionName: "getPayout",
    args: [claimId],
  })
}

export async function fundPool(
  walletClient: WalletClient,
  publicClient: PublicClient,
  address: Address,
  amount: bigint,
) {
  const hash = await walletClient.writeContract({
    address,
    abi: claimEscrowAbi,
    functionName: "fundPool",
    args: [amount],
    chain: walletClient.chain,
    account: walletClient.account!,
  })
  return publicClient.waitForTransactionReceipt({ hash })
}

export async function schedulePayout(
  walletClient: WalletClient,
  publicClient: PublicClient,
  address: Address,
  claimId: Hex,
  recipient: Address,
  amount: bigint,
) {
  const hash = await walletClient.writeContract({
    address,
    abi: claimEscrowAbi,
    functionName: "schedulePayout",
    args: [claimId, recipient, amount],
    chain: walletClient.chain,
    account: walletClient.account!,
  })
  return publicClient.waitForTransactionReceipt({ hash })
}

export async function releasePayout(
  walletClient: WalletClient,
  publicClient: PublicClient,
  address: Address,
  claimId: Hex,
) {
  const hash = await walletClient.writeContract({
    address,
    abi: claimEscrowAbi,
    functionName: "releasePayout",
    args: [claimId],
    chain: walletClient.chain,
    account: walletClient.account!,
  })
  return publicClient.waitForTransactionReceipt({ hash })
}

export async function cancelPayout(
  walletClient: WalletClient,
  publicClient: PublicClient,
  address: Address,
  claimId: Hex,
) {
  const hash = await walletClient.writeContract({
    address,
    abi: claimEscrowAbi,
    functionName: "cancelPayout",
    args: [claimId],
    chain: walletClient.chain,
    account: walletClient.account!,
  })
  return publicClient.waitForTransactionReceipt({ hash })
}
