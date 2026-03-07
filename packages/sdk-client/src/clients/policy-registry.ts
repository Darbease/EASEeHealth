import type { PublicClient, WalletClient, Address, Hex } from "viem"
import { policyRegistryAbi } from "../abis.js"

export async function isPolicyActive(
  client: PublicClient,
  address: Address,
  policyHash: Hex,
  atTs: bigint,
): Promise<boolean> {
  return client.readContract({
    address,
    abi: policyRegistryAbi,
    functionName: "isPolicyActive",
    args: [policyHash, atTs],
  })
}

export async function getPolicyVersion(client: PublicClient, address: Address, policyHash: Hex) {
  return client.readContract({
    address,
    abi: policyRegistryAbi,
    functionName: "getPolicyVersion",
    args: [policyHash],
  })
}

export async function setPolicyVersion(
  walletClient: WalletClient,
  publicClient: PublicClient,
  address: Address,
  params: { policyHash: Hex; verifierKeyHash: Hex; effectiveFrom: bigint; effectiveTo: bigint; active: boolean },
) {
  const hash = await walletClient.writeContract({
    address,
    abi: policyRegistryAbi,
    functionName: "setPolicyVersion",
    args: [params.policyHash, params.verifierKeyHash, params.effectiveFrom, params.effectiveTo, params.active],
    chain: walletClient.chain,
    account: walletClient.account!,
  })
  return publicClient.waitForTransactionReceipt({ hash })
}
