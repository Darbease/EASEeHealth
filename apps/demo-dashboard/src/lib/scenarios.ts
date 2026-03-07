export type CRECapability = "HTTP" | "EVM_READ" | "EVM_WRITE" | "ENCRYPTED";

export interface ExpectedStep {
  step: number;
  title: string;
  capability: CRECapability;
  contract?: string;
  functionName?: string;
  onchainEffect?: string;
  description: string;
}

export interface SetupStep {
  id: string;
  title: string;
  description: string;
  request: { url: string; method: string; body?: unknown };
}

export interface CREScenario {
  id: string;
  title: string;
  description: string;
  userStories: string[];
  workflow: string;
  workflowName: string;
  claimId?: `0x${string}`;
  consentId?: `0x${string}`;
  setupSteps?: SetupStep[];
  expectedSteps: ExpectedStep[];
  expectedOutcome: {
    claimState?: string;
    payoutStatus?: string;
    consentStatus?: string;
  };
}

function svcUrl(port: number, path: string) {
  return `/api/services/${port}${path}`;
}

export const scenarios: Record<string, CREScenario> = {
  a: {
    id: "a",
    title: "Scenario A — Happy Path",
    description:
      "Valid attestation + proof -> APPROVED -> PAID. Full prior auth flow from submission through on-chain settlement.",
    userStories: [
      "As a provider, I want to submit a prior auth request and receive a decision within minutes.",
      "As a payer, every decision is evaluated against published policy predicates on a decentralized network.",
      "As a patient, my medical data never appears on a public blockchain or in oracle logs.",
    ],
    workflow: "wf-001-prior-auth-decision",
    workflowName: "WF-001 Prior Auth Decision",
    claimId: ("0x" + "01".repeat(32)) as `0x${string}`,
    expectedSteps: [
      {
        step: 1,
        title: "Policy Fetch",
        capability: "HTTP",
        description: "GET policy predicates from policy-service.",
      },
      {
        step: 2,
        title: "Consent Check",
        capability: "EVM_READ",
        contract: "ConsentRegistry",
        functionName: "isConsentActive",
        description: "Verify patient consent is active on-chain.",
      },
      {
        step: 3,
        title: "Policy Check",
        capability: "EVM_READ",
        contract: "PolicyRegistry",
        functionName: "isPolicyActive",
        description: "Verify policy version is active on-chain.",
      },
      {
        step: 4,
        title: "Proof Evaluation",
        capability: "ENCRYPTED",
        description: "Evaluate medical necessity against 6 predicates (AES-GCM encrypted).",
      },
      {
        step: 5,
        title: "submitClaim",
        capability: "EVM_WRITE",
        contract: "ClaimDecisionRegistry",
        functionName: "submitClaim",
        onchainEffect: "NONE -> SUBMITTED",
        description: "Submit claim decision on-chain.",
      },
      {
        step: 6,
        title: "setProofResult",
        capability: "EVM_WRITE",
        contract: "ClaimDecisionRegistry",
        functionName: "setProofResult",
        onchainEffect: "SUBMITTED -> APPROVED",
        description: "Record proof result and advance state to APPROVED.",
      },
      {
        step: 7,
        title: "schedulePayout",
        capability: "EVM_WRITE",
        contract: "ClaimEscrow",
        functionName: "schedulePayout",
        onchainEffect: "Payout NONE -> SCHEDULED",
        description: "Schedule USDC payout in escrow.",
      },
      {
        step: 8,
        title: "releasePayout",
        capability: "EVM_WRITE",
        contract: "ClaimEscrow",
        functionName: "releasePayout",
        onchainEffect: "Payout SCHEDULED -> RELEASED",
        description: "Release escrowed USDC to provider.",
      },
      {
        step: 9,
        title: "markPaid",
        capability: "EVM_WRITE",
        contract: "ClaimDecisionRegistry",
        functionName: "markPaid",
        onchainEffect: "APPROVED -> PAID",
        description: "Mark claim as PAID (terminal state).",
      },
      {
        step: 10,
        title: "Provider Callback",
        capability: "ENCRYPTED",
        description: "Notify provider of decision via encrypted callback.",
      },
    ],
    expectedOutcome: {
      claimState: "PAID",
      payoutStatus: "RELEASED",
    },
  },

  b: {
    id: "b",
    title: "Scenario B — Revoked Consent",
    description:
      "Patient revokes consent -> WF-002 syncs revocation on-chain -> consent status REVOKED.",
    userStories: [
      "As a patient, my medical data never appears on a public blockchain or in oracle logs.",
      "As a payer, consent revocation immediately blocks any pending claims.",
    ],
    workflow: "wf-002-consent-revocation",
    workflowName: "WF-002 Consent Revocation",
    consentId: ("0x" + "c0".repeat(32)) as `0x${string}`,
    setupSteps: [
      {
        id: "b-setup-1",
        title: "Revoke Consent via Service",
        description:
          "Patient revokes HIPAA data sharing authorization through the consent service.",
        request: {
          url: svcUrl(3004, "/v1/consents/revoke"),
          method: "POST",
          body: {
            consent_id: ("0x" + "c0".repeat(32)),
            reason_code: 1,
          },
        },
      },
    ],
    expectedSteps: [
      {
        step: 1,
        title: "Poll Revocations",
        capability: "ENCRYPTED",
        description: "Fetch pending revocations from consent-service (AES-GCM encrypted).",
      },
      {
        step: 2,
        title: "Check Consent On-Chain",
        capability: "EVM_READ",
        contract: "ConsentRegistry",
        functionName: "getConsent",
        description: "Read current consent status from on-chain registry.",
      },
      {
        step: 3,
        title: "revokeConsent",
        capability: "EVM_WRITE",
        contract: "ConsentRegistry",
        functionName: "revokeConsent",
        onchainEffect: "ACTIVE -> REVOKED",
        description: "Revoke consent on-chain if still active.",
      },
      {
        step: 4,
        title: "Notify Callback",
        capability: "ENCRYPTED",
        description: "Notify downstream services of revocation (AES-GCM encrypted).",
      },
    ],
    expectedOutcome: {
      consentStatus: "REVOKED",
    },
  },

  c: {
    id: "c",
    title: "Scenario C — Challenge",
    description:
      "Approved claim challenged by ops -> payout blocked -> resolved after clinical review.",
    userStories: [
      "As an ops reviewer, I want to challenge an approved claim and have the payout automatically blocked.",
      "As a payer, every decision is evaluated against published policy predicates on a decentralized network.",
    ],
    workflow: "wf-003-challenge-resolution",
    workflowName: "WF-003 Challenge Resolution",
    claimId: ("0x" + "e5".repeat(32)) as `0x${string}`,
    expectedSteps: [
      {
        step: 1,
        title: "Poll Challenges",
        capability: "ENCRYPTED",
        description: "Fetch pending challenges from callback-service (AES-GCM encrypted).",
      },
      {
        step: 2,
        title: "Read Claim State",
        capability: "EVM_READ",
        contract: "ClaimDecisionRegistry",
        functionName: "getDecision",
        description: "Verify current claim state is APPROVED.",
      },
      {
        step: 3,
        title: "challengeClaim",
        capability: "EVM_WRITE",
        contract: "ClaimDecisionRegistry",
        functionName: "challengeClaim",
        onchainEffect: "APPROVED -> CHALLENGED",
        description: "Challenge the claim — payout automatically blocked.",
      },
      {
        step: 4,
        title: "resolveChallenge",
        capability: "EVM_WRITE",
        contract: "ClaimDecisionRegistry",
        functionName: "resolveChallenge",
        onchainEffect: "CHALLENGED -> APPROVED",
        description: "Resolve challenge favorably after clinical review.",
      },
      {
        step: 5,
        title: "cancelPayout",
        capability: "EVM_WRITE",
        contract: "ClaimEscrow",
        functionName: "cancelPayout",
        onchainEffect: "SCHEDULED -> CANCELLED",
        description: "Cancel scheduled payout (if denied — skipped in demo).",
      },
      {
        step: 6,
        title: "Resolution Callback",
        capability: "ENCRYPTED",
        description: "Notify parties of challenge resolution (AES-GCM encrypted).",
      },
    ],
    expectedOutcome: {
      claimState: "APPROVED",
    },
  },
};
