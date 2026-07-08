import { describe, it, expect } from "vitest"
import { keccak256, toHex } from "viem"
import {
  AttesterAttestationTypes,
  buildProofpaDomain,
  verifyEip712Signature,
} from "@proofpa/eip712-types"
import { creSigner, deployer } from "../fixtures/demo-keys.js"

// Cast the readonly `as const` type to the mutable shape the verify helper expects.
const TYPES = AttesterAttestationTypes as unknown as Record<string, Array<{ name: string; type: string }>>

describe("AttesterAttestation EIP-712 envelope", () => {
  const domain = buildProofpaDomain(31337) // Anvil runtime chain
  const message = {
    claim_id: ("0x" + "01".repeat(32)) as `0x${string}`,
    request_digest: keccak256(toHex("attester-request")),
    response_digest: keccak256(toHex("attester-response")),
    result: "PASS",
    reason_bitmap: 0n,
  }

  function sign(signer = creSigner, d = domain) {
    return signer.signTypedData({
      domain: d,
      types: AttesterAttestationTypes,
      primaryType: "AttesterAttestation",
      message,
    })
  }

  it("verifies a valid attester signature", async () => {
    const sig = await sign()
    const ok = await verifyEip712Signature(TYPES, "AttesterAttestation", message, sig, creSigner.address, domain)
    expect(ok).toBe(true)
  })

  it("rejects a signature from a different signer", async () => {
    const sig = await sign()
    const ok = await verifyEip712Signature(TYPES, "AttesterAttestation", message, sig, deployer.address, domain)
    expect(ok).toBe(false)
  })

  it("rejects when the domain chainId differs (the stale 84532 bug we fixed)", async () => {
    const sig = await sign(creSigner, buildProofpaDomain(31337))
    const ok = await verifyEip712Signature(
      TYPES,
      "AttesterAttestation",
      message,
      sig,
      creSigner.address,
      buildProofpaDomain(84532),
    )
    expect(ok).toBe(false)
  })
})
