import { describe, it, expect, beforeAll } from "vitest"
import {
  createPublicClient,
  createWalletClient,
  http,
  parseUnits,
  type PublicClient,
  type WalletClient,
  type Address,
  type Hex,
  getAddress,
} from "viem"
import { foundry } from "viem/chains"
import { deployer, creSigner, opsAccount, treasuryAccount } from "../fixtures/demo-keys.js"
import { DEMO_POLICY_HASH, DEMO_VERIFIER_KEY_HASH } from "../fixtures/demo-policy.js"
import { DEMO_CONSENT_ID, DEMO_SUBJECT_ID_HASH, DEMO_CONSENT_SCOPE_HASH } from "../fixtures/demo-consent.js"
import { computeDemoClaimId } from "../fixtures/demo-request.js"
import {
  mockUsdcAbi,
  consentRegistryAbi,
  policyRegistryAbi,
  claimDecisionRegistryAbi,
  claimEscrowAbi,
} from "@proofpa/sdk-client"

// This test requires an Anvil instance running on localhost:8545
// Start with: anvil

const ANVIL_URL = "http://127.0.0.1:8545"

describe("Cross-contract integration", () => {
  let publicClient: PublicClient
  let deployerWallet: WalletClient
  let creSignerWallet: WalletClient
  let opsWallet: WalletClient
  let treasuryWallet: WalletClient

  let mockUsdcAddr: Address
  let consentAddr: Address
  let policyAddr: Address
  let claimDecisionAddr: Address
  let escrowAddr: Address

  beforeAll(async () => {
    publicClient = createPublicClient({ chain: foundry, transport: http(ANVIL_URL) })
    deployerWallet = createWalletClient({ chain: foundry, transport: http(ANVIL_URL), account: deployer })
    creSignerWallet = createWalletClient({ chain: foundry, transport: http(ANVIL_URL), account: creSigner })
    opsWallet = createWalletClient({ chain: foundry, transport: http(ANVIL_URL), account: opsAccount })
    treasuryWallet = createWalletClient({ chain: foundry, transport: http(ANVIL_URL), account: treasuryAccount })

    // Deploy MockUSDC
    let hash = await deployerWallet.deployContract({
      abi: mockUsdcAbi, bytecode: await getContractBytecode("MockUSDC"),
      chain: foundry, account: deployer,
    })
    let receipt = await publicClient.waitForTransactionReceipt({ hash })
    mockUsdcAddr = receipt.contractAddress!

    // Deploy ConsentRegistry
    hash = await deployerWallet.deployContract({
      abi: consentRegistryAbi, bytecode: await getContractBytecode("ConsentRegistry"),
      args: [deployer.address], chain: foundry, account: deployer,
    })
    receipt = await publicClient.waitForTransactionReceipt({ hash })
    consentAddr = receipt.contractAddress!

    // Deploy PolicyRegistry
    hash = await deployerWallet.deployContract({
      abi: policyRegistryAbi, bytecode: await getContractBytecode("PolicyRegistry"),
      args: [deployer.address], chain: foundry, account: deployer,
    })
    receipt = await publicClient.waitForTransactionReceipt({ hash })
    policyAddr = receipt.contractAddress!

    // Deploy ClaimDecisionRegistry
    hash = await deployerWallet.deployContract({
      abi: claimDecisionRegistryAbi, bytecode: await getContractBytecode("ClaimDecisionRegistry"),
      args: [deployer.address], chain: foundry, account: deployer,
    })
    receipt = await publicClient.waitForTransactionReceipt({ hash })
    claimDecisionAddr = receipt.contractAddress!

    // Deploy ClaimEscrow
    hash = await deployerWallet.deployContract({
      abi: claimEscrowAbi, bytecode: await getContractBytecode("ClaimEscrow"),
      args: [deployer.address, mockUsdcAddr], chain: foundry, account: deployer,
    })
    receipt = await publicClient.waitForTransactionReceipt({ hash })
    escrowAddr = receipt.contractAddress!

    // Grant roles
    const WORKFLOW_ROLE = await publicClient.readContract({ address: consentAddr, abi: consentRegistryAbi, functionName: "WORKFLOW_ROLE" })
    const POLICY_ADMIN_ROLE = await publicClient.readContract({ address: policyAddr, abi: policyRegistryAbi, functionName: "POLICY_ADMIN_ROLE" })
    const CLAIM_WORKFLOW_ROLE = await publicClient.readContract({ address: claimDecisionAddr, abi: claimDecisionRegistryAbi, functionName: "WORKFLOW_ROLE" })
    const CHALLENGE_ROLE = await publicClient.readContract({ address: claimDecisionAddr, abi: claimDecisionRegistryAbi, functionName: "CHALLENGE_ROLE" })
    const ESCROW_WORKFLOW_ROLE = await publicClient.readContract({ address: escrowAddr, abi: claimEscrowAbi, functionName: "WORKFLOW_ROLE" })
    const ESCROW_CHALLENGE_ROLE = await publicClient.readContract({ address: escrowAddr, abi: claimEscrowAbi, functionName: "CHALLENGE_ROLE" })
    const TREASURY_ROLE = await publicClient.readContract({ address: escrowAddr, abi: claimEscrowAbi, functionName: "TREASURY_ROLE" })

    // Grant all roles
    for (const [addr, abi, role, grantee] of [
      [consentAddr, consentRegistryAbi, WORKFLOW_ROLE, creSigner.address],
      [policyAddr, policyRegistryAbi, POLICY_ADMIN_ROLE, deployer.address],
      [claimDecisionAddr, claimDecisionRegistryAbi, CLAIM_WORKFLOW_ROLE, creSigner.address],
      [claimDecisionAddr, claimDecisionRegistryAbi, CHALLENGE_ROLE, opsAccount.address],
      [escrowAddr, claimEscrowAbi, ESCROW_WORKFLOW_ROLE, creSigner.address],
      [escrowAddr, claimEscrowAbi, ESCROW_CHALLENGE_ROLE, opsAccount.address],
      [escrowAddr, claimEscrowAbi, TREASURY_ROLE, treasuryAccount.address],
    ] as const) {
      const h = await deployerWallet.writeContract({
        address: addr as Address, abi: abi as any, functionName: "grantRole",
        args: [role, grantee], chain: foundry, account: deployer,
      })
      await publicClient.waitForTransactionReceipt({ hash: h })
    }

    // Seed policy
    const h1 = await deployerWallet.writeContract({
      address: policyAddr, abi: policyRegistryAbi, functionName: "setPolicyVersion",
      args: [DEMO_POLICY_HASH, DEMO_VERIFIER_KEY_HASH, BigInt(Math.floor(Date.now() / 1000)), BigInt(Math.floor(Date.now() / 1000) + 365 * 86400), true],
      chain: foundry, account: deployer,
    })
    await publicClient.waitForTransactionReceipt({ hash: h1 })

    // Mint and fund escrow
    const fundAmount = parseUnits("1000000", 6) // 1M USDC
    const h2 = await deployerWallet.writeContract({
      address: mockUsdcAddr, abi: mockUsdcAbi, functionName: "mint",
      args: [treasuryAccount.address, fundAmount], chain: foundry, account: deployer,
    })
    await publicClient.waitForTransactionReceipt({ hash: h2 })

    const h3 = await treasuryWallet.writeContract({
      address: mockUsdcAddr, abi: mockUsdcAbi, functionName: "approve",
      args: [escrowAddr, fundAmount], chain: foundry, account: treasuryAccount,
    })
    await publicClient.waitForTransactionReceipt({ hash: h3 })

    const h4 = await treasuryWallet.writeContract({
      address: escrowAddr, abi: claimEscrowAbi, functionName: "fundPool",
      args: [fundAmount], chain: foundry, account: treasuryAccount,
    })
    await publicClient.waitForTransactionReceipt({ hash: h4 })
  })

  it("full claim lifecycle: consent → submit → approve → payout → paid", async () => {
    const claimId = computeDemoClaimId()
    const payoutAmount = parseUnits("850", 6) // 850 USDC
    const recipientAddr = getAddress("0x70997970C51812dc3A010C7d01b50e0d17dc79C8")

    // 1. Grant consent
    const h1 = await creSignerWallet.writeContract({
      address: consentAddr, abi: consentRegistryAbi, functionName: "upsertConsent",
      args: [{ consentId: DEMO_CONSENT_ID, subjectIdHash: DEMO_SUBJECT_ID_HASH, consentScopeHash: DEMO_CONSENT_SCOPE_HASH, expiresAt: BigInt(Math.floor(Date.now() / 1000) + 86400), version: 1 }],
      chain: foundry, account: creSigner,
    })
    await publicClient.waitForTransactionReceipt({ hash: h1 })

    // Verify consent is active
    const active = await publicClient.readContract({
      address: consentAddr, abi: consentRegistryAbi, functionName: "isConsentActive",
      args: [DEMO_CONSENT_ID, BigInt(Math.floor(Date.now() / 1000))],
    })
    expect(active).toBe(true)

    // 2. Submit claim
    const h2 = await creSignerWallet.writeContract({
      address: claimDecisionAddr, abi: claimDecisionRegistryAbi, functionName: "submitClaim",
      args: [claimId, DEMO_POLICY_HASH], chain: foundry, account: creSigner,
    })
    await publicClient.waitForTransactionReceipt({ hash: h2 })

    // 3. Set proof result (approved)
    const proofHash = "0x" + "ff".repeat(32) as Hex
    const h3 = await creSignerWallet.writeContract({
      address: claimDecisionAddr, abi: claimDecisionRegistryAbi, functionName: "setProofResult",
      args: [claimId, proofHash, 0n, true], chain: foundry, account: creSigner,
    })
    await publicClient.waitForTransactionReceipt({ hash: h3 })

    // 4. Schedule payout
    const h4 = await creSignerWallet.writeContract({
      address: escrowAddr, abi: claimEscrowAbi, functionName: "schedulePayout",
      args: [claimId, recipientAddr, payoutAmount], chain: foundry, account: creSigner,
    })
    await publicClient.waitForTransactionReceipt({ hash: h4 })

    // 5. Release payout
    const balBefore = await publicClient.readContract({
      address: mockUsdcAddr, abi: mockUsdcAbi, functionName: "balanceOf", args: [recipientAddr],
    })

    const h5 = await creSignerWallet.writeContract({
      address: escrowAddr, abi: claimEscrowAbi, functionName: "releasePayout",
      args: [claimId], chain: foundry, account: creSigner,
    })
    await publicClient.waitForTransactionReceipt({ hash: h5 })

    const balAfter = await publicClient.readContract({
      address: mockUsdcAddr, abi: mockUsdcAbi, functionName: "balanceOf", args: [recipientAddr],
    })
    expect(balAfter - balBefore).toBe(payoutAmount)

    // 6. Mark paid
    const h6 = await creSignerWallet.writeContract({
      address: claimDecisionAddr, abi: claimDecisionRegistryAbi, functionName: "markPaid",
      args: [claimId], chain: foundry, account: creSigner,
    })
    await publicClient.waitForTransactionReceipt({ hash: h6 })

    // Verify final state is PAID (enum value 6)
    const decision = await publicClient.readContract({
      address: claimDecisionAddr, abi: claimDecisionRegistryAbi, functionName: "getDecision", args: [claimId],
    }) as any
    expect(decision.state).toBe(6) // PAID
  })
})

// Helper to get bytecode from Foundry output
async function getContractBytecode(name: string): Promise<Hex> {
  const fs = await import("node:fs/promises")
  const artifact = JSON.parse(
    await fs.readFile(`${process.cwd()}/contracts/out/${name}.sol/${name}.json`, "utf8")
  )
  return artifact.bytecode.object as Hex
}
