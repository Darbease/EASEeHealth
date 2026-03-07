import { type WalletClient, type Hex } from "viem"
import { PROOFPA_DOMAIN } from "./domain.js"

export async function signTypedData(
  client: WalletClient,
  types: Record<string, Array<{ name: string; type: string }>>,
  primaryType: string,
  message: Record<string, unknown>,
): Promise<Hex> {
  const account = client.account
  if (!account) throw new Error("WalletClient must have an account")
  return client.signTypedData({
    account,
    domain: PROOFPA_DOMAIN,
    types,
    primaryType,
    message,
  })
}
