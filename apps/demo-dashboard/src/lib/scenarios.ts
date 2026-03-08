export type CRECapability = "HTTP" | "EVM_READ" | "EVM_WRITE" | "ENCRYPTED" | "DECODE";
export type TriggerType = "cron" | "log" | "http";

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
  /** "http" = fetch request, "cast" = on-chain via /api/chain */
  type: "http" | "cast";
  request?: { url: string; method: string; body?: unknown };
  cast?: { action: string; claimId: string; policyHash: string };
}

export interface CREScenario {
  id: string;
  title: string;
  subtitle: string;
  description: string;
  triggerType: TriggerType;
  triggerLabel: string;
  triggerDescription: string;
  userStories: string[];
  workflow: string;
  workflowName: string;
  claimId?: `0x${string}`;
  consentId?: `0x${string}`;
  /** For HTTP trigger: JSON payload to send */
  httpPayload?: string;
  setupSteps?: SetupStep[];
  expectedSteps: ExpectedStep[];
  expectedOutcome: {
    claimState?: string;
    payoutStatus?: string;
    consentStatus?: string;
  };
  /** Dollar amount for display */
  amount?: string;
  /** Raw settlement amount in USDC base units (6 decimals) for on-chain writes */
  settlementAmount?: string;
  color: string;
}

const POLICY_HASH = ("0x" + "a1".repeat(32));
const CONSENT_ID = ("0x" + "c0".repeat(32));

export const scenarios: Record<string, CREScenario> = {
  a: {
    id: "a",
    title: "Cron Trigger",
    subtitle: "Time-Driven Batch Prior Auth",
    description:
      "CronCapability fires every 30 seconds. WF-001 polls for outstanding claims, fetches EHR data, evaluates against policy predicates, and settles the full approval-to-payout pipeline on-chain.",
    triggerType: "cron",
    triggerLabel: "CronCapability",
    triggerDescription: "DON fires on a schedule (every 30s in staging). Ideal for batch processing where polling is acceptable.",
    userStories: [
      "As a provider, I want outstanding claims processed automatically on a schedule without manual intervention.",
      "As a payer, I want every batch-processed claim evaluated against the same on-chain policy predicates.",
    ],
    workflow: "wf-001-prior-auth-decision",
    workflowName: "WF-001 Prior Auth Decision",
    claimId: ("0x" + "01".repeat(32)) as `0x${string}`,
    consentId: CONSENT_ID as `0x${string}`,
    amount: "$850.00",
    settlementAmount: "850000000", // $850 in USDC (6 decimals)
    color: "var(--success)",
    expectedSteps: [
      {
        step: 0,
        title: "Fetch EHR Claims",
        capability: "ENCRYPTED",
        description: "GET outstanding BILLED claims from EHR via ConfidentialHTTPClient (AES-GCM encrypted).",
      },
      {
        step: 1,
        title: "Policy Fetch",
        capability: "HTTP",
        description: "GET policy predicates from policy-service with DON consensus.",
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
        description: "Submit claim on-chain via DON-signed report.",
      },
      {
        step: 6,
        title: "setProofResult",
        capability: "EVM_WRITE",
        contract: "ClaimDecisionRegistry",
        functionName: "setProofResult",
        onchainEffect: "SUBMITTED -> APPROVED",
        description: "Record proof result — advance state to APPROVED.",
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
        title: "releasePayout + markPaid",
        capability: "EVM_WRITE",
        contract: "ClaimEscrow + ClaimDecisionRegistry",
        functionName: "releasePayout + markPaid",
        onchainEffect: "APPROVED -> PAID",
        description: "Release escrowed USDC to treasury and mark claim as PAID (terminal).",
      },
      {
        step: 9,
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
    title: "Log Trigger",
    subtitle: "Event-Driven Transfer Settlement",
    description:
      "EVMClient.logTrigger() fires when ClaimSubmitted is emitted on-chain. WF-007 reacts immediately — no polling, no cron delay. The claim is already SUBMITTED (that's what fired the trigger), so the workflow skips submitClaim and goes straight to settlement.",
    triggerType: "log",
    triggerLabel: "EVMClient.logTrigger()",
    triggerDescription: "DON monitors on-chain events. When ClaimSubmitted(claimId, policyHash) is emitted, the workflow fires with the log data as input.",
    userStories: [
      "As a transfer coordinator, I want inter-department claims settled automatically when submitted on-chain.",
      "As a CRE developer, I want to demonstrate reactive workflows that fire on on-chain events.",
    ],
    workflow: "wf-007-claim-transfer-settlement",
    workflowName: "WF-007 Claim Transfer Settlement",
    claimId: ("0x" + "07".repeat(32)) as `0x${string}`,
    consentId: CONSENT_ID as `0x${string}`,
    amount: "$32,300.00",
    settlementAmount: "32300000000", // $32,300 in USDC (6 decimals)
    color: "var(--info)",
    setupSteps: [
      {
        id: "b-setup-1",
        title: "Submit Claim On-Chain",
        description:
          "Call ClaimDecisionRegistry.submitClaim() to emit the ClaimSubmitted event that triggers WF-007.",
        type: "cast",
        cast: {
          action: "submitClaim",
          claimId: "0x" + "07".repeat(32),
          policyHash: POLICY_HASH,
        },
      },
    ],
    expectedSteps: [
      {
        step: 0,
        title: "Decode Log Event",
        capability: "DECODE",
        description: "Extract claimId from topic[1] and policyHash from log data.",
      },
      {
        step: 1,
        title: "Fetch Transfer Data",
        capability: "ENCRYPTED",
        description: "GET pending transfer claims from EHR (AES-GCM encrypted).",
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
        title: "Policy Fetch",
        capability: "HTTP",
        description: "GET policy predicates with DON consensus.",
      },
      {
        step: 5,
        title: "Proof Evaluation",
        capability: "ENCRYPTED",
        description: "Evaluate transfer claim against policy predicates (AES-GCM encrypted).",
      },
      {
        step: 6,
        title: "setProofResult",
        capability: "EVM_WRITE",
        contract: "ClaimDecisionRegistry",
        functionName: "setProofResult",
        onchainEffect: "SUBMITTED -> APPROVED",
        description: "Record proof result. No submitClaim needed — claim already SUBMITTED from trigger event.",
      },
      {
        step: 7,
        title: "schedulePayout + releasePayout",
        capability: "EVM_WRITE",
        contract: "ClaimEscrow",
        functionName: "schedulePayout + releasePayout",
        onchainEffect: "Payout SCHEDULED -> RELEASED",
        description: "Schedule and release $32,300 payer coverage.",
      },
      {
        step: 8,
        title: "markPaid + Callback",
        capability: "EVM_WRITE",
        contract: "ClaimDecisionRegistry",
        functionName: "markPaid",
        onchainEffect: "APPROVED -> PAID",
        description: "Mark claim as PAID and notify via encrypted callback.",
      },
    ],
    expectedOutcome: {
      claimState: "PAID",
      payoutStatus: "RELEASED",
    },
  },

  c: {
    id: "c",
    title: "HTTP Trigger",
    subtitle: "On-Demand Prior Auth",
    description:
      "HTTPCapability fires immediately when a signed HTTP request arrives at the CRE gateway. WF-008 processes the full prior auth with zero delay — all claim data comes from the HTTP payload, saving one ConfidentialHTTP call vs WF-001.",
    triggerType: "http",
    triggerLabel: "HTTPCapability",
    triggerDescription: "Provider signs a request and sends it directly to the CRE gateway. The workflow fires immediately with the full payload as input — no polling, no delay.",
    userStories: [
      "As a provider, I want my prior auth processed immediately when I submit it, not on the next cron tick.",
      "As a CRE developer, I want to show that the same settlement pipeline works with request-driven triggers.",
    ],
    workflow: "wf-008-http-prior-auth",
    workflowName: "WF-008 HTTP Prior Auth",
    claimId: ("0x" + "08".repeat(32)) as `0x${string}`,
    consentId: CONSENT_ID as `0x${string}`,
    amount: "$38,000.00",
    settlementAmount: "38000000000", // $38,000 in USDC (6 decimals)
    color: "var(--accent)",
    httpPayload: JSON.stringify({
      claim_id: "0x" + "08".repeat(32),
      payer_id: "payer-demo-001",
      procedure_code: "PROC_CARDIAC_CT",
      requested_amount: "38000",
      consent_id: "0x" + "c0".repeat(32),
      policy_hash: "0x" + "a1".repeat(32),
      service_date: "2026-03-08",
    }),
    expectedSteps: [
      {
        step: 0,
        title: "Decode HTTP Payload",
        capability: "DECODE",
        description: "Parse payload.input bytes to JSON — extract claim_id, procedure_code, requested_amount.",
      },
      {
        step: 1,
        title: "Consent Check",
        capability: "EVM_READ",
        contract: "ConsentRegistry",
        functionName: "isConsentActive",
        description: "Verify patient consent is active on-chain.",
      },
      {
        step: 2,
        title: "Policy Check",
        capability: "EVM_READ",
        contract: "PolicyRegistry",
        functionName: "isPolicyActive",
        description: "Verify policy version is active on-chain.",
      },
      {
        step: 3,
        title: "Policy Fetch",
        capability: "HTTP",
        description: "GET policy predicates with DON consensus.",
      },
      {
        step: 4,
        title: "Proof Evaluation",
        capability: "ENCRYPTED",
        description: "Evaluate against policy predicates (AES-GCM encrypted).",
      },
      {
        step: 5,
        title: "submitClaim",
        capability: "EVM_WRITE",
        contract: "ClaimDecisionRegistry",
        functionName: "submitClaim",
        onchainEffect: "NONE -> SUBMITTED",
        description: "Submit claim on-chain via DON-signed report.",
      },
      {
        step: 6,
        title: "setProofResult",
        capability: "EVM_WRITE",
        contract: "ClaimDecisionRegistry",
        functionName: "setProofResult",
        onchainEffect: "SUBMITTED -> APPROVED",
        description: "Record proof result — advance state to APPROVED.",
      },
      {
        step: 7,
        title: "schedulePayout + releasePayout",
        capability: "EVM_WRITE",
        contract: "ClaimEscrow",
        functionName: "schedulePayout + releasePayout",
        onchainEffect: "Payout SCHEDULED -> RELEASED",
        description: "Schedule and release $38,000 payer coverage.",
      },
      {
        step: 8,
        title: "markPaid + Callback",
        capability: "EVM_WRITE",
        contract: "ClaimDecisionRegistry",
        functionName: "markPaid",
        onchainEffect: "APPROVED -> PAID",
        description: "Mark claim as PAID and notify via encrypted callback.",
      },
    ],
    expectedOutcome: {
      claimState: "PAID",
      payoutStatus: "RELEASED",
    },
  },
};
