import { type Hex, type Address, verifyTypedData } from "viem"
import { PROOFPA_DOMAIN } from "./domain.js"

export async function verifyEip712Signature(
  types: Record<string, Array<{ name: string; type: string }>>,
  primaryType: string,
  message: Record<string, unknown>,
  signature: Hex,
  expectedAddress: Address,
  domain: typeof PROOFPA_DOMAIN = PROOFPA_DOMAIN,
): Promise<boolean> {
  return verifyTypedData({
    domain,
    types,
    primaryType,
    message,
    signature,
    address: expectedAddress,
  })
}
