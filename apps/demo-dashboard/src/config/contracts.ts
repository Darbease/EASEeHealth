// Deterministic Anvil deployment addresses (from forge script Deploy.s.sol)
export const CONTRACTS = {
  MockUSDC: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
  ConsentRegistry: "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512",
  PolicyRegistry: "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0",
  ClaimDecisionRegistry: "0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9",
  ClaimEscrow: "0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9",
} as const;

// Minimal ABI fragments for view functions
export const claimDecisionRegistryAbi = [
  {
    type: "function",
    name: "getDecision",
    inputs: [{ name: "claimId", type: "bytes32" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "claimId", type: "bytes32" },
          { name: "state", type: "uint8" },
          { name: "policyHash", type: "bytes32" },
          { name: "proofHash", type: "bytes32" },
          { name: "reasonBitmap", type: "uint256" },
          { name: "updatedAt", type: "uint64" },
        ],
      },
    ],
    stateMutability: "view",
  },
] as const;

export const claimEscrowAbi = [
  {
    type: "function",
    name: "getPayout",
    inputs: [{ name: "claimId", type: "bytes32" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "recipient", type: "address" },
          { name: "amount", type: "uint256" },
          { name: "status", type: "uint8" },
        ],
      },
    ],
    stateMutability: "view",
  },
] as const;

export const consentRegistryAbi = [
  {
    type: "function",
    name: "isConsentActive",
    inputs: [
      { name: "consentId", type: "bytes32" },
      { name: "atTs", type: "uint64" },
    ],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getConsent",
    inputs: [{ name: "consentId", type: "bytes32" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "consentId", type: "bytes32" },
          { name: "subjectIdHash", type: "bytes32" },
          { name: "consentScopeHash", type: "bytes32" },
          { name: "issuedAt", type: "uint64" },
          { name: "expiresAt", type: "uint64" },
          { name: "status", type: "uint8" },
          { name: "version", type: "uint32" },
        ],
      },
    ],
    stateMutability: "view",
  },
] as const;

export const policyRegistryAbi = [
  {
    type: "function",
    name: "isPolicyActive",
    inputs: [
      { name: "policyHash", type: "bytes32" },
      { name: "atTs", type: "uint64" },
    ],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
  },
] as const;

export const mockUsdcAbi = [
  {
    type: "function",
    name: "balanceOf",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
] as const;

// Claim state enum (matches ClaimDecisionRegistry.State)
export const CLAIM_STATES = [
  "NONE",
  "SUBMITTED",
  "PROOF_PENDING",
  "APPROVED",
  "DENIED",
  "CHALLENGED",
  "PAID",
] as const;

// Payout status enum (matches ClaimEscrow.PayoutStatus)
export const PAYOUT_STATUSES = [
  "NONE",
  "SCHEDULED",
  "RELEASED",
  "CANCELED",
] as const;

// Denial reason bitmap
export const DENIAL_BITS = [
  { bit: 0, mask: 1, label: "Provider credential invalid" },
  { bit: 1, mask: 2, label: "Procedure not covered" },
  { bit: 2, mask: 4, label: "Amount exceeds cap" },
  { bit: 3, mask: 8, label: "Consent invalid/revoked" },
  { bit: 4, mask: 16, label: "Duplicate/nullifier collision" },
  { bit: 5, mask: 32, label: "Stale attestation" },
] as const;
