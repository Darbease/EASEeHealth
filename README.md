# ProofPA

Privacy-preserving prior authorization and claim payout using Chainlink CRE, signed attestations, and onchain settlement - Currently Anvil Local Chain 
TODO - connect fork eth-sepolia for contract deploy  

---

## System Architecture Overview

ProofPA connects **provider portals** to **six backend services** to **five Chainlink CRE workflows** to **five Solidity contracts** on-chain. The CRE workflows are the orchestration brain — they read and write to both off-chain services (via HTTP) and on-chain contracts (via EVMClient), all executing inside a decentralized oracle network (DON). All ConfidentialHTTPClient calls use **AES-GCM output encryption** (`encryptOutput: true`) to ensure response payloads are encrypted end-to-end through the DON.

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                              PROOFPA SYSTEM WIREMAP                                 │
│                                                                                     │
│  ┌──────────────┐                                                                   │
│  │   Provider   │                                                                   │
│  │   Portal     │                                                                   │
│  └──────┬───────┘                                                                   │
│         │ POST /v1/prior-auth/submit                                                │
│         ▼                                                                           │
│  ┌──────────────────┐     ┌──────────────────────────────────────────────────────┐  │
│  │  Provider Adapter│     │               CHAINLINK CRE DON                      │  │
│  │  API  :3005      │     │  ┌─────────────────────────────────────────────────┐ │  │
│  └──────────────────┘     │  │  WF-001  Prior Auth Decision                   │ │   │
│                           │  │                                                 │ │  │
│  ┌──────────────────┐     │  │  1. ──[HTTP GET]──────► Policy Service :3001    │ │   │
│  │  Policy Service   │◄───┼──│  2. ──[EVM READ]─────► ConsentRegistry         │ │   │
│  │  :3001            │     │  │  3. ──[EVM READ]─────► PolicyRegistry          │ │   │
│  └──────────────────┘     │  │  4. ──[CONF HTTP]────► Proof Service :3003     │ │   │
│                            │  │  5. ──[EVM WRITE]────► submitClaim             │ │   │
│  ┌──────────────────┐     │  │  6. ──[EVM WRITE]────► setProofResult          │ │   │
│  │  Proof Service    │◄───┼──│  7. ──[EVM WRITE]────► schedulePayout          │ │   │
│  │  Stub :3003       │     │  │  8. ──[EVM WRITE]────► releasePayout           │ │   │
│  └──────────────────┘     │  │  9. ──[EVM WRITE]────► markPaid                │ │   │
│                            │  │ 10. ──[CONF HTTP]────► Callback Service :3006  │ │   │
│                            │  └─────────────────────────────────────────────────┘ │   │
│                            │                                                      │   │
│  ┌──────────────────┐     │  ┌─────────────────────────────────────────────────┐ │   │
│  │  Consent Service  │◄───┼──│  WF-002  Consent Revocation                    │ │   │
│  │  :3004            │     │  │                                                 │ │   │
│  └──────────────────┘     │  │  1. ──[CONF HTTP]────► Consent Service :3004   │ │   │
│                            │  │  2. ──[EVM READ]─────► ConsentRegistry         │ │   │
│  ┌──────────────────┐     │  │  3. ──[EVM WRITE]────► revokeConsent (if active)│ │   │
│  │  Credential Svc   │     │  │  4. ──[CONF HTTP]────► Callback Service :3006  │ │   │
│  │  :3002            │     │  └─────────────────────────────────────────────────┘ │   │
│  └──────────────────┘     │                                                      │   │
│                            │  ┌─────────────────────────────────────────────────┐ │   │
│                            │  │  WF-003  Challenge Resolution                  │ │   │
│  ┌──────────────────┐     │  │                                                 │ │   │
│  │  Decision Callback│◄───┼──│  1. ──[CONF HTTP]────► Callback Service :3006  │ │   │
│  │  Service :3006    │     │  │  2. ──[EVM READ]─────► ClaimDecisionRegistry   │ │   │
│  └──────────────────┘     │  │  3. ──[EVM WRITE]────► challengeClaim          │ │   │
│                            │  │  4. ──[EVM WRITE]────► resolveChallenge        │ │   │
│                            │  │  5. ──[EVM WRITE]────► cancelPayout (if denied)│ │   │
│                            │  │  6. ──[CONF HTTP]────► Callback Service :3006  │ │   │
│                            │  └─────────────────────────────────────────────────┘ │   │
│                            │                                                      │   │
│                            │  ┌─────────────────────────────────────────────────┐ │   │
│                            │  │  WF-004  Reconciliation Monitor                │ │   │
│                            │  │                                                 │ │   │
│                            │  │  1. ──[EVM READ]─────► ClaimDecisionRegistry   │ │   │
│                            │  │  2. ──[EVM READ]─────► ClaimEscrow             │ │   │
│                            │  └─────────────────────────────────────────────────┘ │   │
│                            │                                                      │   │
│                            │  ┌─────────────────────────────────────────────────┐ │   │
│                            │  │  WF-005  Encrypted Credential Audit  [AES-GCM] │ │   │
│                            │  │                                                 │ │   │
│                            │  │  1. ──[ENC HTTP]─────► Credential Svc :3002    │ │   │
│                            │  │  2. ──[EVM READ]─────► ConsentRegistry         │ │   │
│                            │  │  3. ──[ENC HTTP]─────► Policy Service :3001    │ │   │
│                            │  │  4. ──[ENC HTTP]─────► Proof Service :3003     │ │   │
│                            │  │  5. ──[ENC HTTP]─────► Callback Service :3006  │ │   │
│                            │  └─────────────────────────────────────────────────┘ │   │
│                            └──────────────────────────────────────────────────────┘   │
│                                           │                                          │
│                                           │ EVM READ / WRITE                         │
│                                           ▼                                          │
│  ┌───────────────────────────────────────────────────────────────────────────────┐   │
│  │                        BASE SEPOLIA  (or local Anvil)                         │   │
│  │                                                                               │   │
│  │   ┌────────────┐  ┌────────────┐  ┌─────────────────┐  ┌──────────────┐     │   │
│  │   │  MockUSDC   │  │  Consent   │  │  ClaimDecision  │  │  ClaimEscrow │     │   │
│  │   │  (ERC-20)   │  │  Registry  │  │  Registry       │  │              │     │   │
│  │   └────────────┘  └────────────┘  └─────────────────┘  └──────────────┘     │   │
│  │                    ┌────────────┐                                             │   │
│  │                    │  Policy    │                                             │   │
│  │                    │  Registry  │                                             │   │
│  │                    └────────────┘                                             │   │
│  └───────────────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

### What Makes This Special

The CRE workflows use **all three Chainlink CRE capability types** in a single project:

| Capability | SDK Class | What It Does | Used By |
|---|---|---|---|
| **Regular HTTP** | `HTTPClient` | Public API calls with DON consensus (all nodes must agree on the response) | WF-001 |
| **Confidential HTTP** | `ConfidentialHTTPClient` | API calls with encrypted secrets injected inside the TEE enclave (API keys, tokens). All calls use `encryptOutput: true` for AES-GCM encrypted responses. | WF-001, WF-002, WF-003, WF-005 |
| **EVM Read/Write** | `EVMClient` | On-chain contract reads via `callContract()` and DON-signed transaction writes via `writeReport()` | WF-001, WF-002, WF-003, WF-004, WF-005 |

---

## WF-001: Prior Auth Decision (The Happy Path)

**User Stories:**

> **As a healthcare provider**, I want to submit a prior authorization request and receive an approval or denial decision within minutes, so that I can inform my patient and schedule their procedure without waiting days for a fax-back from the payer.

> **As a payer (insurance company)**, I want every prior auth decision to be evaluated against my published policy predicates (covered procedures, amount caps, attestation freshness) on a decentralized network, so that no single party can unilaterally approve a claim outside policy bounds.

> **As a patient**, I want my medical data to never appear on a public blockchain or in oracle network logs, so that my privacy is protected even though the decision is settled on-chain.

This is the flagship workflow. It orchestrates the **entire prior authorization lifecycle** in a single CRE execution — from policy lookup to proof evaluation to on-chain claim settlement to payout release and terminal PAID status.

```
WF-001: Prior Auth Decision — Step-by-Step Data Flow
═══════════════════════════════════════════════════════

TRIGGER: CronCapability fires every 30 seconds
         (in production: triggered by provider-adapter-api submission)

 Step 1 ── [HTTPClient with DON Consensus] ─────────────────────────────────
 │
 │  GET http://localhost:3001/v1/policies/payer-demo-001/v1
 │
 │  All DON nodes independently call the policy service.
 │  Responses must be IDENTICAL across all nodes (consensus).
 │
 │  ◄── Returns: {
 │        payer_id: "payer-demo-001",
 │        policy_version: "v1",
 │        policy_hash: "0xa1a1...a1",
 │        active: true,
 │        predicates: {
 │          covered_procedures: ["PROC_KNEE_MRI", "PROC_CARDIAC_CT", "PROC_SPINE_XRAY"],
 │          amount_caps: { PROC_KNEE_MRI: 100000, ... },
 │          attestation_max_age_seconds: 86400
 │        }
 │      }
 │
 ▼
 Step 2 ── [EVMClient.callContract — READ] ──────────────────────────────────
 │
 │  Contract: ConsentRegistry (0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512)
 │  Function: isConsentActive(bytes32 consentId, uint64 atTs) → bool
 │  Args:     consentId = 0xc0c0...c0, atTs = current unix timestamp
 │
 │  Encodes calldata with viem's encodeFunctionData(), sends via
 │  encodeCallMsg() at LATEST_BLOCK_NUMBER. Reads are free (no gas).
 │
 │  ◄── Returns: true (consent is ACTIVE and not expired)
 │               false (consent doesn't exist, was REVOKED, or is EXPIRED)
 │
 ▼
 Step 3 ── [EVMClient.callContract — READ] ──────────────────────────────────
 │
 │  Contract: PolicyRegistry (0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0)
 │  Function: isPolicyActive(bytes32 policyHash, uint64 atTs) → bool
 │  Args:     policyHash = 0xa1a1...a1, atTs = current unix timestamp
 │
 │  Verifies the policy is active on-chain and within its effective date range.
 │
 │  ◄── Returns: true (policy is active, effectiveFrom <= now <= effectiveTo)
 │               false (policy inactive or outside date range)
 │
 ▼
 Step 4 ── [ConfidentialHTTPClient + AES-GCM Encryption] ───────────────────
 │
 │  POST http://localhost:3003/v1/proofs/medical-necessity
 │
 │  Headers include: Authorization: Bearer {{.proofServiceApiKey}}
 │  The {{.proofServiceApiKey}} template is replaced with the actual secret
 │  from the CRE vault INSIDE the TEE enclave — the secret never leaves.
 │  encryptOutput: true → response is AES-GCM encrypted through the DON.
 │
 │  Request body: {
 │    claim_id: "0x0101...01",
 │    policy_hash: "0xa1a1...a1",
 │    procedure_code: "PROC_KNEE_MRI",
 │    requested_amount: "85000",
 │    consent_active: true,
 │    credential_valid: true,
 │    is_duplicate: false,
 │    attestation_age_seconds: 3600,
 │    policy_predicates: <parsed from step 1 policy-service response>
 │  }
 │
 │  NOTE: policy_predicates are piped from the policy service response
 │  (step 1), not hardcoded — the workflow never "knows" the predicates.
 │
 │  The proof service evaluates 6 predicate checks:
 │    Bit 0: credential_valid?        ✓ (true)
 │    Bit 1: procedure covered?       ✓ (PROC_KNEE_MRI in list)
 │    Bit 2: amount within cap?       ✓ (85000 <= 100000)
 │    Bit 3: consent active?          ✓ (true)
 │    Bit 4: not duplicate?           ✓ (false)
 │    Bit 5: attestation fresh?       ✓ (3600 <= 86400)
 │
 │  ◄── Returns: {
 │        result: "PASS",
 │        reason_bitmap: "0",
 │        proof_hash: "0xf3f5...5fb",
 │        proof_id: "proof_f2c2a767..."
 │      }
 │
 ▼
 Step 5 ── [EVMClient.writeReport — WRITE] ──────────────────────────────────
 │
 │  Contract: ClaimDecisionRegistry (0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9)
 │  Function: submitClaim(bytes32 claimId, bytes32 policyHash)
 │  Args:     claimId = 0x0101...01, policyHash = 0xa1a1...a1
 │
 │  1. Encodes calldata with viem's encodeFunctionData()
 │  2. runtime.report(prepareReportRequest(calldata)) — DON signs the payload
 │  3. evmClient.writeReport() — submits signed report as a transaction
 │
 │  On-chain effect: Claim state transitions NONE → SUBMITTED
 │  Emits: ClaimSubmitted(claimId, policyHash)
 │  Requires: WORKFLOW_ROLE (granted to CRE signer address)
 │
 ▼
 Step 6 ── [EVMClient.writeReport — WRITE] ──────────────────────────────────
 │
 │  Contract: ClaimDecisionRegistry (0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9)
 │  Function: setProofResult(bytes32 claimId, bytes32 proofHash,
 │                           uint256 reasonBitmap, bool approved)
 │  Args:     claimId = 0x0101...01, proofHash = 0xb2b2...b2,
 │            reasonBitmap = 0, approved = true
 │
 │  On-chain effect: Claim state transitions SUBMITTED → APPROVED
 │  Emits: ProofEvaluated(claimId, proofHash, true, 0)
 │
 ▼
 Step 7 ── [EVMClient.writeReport — WRITE] (only if APPROVED) ──────────────
 │
 │  Contract: ClaimEscrow (0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9)
 │  Function: schedulePayout(bytes32 claimId, address recipient, uint256 amount)
 │  Args:     claimId = 0x0101...01,
 │            recipient = 0x90F7...3906 (treasury),
 │            amount = 85000 (USDC, 6 decimals)
 │
 │  On-chain effect: Payout status transitions NONE → SCHEDULED
 │  Emits: PayoutScheduled(claimId, recipient, amount)
 │  The ERC-20 transfer is staged but not yet executed.
 │
 ▼
 Step 8 ── [EVMClient.writeReport — WRITE] (only if APPROVED) ──────────────
 │
 │  Contract: ClaimEscrow (0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9)
 │  Function: releasePayout(bytes32 claimId)
 │  Args:     claimId = 0x0101...01
 │
 │  On-chain effect: Payout status transitions SCHEDULED → RELEASED
 │  Emits: PayoutReleased(claimId)
 │  Executes the actual ERC-20 transfer from escrow to treasury.
 │
 ▼
 Step 9 ── [EVMClient.writeReport — WRITE] (only if APPROVED) ──────────────
 │
 │  Contract: ClaimDecisionRegistry (0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9)
 │  Function: markPaid(bytes32 claimId)
 │  Args:     claimId = 0x0101...01
 │
 │  On-chain effect: Claim state transitions APPROVED → PAID (terminal)
 │  Emits: ClaimPaid(claimId)
 │  No further state transitions allowed after PAID.
 │
 ▼
 Step 10 ── [ConfidentialHTTPClient + AES-GCM Encryption] ──────────────────
 │
 │  POST http://localhost:3006/v1/callbacks/prior-auth-decision
 │  Body: {
 │    claim_id: "0x0101...01",
 │    decision_state: "APPROVED",
 │    reason_bitmap: "<proof service response>",
 │    workflow_id: "WF-001"
 │  }
 │
 │  ◄── Returns: { status: "received" }
 │
 ▼
 RESULT: JSON payload returned from the workflow
 {
   workflow: "WF-001-PriorAuthDecision",
   claim_id: "0x0101...01",
   decision_state: "APPROVED",
   consent_verified_onchain: true,
   policy_verified_onchain: true,
   proof_response: "{ ... }",
   timestamp: "2026-03-05T09:08:47.686Z"
 }
```

---

## WF-002: Consent Revocation

**User Stories:**

> **As a patient**, I want to withdraw my data-sharing consent at any time and have all pending prior auth claims immediately flagged for re-evaluation, so that my right to revoke authorization is enforced in real time — not days later.

> **As a compliance officer**, I want the system to cross-check off-chain revocation events against the on-chain ConsentRegistry, so that I can detect discrepancies between what the consent service reports and what the blockchain reflects.

> **As a provider**, I want to be notified automatically when a patient's consent revocation affects my pending claims, so that I can take action (resubmit with new consent or cancel the procedure) without manual follow-up.

When a patient revokes consent, this workflow polls for the revocation event, verifies on-chain state, writes the revocation on-chain if still ACTIVE, and flags affected claims.

```
WF-002: Consent Revocation — Data Flow
═══════════════════════════════════════

TRIGGER: CronCapability fires every 30 seconds

 Step 1 ── [ConfidentialHTTPClient + AES-GCM Encryption] ───────────────────
 │
 │  GET http://localhost:3004/v1/consents/revocations?since=900
 │
 │  Polls for any consents revoked in the last 15 minutes.
 │
 │  ◄── Returns: {
 │        revocations: [{
 │          consent_id: "0xd4d4...d4",
 │          revoked_at: "2026-03-05T09:04:04.716Z",
 │          reason_code: 1
 │        }],
 │        count: 1
 │      }
 │
 ▼
 Step 2 ── [EVMClient.callContract — READ] ──────────────────────────────────
 │
 │  Contract: ConsentRegistry (0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512)
 │  Function: isConsentActive(bytes32 consentId, uint64 atTs) → bool
 │
 │  Cross-checks: does the off-chain revocation match the on-chain state?
 │  If consent-service says "revoked" but chain says "active", that's a
 │  discrepancy that needs investigation.
 │
 │  ◄── Returns: true  (chain still shows ACTIVE — needs revocation write)
 │               false (confirms revocation is already reflected on-chain)
 │
 ▼
 Step 3 ── [EVMClient.writeReport — WRITE] (only if consent still ACTIVE) ──
 │
 │  Contract: ConsentRegistry (0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512)
 │  Function: revokeConsent(bytes32 consentId, uint16 reasonCode)
 │  Args:     consentId = 0xc0c0...c0, reasonCode = 1 (patient-initiated)
 │
 │  If the consent service reports a revocation but the chain still shows
 │  ACTIVE, the workflow writes the revocation on-chain to synchronize state.
 │  If already REVOKED on-chain, this step is skipped.
 │
 │  On-chain effect: Consent status transitions ACTIVE → REVOKED
 │  Emits: ConsentRevoked(consentId, reasonCode)
 │
 ▼
 Step 4 ── [ConfidentialHTTPClient + AES-GCM Encryption] ───────────────────
 │
 │  POST http://localhost:3006/v1/callbacks/consent-revoked
 │  Body: {
 │    workflow_id: "WF-002",
 │    revocations: "<raw consent service response>",
 │    onchain_consent_active: <true|false>,
 │    timestamp: "2026-03-05T09:09:04.738Z"
 │  }
 │
 │  The callback service logs the event and would flag any pending claims
 │  associated with the revoked consent for denial or cancellation.
 │
 │  ◄── Returns: { status: "received", flagged_claims: 0 }
 │
 ▼
 RESULT: { workflow: "WF-002-ConsentRevocation", status: "COMPLETED",
           onchain_consent_active: false, revoked_onchain: true }
```

---

## WF-003: Challenge Resolution

**User Stories:**

> **As an ops reviewer**, I want to challenge an approved claim that looks suspicious (e.g., amount exceeds the usual range for a procedure) and have the payout automatically blocked until I complete my review, so that fraudulent or erroneous payouts are caught before funds leave escrow.

> **As a provider**, I want to know when one of my approved claims is under challenge and receive a notification when the challenge is resolved, so that I'm not left wondering why a payout is delayed.

> **As an auditor**, I want the on-chain claim state to accurately reflect whether a claim is under active challenge, so that the blockchain serves as a tamper-proof audit trail of every dispute.

When an approved claim is challenged (e.g., by an ops reviewer who spots unusual amounts), this workflow writes the challenge on-chain, resolves it, cancels the payout if denied, and notifies the provider.

```
WF-003: Challenge Resolution — Data Flow
═════════════════════════════════════════

TRIGGER: CronCapability fires every 30 seconds

 Step 1 ── [ConfidentialHTTPClient + AES-GCM Encryption] ───────────────────
 │
 │  GET http://localhost:3006/v1/callbacks/pending-challenges
 │
 │  ◄── Returns: {
 │        challenges: [{
 │          claim_id: "0xe5e5...e5",
 │          challenged_at: "2026-03-05T08:59:10.156Z",
 │          challenger: "ops-reviewer-1",
 │          reason: "Amount exceeds usual range"
 │        }],
 │        count: 1
 │      }
 │
 ▼
 Step 2 ── [EVMClient.callContract — READ] ──────────────────────────────────
 │
 │  Contract: ClaimDecisionRegistry (0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9)
 │  Function: getDecision(bytes32 claimId) → ClaimDecision
 │
 │  Reads the full on-chain claim state to verify it's actually in
 │  CHALLENGED status before processing any resolution.
 │
 │  Returns a struct: { claimId, policyHash, state, proofHash,
 │                       reasonBitmap, updatedAt }
 │
 │  State values: 0=NONE, 1=SUBMITTED, 2=PROOF_PENDING,
 │                3=APPROVED, 4=DENIED, 5=CHALLENGED, 6=PAID
 │
 ▼
 Step 3 ── [EVMClient.writeReport — WRITE] (only if APPROVED + challenge exists)
 │
 │  Contract: ClaimDecisionRegistry (0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9)
 │  Function: challengeClaim(bytes32 claimId, string reason)
 │  Args:     claimId = 0xe5e5...e5, reason = "clinical-review"
 │
 │  On-chain effect: Claim state transitions APPROVED → CHALLENGED
 │  Emits: ClaimChallenged(claimId, reason)
 │  Payout is now BLOCKED — cannot be released while challenged.
 │
 ▼
 Step 4 ── [EVMClient.writeReport — WRITE] (only if CHALLENGED) ────────────
 │
 │  Contract: ClaimDecisionRegistry (0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9)
 │  Function: resolveChallenge(bytes32 claimId, bool approved)
 │  Args:     claimId = 0xe5e5...e5, approved = true|false
 │
 │  On-chain effect: CHALLENGED → APPROVED (payout unblocked)
 │                   CHALLENGED → DENIED   (payout cancelled)
 │  Emits: ChallengeResolved(claimId, approved)
 │
 ▼
 Step 5 ── [EVMClient.writeReport — WRITE] (only if denied after challenge) ─
 │
 │  Contract: ClaimEscrow (0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9)
 │  Function: cancelPayout(bytes32 claimId)
 │  Args:     claimId = 0xe5e5...e5
 │
 │  On-chain effect: Payout status transitions SCHEDULED → CANCELLED
 │  Emits: PayoutCancelled(claimId)
 │  Funds are returned to the escrow pool.
 │
 ▼
 Step 6 ── [ConfidentialHTTPClient + AES-GCM Encryption] ───────────────────
 │
 │  POST http://localhost:3006/v1/callbacks/challenge-resolved
 │  Body: {
 │    workflow_id: "WF-003",
 │    resolutions: "<raw challenge data>",
 │    onchain_claim_state: "APPROVED" | "DENIED",
 │    challenged_onchain: true,
 │    resolved_onchain: true,
 │    resolution_approved: true|false,
 │    timestamp: "2026-03-05T09:09:10.176Z"
 │  }
 │
 │  ◄── Returns: { status: "received", resolved_count: 1 }
 │
 ▼
 RESULT: { workflow: "WF-003-ChallengeResolution", status: "COMPLETED",
           onchain_claim_state: "APPROVED", challenged_onchain: true,
           resolved_onchain: true, resolution_approved: true }
```

---

## WF-004: Reconciliation Monitor

**User Stories:**

> **As a system operator**, I want to be alerted within 15 minutes if any claim is stuck in `PROOF_PENDING` state, so that I can investigate whether the proof service is down or a workflow execution failed before it impacts SLO targets.

> **As a finance team member**, I want the system to automatically detect when a claim is marked `PAID` on-chain but the escrow shows the payout was never released, so that settlement mismatches are caught before end-of-day reconciliation.

> **As a payer**, I want an independent on-chain monitor (with no HTTP dependencies) that verifies cross-contract consistency between `ClaimDecisionRegistry` and `ClaimEscrow`, so that I can trust the settlement layer operates correctly even if off-chain services are unreachable.

A health-check workflow that reads on-chain state to detect anomalies — stuck claims, payout mismatches, or stale state transitions. This is the only workflow with **zero HTTP calls** — it's pure EVM reads.

```
WF-004: Reconciliation Monitor — Data Flow
═══════════════════════════════════════════

TRIGGER: CronCapability fires every 30s (staging) / 15min (production)

 Step 1 ── [EVMClient.callContract — READ] ──────────────────────────────────
 │
 │  Contract: ClaimDecisionRegistry (0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9)
 │  Function: getDecision(bytes32 claimId) → ClaimDecision
 │
 │  Reads claim state and updatedAt timestamp.
 │
 │  Anomaly detection:
 │    - If state == PROOF_PENDING and (now - updatedAt) > sloTargetSeconds:
 │      ALERT: Claim stuck in PROOF_PENDING beyond SLO threshold.
 │      sloTargetSeconds is read from config (default: 900 = 15 min).
 │
 ▼
 Step 2 ── [EVMClient.callContract — READ] (conditional) ───────────────────
 │
 │  Only runs if claim state >= APPROVED (and not DENIED).
 │
 │  Contract: ClaimEscrow (0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9)
 │  Function: getPayout(bytes32 claimId) → PayoutInstruction
 │
 │  Returns: { recipient, amount, status }
 │  Payout status: 0=NONE, 1=SCHEDULED, 2=RELEASED, 3=CANCELLED
 │
 │  Cross-contract consistency checks:
 │    - Claim is PAID but payout is not RELEASED → MISMATCH
 │    - Claim is APPROVED but no payout scheduled → MISMATCH
 │
 ▼
 RESULT: {
   workflow: "WF-004-ReconciliationMonitor",
   claim_id: "0x0101...01",
   onchain_state: "NONE",
   stuck_claims: 0,
   mismatches: 0,
   timestamp: "2026-03-05T09:08:25.392Z"
 }
```

---

## WF-005: Encrypted Credential Audit (AES-GCM Showcase)

**User Stories:**

> **As a credentialing coordinator**, I want to verify that a provider's NPI is valid, their license is active, the patient's consent is on-chain, and the policy covers the procedure — all in a single automated audit — so that I don't have to manually check four different systems before approving a provider for network participation.

> **As a security architect**, I want every HTTP call in the audit pipeline to be AES-GCM encrypted end-to-end through the DON, so that credential details, policy data, and proof evaluations are never exposed in plaintext to individual oracle nodes.

> **As a compliance officer**, I want an audit trail that shows exactly which checks passed or failed (credential, consent, policy, proof) with encryption metadata, so that I can demonstrate to regulators that the verification pipeline meets HIPAA transport security requirements.

A dedicated workflow that showcases AES-GCM encryption as its headline feature. Makes **4 encrypted HTTP calls** chained with 1 on-chain consent verification to perform a full credential audit cycle.

```
WF-005: Encrypted Credential Audit — Data Flow
════════════════════════════════════════════════

TRIGGER: CronCapability fires every 30 seconds

 Step 1 ── [ConfidentialHTTPClient + AES-GCM Encryption] ───────────────────
 │
 │  POST http://localhost:3002/v1/credentials/verify
 │
 │  Verifies provider credentials (NPI) via encrypted enclave call.
 │  encryptOutput: true → response encrypted through DON.
 │
 │  ◄── Returns: credential verification result or error
 │
 ▼
 Step 2 ── [EVMClient.callContract — READ] ──────────────────────────────────
 │
 │  Contract: ConsentRegistry
 │  Function: isConsentActive(bytes32 consentId, uint64 atTs) → bool
 │
 │  Cross-references on-chain consent status against credential audit.
 │
 │  ◄── Returns: true/false
 │
 ▼
 Step 3 ── [ConfidentialHTTPClient + AES-GCM Encryption] ───────────────────
 │
 │  GET http://localhost:3001/v1/policies/payer-demo-001/v1
 │
 │  Fetches policy details for the audit. Encrypted response.
 │
 │  ◄── Returns: { payer_id, policy_version, policy_hash, predicates }
 │
 ▼
 Step 4 ── [ConfidentialHTTPClient + AES-GCM Encryption] ───────────────────
 │
 │  POST http://localhost:3003/v1/proofs/medical-necessity
 │
 │  Evaluates proof with credential status from step 1 and
 │  policy_predicates from step 3. encryptOutput: true.
 │
 │  ◄── Returns: { proof_hash, result, reason_bitmap }
 │
 ▼
 Step 5 ── [ConfidentialHTTPClient + AES-GCM Encryption] ───────────────────
 │
 │  POST http://localhost:3006/v1/callbacks/prior-auth-decision
 │
 │  Posts the full audit result as a decision callback.
 │  Encrypted response.
 │
 │  ◄── Returns: { status: "received" }
 │
 ▼
 RESULT: {
   workflow: "WF-005-EncryptedCredentialAudit",
   audit_result: "PASS|FAIL",
   encryption: {
     protocol: "AES-GCM",
     encrypted_calls: 4,
     total_calls: 4,
     all_responses_encrypted: true
   },
   steps: { ... }
 }
```

**Quota usage**: 4 HTTP calls (limit 5), 1 EVM read (limit 10) — within CRE bounds.

---

## Inter-Service Communication Matrix

Every arrow in the system — who calls whom, with what, and why:

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                     COMPLETE COMMUNICATION MATRIX                            │
│                                                                              │
│  FROM                  TO                    METHOD + PATH                   │
│  ════                  ══                    ═════════════                   │
│                                                                              │
│  Provider Portal  ──►  Provider Adapter      POST /v1/prior-auth/submit     │
│                        (:3005)               → claim_id, workflow_id         │
│                                                                              │
│  WF-001           ──►  Policy Service        GET /v1/policies/:payer/:ver   │
│                        (:3001)               → policy_hash, predicates      │
│                                                                              │
│  WF-001           ──►  Proof Service Stub    POST /v1/proofs/med-necessity  │
│                        (:3003)               → proof_hash, result, bitmap   │
│                                                                              │
│  WF-001           ──►  Callback Service      POST /v1/callbacks/prior-auth  │
│                        (:3006)               -decision → { status }         │
│                                                                              │
│  WF-001           ──►  ConsentRegistry       callContract: isConsentActive  │
│                        (on-chain)            → bool                         │
│                                                                              │
│  WF-001           ──►  PolicyRegistry        callContract: isPolicyActive   │
│                        (on-chain)            → bool                         │
│                                                                              │
│  WF-001           ──►  ClaimDecisionRegistry writeReport: submitClaim       │
│                        (on-chain)            → NONE → SUBMITTED             │
│                                                                              │
│  WF-001           ──►  ClaimDecisionRegistry writeReport: setProofResult    │
│                        (on-chain)            → SUBMITTED → APPROVED/DENIED  │
│                                                                              │
│  WF-001           ──►  ClaimEscrow           writeReport: schedulePayout    │
│                        (on-chain)            → NONE → SCHEDULED             │
│                                                                              │
│  WF-002           ──►  Consent Service       GET /v1/consents/revocations   │
│                        (:3004)               → [{ consent_id, revoked_at }] │
│                                                                              │
│  WF-002           ──►  ConsentRegistry       callContract: isConsentActive  │
│                        (on-chain)            → bool (verify revocation)     │
│                                                                              │
│  WF-002           ──►  Callback Service      POST /v1/callbacks/consent-    │
│                        (:3006)               revoked → flagged_claims       │
│                                                                              │
│  WF-003           ──►  Callback Service      GET /v1/callbacks/pending-     │
│                        (:3006)               challenges → [{ claim_id }]    │
│                                                                              │
│  WF-003           ──►  ClaimDecisionRegistry callContract: getDecision      │
│                        (on-chain)            → { state, proofHash, ... }    │
│                                                                              │
│  WF-003           ──►  Callback Service      POST /v1/callbacks/challenge-  │
│                        (:3006)               resolved → resolved_count      │
│                                                                              │
│  WF-004           ──►  ClaimDecisionRegistry callContract: getDecision      │
│                        (on-chain)            → { state, updatedAt }         │
│                                                                              │
│  WF-004           ──►  ClaimEscrow           callContract: getPayout        │
│                        (on-chain)            → { status, amount }           │
│                                                                              │
│  WF-005           ──►  Credential Service   POST /v1/credentials/verify    │
│                        (:3002)               → credential status [ENC]     │
│                                                                              │
│  WF-005           ──►  ConsentRegistry       callContract: isConsentActive  │
│                        (on-chain)            → bool                         │
│                                                                              │
│  WF-005           ──►  Policy Service        GET /v1/policies/:payer/:ver  │
│                        (:3001)               → policy details [ENC]        │
│                                                                              │
│  WF-005           ──►  Proof Service Stub    POST /v1/proofs/med-necessity │
│                        (:3003)               → proof result [ENC]          │
│                                                                              │
│  WF-005           ──►  Callback Service      POST /v1/callbacks/prior-auth │
│                        (:3006)               -decision → { status } [ENC]  │
│                                                                              │
│  Demo Runner      ──►  All services          GET /healthz → { status: ok } │
│  (tests/e2e)           (:3001-3006)                                         │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## Smart Contract State Machine

The `ClaimDecisionRegistry` enforces a strict state machine. Every transition requires a specific role and can only move forward:

```
                    ┌─────────────────────────────────────────────────────┐
                    │         CLAIM STATE MACHINE (on-chain)              │
                    │                                                     │
                    │   NONE ──────► SUBMITTED ──────► APPROVED ────┐    │
                    │                    │                  │        │    │
                    │               (setProofResult        │   (markPaid)│
                    │                approved=false)        │        │    │
                    │                    │            (challengeClaim)│   │
                    │                    ▼                  │        │    │
                    │                 DENIED            CHALLENGED   │    │
                    │                                   │       │   │    │
                    │                          (resolve  │       │   │    │
                    │                          approve)  │(resolve   │    │
                    │                              │     │deny) │   │    │
                    │                              ▼     │  ▼   │   │    │
                    │                          APPROVED ◄┘ DENIED   │    │
                    │                              │                │    │
                    │                              └────────────────┘    │
                    │                                     │              │
                    │                                     ▼              │
                    │                                   PAID             │
                    │                                (terminal)          │
                    │                                                     │
                    │   Roles:                                           │
                    │     submitClaim      → WORKFLOW_ROLE (CRE signer)  │
                    │     setProofResult   → WORKFLOW_ROLE               │
                    │     challengeClaim   → CHALLENGE_ROLE (ops)        │
                    │     resolveChallenge → CHALLENGE_ROLE              │
                    │     markPaid         → WORKFLOW_ROLE               │
                    └─────────────────────────────────────────────────────┘

                    ┌─────────────────────────────────────────────────────┐
                    │         PAYOUT STATUS (ClaimEscrow)                 │
                    │                                                     │
                    │   NONE ──► SCHEDULED ──► RELEASED                  │
                    │                │                                    │
                    │           (cancelPayout)                            │
                    │                ▼                                    │
                    │            CANCELLED                                │
                    │                                                     │
                    │   Roles:                                           │
                    │     schedulePayout → WORKFLOW_ROLE                  │
                    │     releasePayout  → WORKFLOW_ROLE                  │
                    │     cancelPayout   → CHALLENGE_ROLE                 │
                    │     fundPool       → TREASURY_ROLE                  │
                    └─────────────────────────────────────────────────────┘
```

---

## Denial Reason Bitmap

When the proof service evaluates a claim and it fails, it sets specific bits in a `uint256` bitmap. Each bit indicates a specific denial reason:

```
Bit   Meaning                         Example trigger
───   ───────                         ───────────────
 0    Provider credential invalid     credential_valid == false
 1    Procedure not covered           "PROC_BOTOX" not in covered_procedures
 2    Amount exceeds cap              requested_amount > amount_caps[procedure]
 3    Consent invalid/revoked         consent_active == false
 4    Duplicate/nullifier collision   is_duplicate == true
 5    Stale attestation               attestation_age > max_age (86400s)
```

A bitmap of `0` = all checks pass = `APPROVED`. A bitmap of `8` (bit 3 set) = consent invalid = `DENIED`.

---

## CRE Capability Usage Per Workflow

How many of each CRE capability type each workflow uses (and the CRE platform limits):

```
                    HTTP    Confidential    EVM       EVM
                   Client   HTTP [ENC]    READ     WRITE     Limit
                   ──────   ────────────  ──────   ──────    ─────
  WF-001             1          2           2        5       5 HTTP / 10 READ / 10 WRITE
  WF-002             0          2           1        0-1     revokeConsent if still ACTIVE
  WF-003             0          2           1        0-3     challenge → resolve → cancel
  WF-004             0          0           1-2      0
  WF-005             0          4           1        0       AES-GCM showcase
                   ──────   ────────────  ──────   ──────
  Total per WF       ≤5         ≤5          ≤10      ≤10     All within limits

  [ENC] = All ConfidentialHTTPClient calls use encryptOutput: true (AES-GCM)
```

---

## Prerequisites

- **Node.js** >= 18 and **npm** (for services and shared packages)
- **Bun** >= 1.0 (for CRE workflows) — `curl -fsSL https://bun.sh/install | bash`
- **Foundry** (for Solidity contracts) — `curl -L https://foundry.paradigm.xyz | bash && foundryup`
- **Chainlink CRE CLI** — `curl -sSL https://cre-cli.chainlink.io/install | bash`

Verify everything is installed:

```bash
node --version    # v18+
bun --version     # 1.0+
forge --version   # any recent
~/.cre/bin/cre version  # v1.2+
```

## Quick Start

```bash
# 1. Clone and install everything
git clone https://github.com/Darbease/ProofPA.git
cd ProofPA
make install

# 2. Build and test contracts
make build
make test-contracts

# 3. Start a local Anvil chain (terminal 1)
make anvil

# 4. Deploy contracts to Anvil (terminal 2)
make deploy-local
make deploy-verify     # confirm escrow balance + roles

# 5. Start backend services (terminal 3)
make services

# 6. Simulate CRE workflows (terminal 2)
make simulate-wf004    # EVM reads only — no services needed
make simulate-wf001    # full prior-auth flow (needs services + Anvil)
make simulate-wf002    # consent revocation (needs services + Anvil)
make simulate-wf003    # challenge resolution (needs services + Anvil)
make simulate-wf005    # AES-GCM encryption showcase (needs services + Anvil)
make simulate          # run all 5 sequentially

# 7. Run the E2E demo (3 scenarios: approve, deny, challenge)
make demo
```

## Repository Structure

```
ProofPA/
├── contracts/                    Solidity contracts (Foundry)
│   ├── src/
│   │   ├── MockUSDC.sol              ERC-20 mock USDC (6 decimals)
│   │   ├── ConsentRegistry.sol       Consent lifecycle (ACTIVE/REVOKED/EXPIRED)
│   │   ├── PolicyRegistry.sol        Policy version hashes and activation windows
│   │   ├── ClaimDecisionRegistry.sol Claim state machine (6 states + NONE)
│   │   └── ClaimEscrow.sol           ERC-20 payout pool (schedule/release/cancel)
│   ├── test/                         52 tests (unit + fuzz + invariant)
│   └── script/Deploy.s.sol          Deploys all 5, grants roles, seeds data
│
├── packages/                    Shared TypeScript packages (npm workspaces)
│   ├── schemas/                     Zod schemas, denial bitmap constants, computeClaimId
│   ├── eip712-types/                EIP-712 typed data for signed payloads
│   ├── observability/               Structured JSON logging + correlation IDs
│   └── sdk-client/                  Contract ABIs + API client functions
│
├── services/                    Backend Express services (ports 3001-3006)
│   ├── policy-service/              :3001 — GET /v1/policies/:payerId/:version
│   ├── credential-service/          :3002 — POST /v1/credentials/verify
│   ├── proof-service-stub/          :3003 — POST /v1/proofs/medical-necessity
│   ├── consent-service/             :3004 — grant/revoke + GET revocations
│   ├── provider-adapter-api/        :3005 — POST /v1/prior-auth/submit
│   └── decision-callback-service/   :3006 — decision/consent/challenge callbacks
│
├── ProofPACRE/                  CRE workflow project (bun, separate from npm)
│   ├── project.yaml                 CRE targets, RPCs, experimental chains (Anvil)
│   ├── secrets.yaml                 Vault secret → env var mappings
│   ├── .env                         Local simulation env vars
│   ├── wf-001-prior-auth-decision/  HTTPClient + ConfHTTP + EVMClient R/W
│   ├── wf-002-consent-revocation/   ConfHTTP + EVMClient READ
│   ├── wf-003-challenge-resolution/ ConfHTTP + EVMClient READ
│   ├── wf-004-reconciliation-monitor/ EVMClient READ only (pure on-chain)
│   └── wf-005-encrypted-credential-audit/ 4x ConfHTTP [AES-GCM] + EVMClient READ
│
├── tests/                       Vitest integration tests + E2E demo runner
├── infra/                       Docker configs, start-services.sh
├── docs/                        Architecture docs, MVP decisions
└── Makefile                     All build/test/deploy/simulate commands
```

## Smart Contracts

Five Solidity contracts on Base Sepolia (or local Anvil) using OpenZeppelin `AccessControl`:

| Contract | Address (Anvil) | Responsibility |
|---|---|---|
| `MockUSDC` | `0x5FbDB2315678afecb367f032d93F642f64180aa3` | ERC-20 settlement token (6 decimals) |
| `ConsentRegistry` | `0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512` | Consent lifecycle (ACTIVE/REVOKED/EXPIRED) |
| `PolicyRegistry` | `0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0` | Policy version hashes and activation windows |
| `ClaimDecisionRegistry` | `0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9` | Claim state machine (7 states) |
| `ClaimEscrow` | `0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9` | ERC-20 payout pool (schedule, release, cancel) |

```bash
make build-contracts     # compile with forge
make test-contracts      # run 52 tests (unit + fuzz + invariant)
```

### Contract Functions Reference

**ConsentRegistry:**
| Function | Role | Description |
|---|---|---|
| `upsertConsent(input)` | WORKFLOW_ROLE | Create/update consent record |
| `revokeConsent(consentId, reasonCode)` | WORKFLOW_ROLE | Revoke consent |
| `isConsentActive(consentId, atTs) → bool` | (view) | Check if consent is active at timestamp |
| `getConsent(consentId) → ConsentRecord` | (view) | Full consent record |

**PolicyRegistry:**
| Function | Role | Description |
|---|---|---|
| `setPolicyVersion(hash, verifierKey, from, to, active)` | POLICY_ADMIN_ROLE | Create/update policy |
| `isPolicyActive(policyHash, atTs) → bool` | (view) | Check if policy is active at timestamp |
| `getPolicyVersion(policyHash) → PolicyVersion` | (view) | Full policy record |

**ClaimDecisionRegistry:**
| Function | Role | State Transition |
|---|---|---|
| `submitClaim(claimId, policyHash)` | WORKFLOW_ROLE | NONE → SUBMITTED |
| `setProofResult(claimId, proofHash, bitmap, approved)` | WORKFLOW_ROLE | SUBMITTED → APPROVED or DENIED |
| `challengeClaim(claimId, reasonCode)` | CHALLENGE_ROLE | APPROVED → CHALLENGED |
| `resolveChallenge(claimId, approve)` | CHALLENGE_ROLE | CHALLENGED → APPROVED or DENIED |
| `markPaid(claimId)` | WORKFLOW_ROLE | APPROVED → PAID |
| `getDecision(claimId) → ClaimDecision` | (view) | Full claim state + metadata |

**ClaimEscrow:**
| Function | Role | Payout Transition |
|---|---|---|
| `fundPool(amount)` | TREASURY_ROLE | Deposits ERC-20 into escrow |
| `schedulePayout(claimId, recipient, amount)` | WORKFLOW_ROLE | NONE → SCHEDULED |
| `releasePayout(claimId)` | WORKFLOW_ROLE | SCHEDULED → RELEASED (executes transfer) |
| `cancelPayout(claimId)` | CHALLENGE_ROLE | SCHEDULED → CANCELLED |
| `getPayout(claimId) → PayoutInstruction` | (view) | Payout status + details |

### Local Chain Deployment (Anvil)

```bash
# Terminal 1: start Anvil
make anvil

# Terminal 2: deploy + verify
make deploy-local
make deploy-verify
```

The deploy script deploys all 5 contracts, grants roles, mints 1M mock USDC, funds the escrow pool, and seeds a demo policy. It uses Anvil's default accounts:

| Role | Anvil Account | Address | Permissions |
|---|---|---|---|
| Deployer / Admin | 0 | `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266` | DEFAULT_ADMIN_ROLE, POLICY_ADMIN_ROLE, TREASURY_ROLE |
| CRE Signer | 1 | `0x70997970C51812dc3A010C7d01b50e0d17dc79C8` | WORKFLOW_ROLE on all registries + escrow |
| Ops | 2 | `0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC` | CHALLENGE_ROLE, POLICY_ADMIN_ROLE |
| Treasury | 3 | `0x90F79bf6EB2c4f870365E785982E1f101E93b906` | TREASURY_ROLE |

## Services

Six Express services handle off-chain logic. Start them all with `make services`.

| Port | Service | Endpoints | Called By |
|---|---|---|---|
| 3001 | policy-service | `GET /v1/policies/:payerId/:version` | WF-001 |
| 3002 | credential-service | `POST /v1/credentials/verify` | WF-005 |
| 3003 | proof-service-stub | `POST /v1/proofs/medical-necessity` | WF-001 |
| 3004 | consent-service | `POST /v1/consents/grant\|revoke`, `GET /v1/consents/revocations` | WF-002 |
| 3005 | provider-adapter-api | `POST /v1/prior-auth/submit` | Provider Portal |
| 3006 | decision-callback-service | `POST /v1/callbacks/prior-auth-decision`, `POST /v1/callbacks/consent-revoked`, `GET /v1/callbacks/pending-challenges`, `POST /v1/callbacks/challenge-resolved` | WF-001, WF-002, WF-003 |

Health check: `curl http://localhost:{port}/healthz`

## Demo Dashboard

An interactive web dashboard at `http://localhost:3000` replaces the CLI demo runner with a visual experience:

- **Dashboard** — System health panel (6 services + Anvil), 3 scenario cards
- **Scenario Runner** — Click through each step, see API requests/responses, watch the claim state machine update in real-time
- **Contract Explorer** — Look up claim decisions, payout status, consent, and policy state directly from Anvil
- **CRE Simulator** — Trigger workflow simulations and stream real-time output

```bash
make dashboard-install   # install dashboard dependencies
make dashboard           # start Next.js on :3000 (requires anvil + deploy-local + services)
```

## E2E Demo Scenarios

The demo runner (`make demo`) exercises three acceptance scenarios end-to-end:

```
Scenario A: Happy Path (APPROVED → PAID)
  1. POST /v1/prior-auth/submit → claim accepted
  2. Proof service evaluates → PASS (bitmap = 0)
  3. Decision callback → APPROVED, on-chain settlement

Scenario B: Revoked Consent (DENIED)
  1. POST /v1/consents/revoke → consent revoked
  2. Proof service evaluates → FAIL (bitmap bit 3 = consent invalid)
  3. Decision → DENIED

Scenario C: Challenge → Resolution
  1. POST /v1/prior-auth/submit → APPROVED
  2. Ops challenges claim → payout BLOCKED
  3. Resolution → APPROVED or DENIED after review
```

## Make Targets

```
make help                # show all targets
make install             # install all deps (contracts + services + CRE workflows)
make build               # build contracts
make test                # run all tests (contracts + services)
make test-contracts      # Foundry tests only (52 tests)
make test-services       # Vitest tests only
make anvil               # start local Anvil chain (foreground)
make anvil-stop          # stop background Anvil
make deploy-local        # deploy all contracts to Anvil
make deploy-verify       # check escrow balance + roles on Anvil
make services            # start backend services (foreground, ports 3001-3006)
make services-stop       # kill background services
make simulate            # simulate all 5 CRE workflows
make simulate-wf001      # simulate WF-001 (needs services + Anvil)
make simulate-wf002      # simulate WF-002 (needs services + Anvil)
make simulate-wf003      # simulate WF-003 (needs services + Anvil)
make simulate-wf004      # simulate WF-004 (needs Anvil only)
make simulate-wf005      # simulate WF-005: AES-GCM encryption showcase
make demo                # run E2E demo (3 scenarios)
make demo-full           # full E2E: anvil → deploy → services → demo → CRE broadcast
make broadcast           # broadcast all 5 CRE workflows (on-chain writes)
make dashboard-install   # install dashboard dependencies
make dashboard           # start demo dashboard (Next.js on :3000)
make clean               # remove build artifacts
```

## Key Design Decisions

- **No PHI onchain or in CRE logs** — only hashes, commitments, state transitions, and payout events go on-chain. CRE workflow logs contain only IDs (claim hashes, consent hashes), procedure codes (PROC_*, CPT), provider fixture IDs, predicate check counts, and on-chain state names — never patient names, MRNs, diagnoses, or clinical narratives. Sensitive medical data stays off-chain in encrypted CRE enclave calls and service responses.
- **Deterministic claim ID** — `keccak256(payer_id | provider_id_hash | encounter_ref_hash | procedure_bucket | service_date)` ensures the same claim always gets the same ID. Duplicate submissions revert.
- **ZK deferred** — MVP uses signature-based verification (physician JWS attestation, payer policy hash signature, CRE decision report signature). ZK proof circuits are post-hackathon.
- **All 3 CRE capabilities** — HTTPClient for public consensus reads, ConfidentialHTTPClient for secret-injected enclave calls, EVMClient for on-chain contract interaction. This is the first project to use all three in a single healthcare workflow.
- **AES-GCM output encryption** — All 10 ConfidentialHTTPClient calls across WF-001/002/003/005 use `encryptOutput: true`, ensuring HTTP response payloads are AES-GCM encrypted end-to-end through the DON network. WF-005 is a dedicated showcase with 4 encrypted calls + audit metadata.
- **CRE log privacy** — Workflow `runtime.log()` calls never emit PHI. Logs reference only claim/consent hashes, procedure codes (e.g., `PROC_KNEE_MRI`), predicate pass/fail counts, provider fixture IDs, and on-chain state names. Clinical narrative (patient names, diagnoses, dollar amounts) stays in the service responses — parsed for business logic but never echoed to DON logs.
- **Network**: Base Sepolia (with local Anvil for development via experimental-chains)
- **Token**: ERC-20 mock USDC (6 decimals)

See `docs/MVP_DECISIONS.md` for the full list of frozen architecture decisions.
