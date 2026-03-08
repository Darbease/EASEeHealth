# ProofPA

**Privacy-preserving prior authorization and instant on-chain settlement using Chainlink CRE**

---

## The Problem

Prior authorization is the most hated process in American healthcare.

A physician decides a patient needs a $38,000 coronary stent. They fax — yes, fax — a request to the insurance company. A nurse reviewer looks at it 3-7 business days later. Maybe they approve it. Maybe they deny it and the physician appeals. Maybe the paperwork gets lost. The patient waits.

- **72%** of physicians report that prior auth delays lead to adverse patient outcomes
- **14 hours/week** per practice spent on prior auth phone calls and fax follow-ups
- **$528 billion** in annual US healthcare administrative costs (31% of total spending)
- **34%** of prior auth denials are eventually overturned on appeal — meaning the initial denial was wrong
- **$100B+** in annual fraud because verification is manual, siloed, and trust-based

The core dysfunction: every party maintains their own version of truth, nobody can verify anyone else's claims in real time, and the entire process runs on phone calls and PDFs.

---

## How ProofPA Fixes It

We mapped every actor and every step in traditional prior auth to a cryptographic equivalent:

| Traditional System | ProofPA Equivalent | What Changes |
|---|---|---|
| Fax/portal submission | `POST /submit` + `submitClaim()` on-chain | Submission is atomic and timestamped — no lost faxes |
| Patient consent form (paper) | `ConsentRegistry.isConsentActive()` on-chain | Consent is verifiable in real time, revocable instantly |
| Policy manual (PDF binder) | `PolicyRegistry.isPolicyActive()` + versioned predicate hashes | Policy is deterministic code, not human interpretation |
| Nurse clinical reviewer | `proof-service` — 6-8 predicate evaluation with bitmap | Review is reproducible — same inputs always produce same output |
| Approval letter (mailed) | `setProofResult()` on-chain with reason bitmap | Decision is immutable and machine-readable |
| Paper check (30 days) | `ClaimEscrow.releasePayout()` — ERC-20 transfer | Settlement is instant — seconds, not weeks |
| Appeal process (months) | `challengeClaim()` + `resolveChallenge()` — state machine enforced | Disputes are structured — payout freezes until resolution |

**The key insight**: we didn't automate paperwork — we replaced trust assumptions with verification. The traditional system *trusts* that the provider's credential is valid, that consent was really given, that the procedure is really covered. ProofPA *verifies* each of those claims against on-chain state and signed attestations before any money moves.

---

## Why Chainlink CRE

The question isn't just "can we automate prior auth?" — it's "who runs the automation, and why should anyone trust it?"

If a payer runs the decisioning logic on their own server, the provider has no reason to trust the result. If the provider runs it, the payer has no reason to trust it. And if you put it on a simple smart contract, you can't call external APIs for clinical data, credential verification, or policy lookups.

**Chainlink CRE solves the multi-party trust problem.** The workflow runs on a Decentralized Oracle Network (DON) — not on any single party's infrastructure. The DON nodes independently execute the same logic, reach consensus on HTTP responses, and sign the result. The on-chain contracts verify that signature before accepting any state transition. Nobody has to trust anyone — they verify.

### The Four CRE Capabilities We Use

| Capability | What It Does | Why It Matters |
|---|---|---|
| **HTTPClient** (DON Consensus) | All DON nodes make the same API call independently and compare responses | If anyone tampers with the policy API, the workflow halts. Every API call is cross-verified. |
| **ConfidentialHTTPClient** (AES-GCM) | Encrypted API calls — DON node operators cannot read the payloads | HIPAA-compliant data handling. More secure than the fax machines it replaces. |
| **EVMClient** (Read + Write) | On-chain reads and DON-signed writes to smart contracts | Single source of truth. Contracts verify DON signatures — no single entity can forge a decision. |
| **HTTPCapability** (HTTP Trigger) | Workflow fires instantly on signed HTTP request | Cryptographic access control via ECDSA signatures — not API keys, not OAuth tokens. |

### Three Trigger Types — Three Clinical Urgency Levels

We built **8 CRE workflows** using all three trigger types. Each maps to a different operational model:

| Trigger | Workflows | Use Case | Latency |
|---|---|---|---|
| **Cron** (CronCapability) | WF-001, WF-004, WF-005, WF-006 | Batch processing, monitoring, auditing | Every 30s |
| **Log** (EVMClient.logTrigger) | WF-003, WF-007 | Reactive — fires on on-chain events | Instant (event-driven) |
| **HTTP** (HTTPCapability) | WF-002, WF-008 | On-demand — fires on signed request | Instant (request-driven) |

Together they create a layered reliability model: HTTP handles the fastest path, Log handles reactive processing, Cron catches anything that fell through. Nothing falls through the cracks.

---

## What We Built — By the Numbers

- **8** CRE workflows using all 3 trigger types (cron, log, HTTP)
- **5** Solidity contracts with 52 Foundry tests (unit + fuzz + invariant)
- **6** backend TypeScript services
- **4** shared packages (@proofpa/schemas, eip712-types, observability, sdk-client)
- **1** interactive Next.js 16 dashboard with live on-chain state and streaming CRE output
- **Full settlement pipeline**: Reset Chain → Deploy Contracts → Run CRE Workflow → Settle On-Chain — all from the browser
- **AES-GCM encryption** on every ConfidentialHTTP call across all 8 workflows
- **8-bit denial reason bitmap** for structured, machine-readable denial explanations
- **Zero PHI on-chain** — only hashes, state transitions, policy references, and payout events
- **Synthea-based clinical data** (10 CSV files) for realistic healthcare scenarios

---

## Live Demo Dashboard

The dashboard (Next.js 16 + React 19 + TanStack Query) connects directly to the local Anvil chain and all six backend services. Three demo scenarios — one per trigger type:

| Scenario | Trigger | Workflow | Claim Amount | What Happens |
|---|---|---|---|---|
| **A** — Batch Prior Auth | Cron | WF-001 | $850 knee MRI | Classic batch path. CRE polls, evaluates, settles. |
| **B** — Transfer Settlement | Log | WF-007 | $32,300 cardiac stent | `submitClaim()` emits event → WF-007 fires reactively → settles instantly. |
| **C** — On-Demand Prior Auth | HTTP | WF-008 | $38,000 cardiac CT | Signed HTTP request → WF-008 fires with full payload → zero-delay settlement. |

Each scenario shows live on-chain state (claim state machine, payout status, proof hash, escrow balance) auto-refreshing every 2 seconds, plus streaming CRE workflow output via Server-Sent Events.

---

## System Architecture Overview

ProofPA connects **provider portals** to **six backend services** to **eight Chainlink CRE workflows** to **five Solidity contracts** on-chain. The CRE workflows are the orchestration brain — they read and write to both off-chain services (via HTTP) and on-chain contracts (via EVMClient), all executing inside a decentralized oracle network (DON). All ConfidentialHTTPClient calls use **AES-GCM output encryption** (`encryptOutput: true`) to ensure response payloads are encrypted end-to-end through the DON.

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
│  ┌──────────────────┐     │  │  0. ──[CONF HTTP]────► Provider Adapter :3005  │ │   │
│  │  Policy Service   │◄───┼──│       GET /v1/ehr/claims/outstanding            │ │   │
│  │  :3001            │     │  │  1. ──[HTTP GET]──────► Policy Service :3001    │ │   │
│  └──────────────────┘     │  │  2. ──[EVM READ]─────► ConsentRegistry         │ │   │
│                            │  │  3. ──[EVM READ]─────► PolicyRegistry          │ │   │
│  ┌──────────────────┐     │  │  4. ──[CONF HTTP]────► Proof Service :3003     │ │   │
│  │  Proof Service    │◄───┼──│  5. ──[EVM WRITE]────► submitClaim             │ │   │
│  │  Stub :3003       │     │  │  6. ──[EVM WRITE]────► setProofResult          │ │   │
│  └──────────────────┘     │  │  7. ──[EVM WRITE]────► schedulePayout          │ │   │
│                            │  │  8. ──[EVM WRITE]────► releasePayout           │ │   │
│                            │  │  9. ──[EVM WRITE]────► markPaid                │ │   │
│                            │  │ 10. ──[CONF HTTP]────► Callback Service :3006  │ │   │
│                            │  └─────────────────────────────────────────────────┘ │   │
│                            │                                                      │   │
│  ┌──────────────────┐     │  ┌─────────────────────────────────────────────────┐ │   │
│  │  Consent Service  │◄───┼──│  WF-002  Consent Revocation       [HTTP TRIG]  │ │   │
│  │  :3004            │     │  │                                                 │ │   │
│  └──────────────────┘     │  │  TRIGGER: Signed HTTP request from patient      │ │   │
│                            │  │  0. ──[DECODE]────────► Parse HTTP payload      │ │   │
│  ┌──────────────────┐     │  │  1. ──[CONF HTTP]────► Consent Service :3004   │ │   │
│  │  Credential Svc   │     │  │  2. ──[EVM READ]─────► ConsentRegistry         │ │   │
│  │  :3002            │     │  │  3. ──[EVM WRITE]────► revokeConsent           │ │   │
│  └──────────────────┘     │  │  4. ──[EVM READ]─────► getDecision (cascade)   │ │   │
│                            │  │  5. ──[EVM WRITE]────► challengeClaim          │ │   │
│                            │  │  6. ──[EVM WRITE]────► cancelPayout            │ │   │
│                            │  │  7. ──[CONF HTTP]────► Callback Service :3006  │ │   │
│                            │  └─────────────────────────────────────────────────┘ │   │
│                            │  ┌─────────────────────────────────────────────────┐ │   │
│                            │  │  WF-003  Challenge Resolution      [LOG TRIG]  │ │   │
│  ┌──────────────────┐     │  │                                                 │ │   │
│  │  Decision Callback│◄───┼──│  TRIGGER: ProofEvaluated event on-chain         │ │   │
│  │  Service :3006    │     │  │  0. ──[DECODE]────────► Parse log data          │ │   │
│  └──────────────────┘     │  │  1. ──[EVM READ]─────► getDecision              │ │   │
│                            │  │  2. ──[EVM READ]─────► isConsentActive          │ │   │
│                            │  │  3. ──[HTTP GET]──────► Policy Service :3001    │ │   │
│                            │  │  4. ──[CONF HTTP]────► Proof Service :3003     │ │   │
│                            │  │  5. ──[EVM WRITE]────► challengeClaim (if risk) │ │   │
│                            │  │  6. ──[CONF HTTP]────► Callback Service :3006  │ │   │
│                            │  └─────────────────────────────────────────────────┘ │   │
│                            │                                                      │   │
│                            │  ┌─────────────────────────────────────────────────┐ │   │
│                            │  │  WF-004  Reconciliation Monitor                │ │   │
│  ┌──────────────────┐     │  │                                                 │ │   │
│  │  Synthea EHR Data │◄───┼──│  1. ──[CONF HTTP]────► Provider Adapter :3005  │ │   │
│  │  (data/synthea/)  │     │  │       GET /v1/ehr/claims?status=BILLED         │ │   │
│  └──────────────────┘     │  │  2. ──[EVM READ]─────► ClaimDecisionRegistry   │ │   │
│                            │  │  3. ──[EVM READ]─────► ClaimEscrow             │ │   │
│                            │  │  4.   Cross-check off-chain vs on-chain state  │ │   │
│                            │  └─────────────────────────────────────────────────┘ │   │
│                            │                                                      │   │
│                            │  ┌─────────────────────────────────────────────────┐ │   │
│                            │  │  WF-005  Encrypted Credential Audit  [AES-GCM] │ │   │
│                            │  │                                                 │ │   │
│                            │  │  0. ──[ENC HTTP]─────► Credential Svc :3002    │ │   │
│                            │  │       GET /v1/registry/providers (w/ org name) │ │   │
│                            │  │  1. ──[ENC HTTP]─────► Credential Svc :3002    │ │   │
│                            │  │  2. ──[EVM READ]─────► ConsentRegistry         │ │   │
│                            │  │  3. ──[ENC HTTP]─────► Policy Service :3001    │ │   │
│                            │  │  4. ──[ENC HTTP]─────► Proof Service :3003     │ │   │
│                            │  │  5. ──[ENC HTTP]─────► Callback Service :3006  │ │   │
│                            │  └─────────────────────────────────────────────────┘ │   │
│                            │                                                      │   │
│                            │  ┌─────────────────────────────────────────────────┐ │   │
│                            │  │  WF-006  Medication Payment Verification       │ │   │
│                            │  │                                                 │ │   │
│                            │  │  0. ──[CONF HTTP]────► Provider Adapter :3005  │ │   │
│                            │  │       GET /v1/ehr/medications/pending-auth      │ │   │
│                            │  │  1. ──[HTTP GET]──────► Policy Service :3001    │ │   │
│                            │  │  2. ──[EVM READ]─────► ConsentRegistry         │ │   │
│                            │  │  3. ──[EVM READ]─────► PolicyRegistry          │ │   │
│                            │  │  4. ──[CONF HTTP]────► Proof Service :3003     │ │   │
│                            │  │  5-9 ─[EVM WRITE]────► submit+approve+payout   │ │   │
│                            │  │ 10. ──[CONF HTTP]────► Callback Service :3006  │ │   │
│                            │  └─────────────────────────────────────────────────┘ │   │
│                            │                                                      │   │
│                            │  ┌─────────────────────────────────────────────────┐ │   │
│                            │  │  WF-007  Claim Transfer Settlement  [LOG TRIG] │ │   │
│                            │  │                                                 │ │   │
│                            │  │  TRIGGER: ClaimSubmitted event on-chain         │ │   │
│                            │  │  0. ──[CONF HTTP]────► Provider Adapter :3005  │ │   │
│                            │  │       GET /v1/ehr/claims/transfers/pending      │ │   │
│                            │  │  1. ──[HTTP GET]──────► Policy Service :3001    │ │   │
│                            │  │  2. ──[EVM READ]─────► ConsentRegistry         │ │   │
│                            │  │  3. ──[EVM READ]─────► PolicyRegistry          │ │   │
│                            │  │  4. ──[CONF HTTP]────► Proof Service :3003     │ │   │
│                            │  │  5-8 ─[EVM WRITE]────► approve+payout+markPaid │ │   │
│                            │  │  9. ──[CONF HTTP]────► Callback Service :3006  │ │   │
│                            │  └─────────────────────────────────────────────────┘ │   │
│                            │                                                      │   │
│                            │  ┌─────────────────────────────────────────────────┐ │   │
│                            │  │  WF-008  HTTP Prior Auth           [HTTP TRIG] │ │   │
│                            │  │                                                 │ │   │
│                            │  │  TRIGGER: Signed HTTP request from provider     │ │   │
│                            │  │  0. ──[DECODE]────────► Parse HTTP payload      │ │   │
│                            │  │  1. ──[EVM READ]─────► ConsentRegistry         │ │   │
│                            │  │  2. ──[EVM READ]─────► PolicyRegistry          │ │   │
│                            │  │  3. ──[HTTP GET]──────► Policy Service :3001    │ │   │
│                            │  │  4. ──[CONF HTTP]────► Proof Service :3003     │ │   │
│                            │  │  5-9 ─[EVM WRITE]────► submit+approve+payout   │ │   │
│                            │  │ 10. ──[CONF HTTP]────► Callback Service :3006  │ │   │
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
| **Cron Trigger** | `CronCapability` | Time-driven polling on a schedule (every 30s) | WF-001, WF-004, WF-005, WF-006 |
| **HTTP Trigger** | `HTTPCapability` | Request-driven — fires immediately on signed HTTP request | WF-002, WF-008 |
| **Log Trigger** | `EVMClient.logTrigger()` | Event-driven — fires when specific on-chain event is emitted | WF-003, WF-007 |
| **Regular HTTP** | `HTTPClient` | Public API calls with DON consensus (all nodes must agree) | WF-001, WF-003, WF-006, WF-007, WF-008 |
| **Confidential HTTP** | `ConfidentialHTTPClient` | Encrypted API calls with secrets injected inside TEE enclave. All use `encryptOutput: true` (AES-GCM). | All workflows |
| **EVM Read/Write** | `EVMClient` | On-chain reads via `callContract()` and DON-signed writes via `writeReport()` | All workflows |

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

 Step 0 ── [ConfidentialHTTPClient + AES-GCM Encryption] ─────────────────────
 │
 │  GET http://localhost:3005/v1/ehr/claims/outstanding
 │
 │  Fetches outstanding BILLED claims from the EHR (Synthea data) to populate
 │  the prior-auth request with real clinical data instead of fixtures.
 │  encryptOutput: true → patient data encrypted through DON.
 │
 │  ◄── Returns: {
 │        outstanding_claims: [{
 │          patient_name: "Maria Garcia",
 │          procedures: [{ description: "Coronary artery stent...", cost: "38586.73" }],
 │          total_claim_cost: "$48,500.42"
 │        }]
 │      }
 │
 │  Extracted: patientDisplay, procedureDisplay, requestedAmount
 │  Falls back to demo fixtures if EHR unreachable.
 │
 ▼
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

## WF-002: Consent Revocation (HTTP Trigger — Consent Cascade)

**User Stories:**

> **As a patient**, I want to withdraw my data-sharing consent via my portal and have the revocation take effect immediately — revoking on-chain, challenging any approved claims, and cancelling scheduled payouts — so that my right to revoke is enforced in real time.

> **As a compliance officer**, I want consent revocations to trigger a cross-contract cascade that automatically protects the payer from paying out on claims where consent no longer exists.

> **As a provider**, I want to be notified automatically when a patient's consent revocation affects my pending claims, so that I can take action without manual follow-up.

Patient-initiated consent cascade: the patient portal sends a signed revocation request to the CRE gateway via HTTPCapability. The workflow fires immediately, revokes consent on-chain, then cascades across all affected claims — challenging approved claims and cancelling scheduled payouts. Cross-contract fan-out across ConsentRegistry + ClaimDecisionRegistry + ClaimEscrow.

```
WF-002: Consent Revocation — Data Flow (HTTP Trigger)
═════════════════════════════════════════════════════

TRIGGER: HTTPCapability — signed HTTP request from patient portal

 Step 0 ── [DECODE PAYLOAD] ─────────────────────────────────────────────
 │
 │  Parse payload.input bytes → JSON
 │  Extract: consent_id, reason_code, affected_claim_id
 │
 ▼
 Step 1 ── [ConfidentialHTTPClient + AES-GCM Encryption] ───────────────
 │
 │  GET http://localhost:3004/v1/consents/revocations?since=900
 │
 │  Validates revocation request against consent-service records.
 │
 ▼
 Step 2 ── [EVMClient.callContract — READ] ──────────────────────────────
 │
 │  Contract: ConsentRegistry
 │  Function: isConsentActive(consentId, atTs) → bool
 │
 │  Verify consent is currently ACTIVE on-chain before revoking.
 │
 ▼
 Step 3 ── [EVMClient.writeReport — WRITE] (only if ACTIVE) ────────────
 │
 │  Contract: ConsentRegistry
 │  Function: revokeConsent(consentId, reasonCode)
 │
 │  On-chain effect: ACTIVE → REVOKED
 │  Emits: ConsentRevoked(consentId, reasonCode)
 │
 ▼
 Step 4 ── [EVMClient.callContract — READ] ──────────────────────────────
 │
 │  Contract: ClaimDecisionRegistry
 │  Function: getDecision(affectedClaimId) → ClaimDecision
 │
 │  CASCADE: Check affected claim state. If APPROVED, must block payout.
 │
 ▼
 Step 5 ── [EVMClient.writeReport — WRITE] (only if APPROVED) ──────────
 │
 │  Contract: ClaimDecisionRegistry
 │  Function: challengeClaim(affectedClaimId, "consent-revoked")
 │
 │  On-chain effect: APPROVED → CHALLENGED
 │  Payout is now BLOCKED.
 │
 ▼
 Step 6 ── [EVMClient.writeReport — WRITE] (only if challenged) ────────
 │
 │  Contract: ClaimEscrow
 │  Function: cancelPayout(affectedClaimId)
 │
 │  On-chain effect: SCHEDULED → CANCELLED
 │  Funds returned to escrow pool.
 │
 ▼
 Step 7 ── [ConfidentialHTTPClient + AES-GCM Encryption] ───────────────
 │
 │  POST http://localhost:3006/v1/callbacks/consent-revoked
 │  Body: { consent_id, revoked_onchain, affected_claim_state,
 │          challenged_onchain, timestamp }
 │
 ▼
 RESULT: { workflow: "WF-002-ConsentRevocation", trigger_type: "http",
           revoked_onchain: true, challenged_onchain: true }
```

---

## WF-003: Challenge Resolution (Log Trigger — Automated Compliance Gate)

**User Stories:**

> **As a compliance officer**, I want every approved claim to be automatically re-evaluated against current policy predicates and consent status, so that the system acts as an autonomous on-chain compliance gate.

> **As an auditor**, I want claims that exceed amount caps or have revoked consent to be automatically challenged within seconds of approval, rather than discovered days later during manual review.

> **As a payer**, I want the CRE network to reactively monitor on-chain approval events and auto-challenge risky claims, so that no fraudulent payout can slip through the window between approval and settlement.

Automated compliance gate: fires on `ProofEvaluated(bytes32 indexed claimId, bytes32 proofHash, bool approved, uint256 reasonBitmap)` events emitted by ClaimDecisionRegistry. When a claim is approved, WF-003 runs risk analysis — re-evaluates against policy predicates, verifies consent is still active — and auto-challenges if risk is detected.

```
WF-003: Challenge Resolution — Data Flow (Log Trigger)
══════════════════════════════════════════════════════

TRIGGER: EVMClient.logTrigger() on ProofEvaluated event
         topic0 = 0xfeae156cecc52d91998049b161ea0e9f9b90abfb795577187403978249a2dc10

 Step 0 ── [DECODE LOG] ─────────────────────────────────────────────────
 │
 │  Parse EVMLog topics and data:
 │    topic[1] = claimId (indexed bytes32)
 │    data = proofHash, approved (bool), reasonBitmap (uint256)
 │
 │  Skip denied claims (approved == false) — no compliance check needed.
 │
 ▼
 Step 1 ── [EVMClient.callContract — READ] ──────────────────────────────
 │
 │  Contract: ClaimDecisionRegistry
 │  Function: getDecision(claimId) → ClaimDecision
 │
 │  Verify on-chain state matches log data. Read full claim struct.
 │
 ▼
 Step 2 ── [EVMClient.callContract — READ] ──────────────────────────────
 │
 │  Contract: ConsentRegistry
 │  Function: isConsentActive(consentId, atTs) → bool
 │
 │  Post-approval consent check — was consent revoked between submission
 │  and approval?
 │
 ▼
 Step 3 ── [HTTPClient with DON Consensus] ──────────────────────────────
 │
 │  GET http://localhost:3001/v1/policies/payer-demo-001/v1
 │
 │  Fetch policy predicates for compliance re-evaluation.
 │
 ▼
 Step 4 ── [ConfidentialHTTPClient + AES-GCM Encryption] ───────────────
 │
 │  POST http://localhost:3003/v1/proofs/medical-necessity
 │
 │  Re-evaluate claim against policy predicates with current data.
 │  Detects if amount caps have changed, consent was revoked, etc.
 │
 │  Risk detection:
 │    - Re-eval FAIL → auto-challenge
 │    - Consent revoked → auto-challenge
 │    - Amount exceeds cap → auto-challenge
 │
 ▼
 Step 5 ── [EVMClient.writeReport — WRITE] (only if risk detected) ─────
 │
 │  Contract: ClaimDecisionRegistry
 │  Function: challengeClaim(claimId, "compliance-auto-challenge")
 │
 │  On-chain effect: APPROVED → CHALLENGED
 │  Payout is now BLOCKED pending manual review.
 │
 ▼
 Step 6 ── [ConfidentialHTTPClient + AES-GCM Encryption] ───────────────
 │
 │  POST http://localhost:3006/v1/callbacks/challenge-resolved
 │  Body: { workflow_id: "WF-003", claim_id, compliance_result,
 │          risk_detected, challenged_onchain, timestamp }
 │
 ▼
 RESULT: { workflow: "WF-003-ChallengeResolution", trigger_type: "log",
           compliance_result: "PASS|FAIL", risk_detected: false,
           challenged_onchain: false }
```

---

## WF-004: Reconciliation Monitor

**User Stories:**

> **As a system operator**, I want to be alerted within 15 minutes if any claim is stuck in `PROOF_PENDING` state, so that I can investigate whether the proof service is down or a workflow execution failed before it impacts SLO targets.

> **As a finance team member**, I want the system to automatically cross-reference outstanding claims in our EHR/billing system against on-chain settlement state, so that I can see which claims are still waiting 30-90 days for traditional payment when they could be settled on-chain in seconds.

> **As a payer**, I want an independent monitor that verifies cross-contract consistency between `ClaimDecisionRegistry` and `ClaimEscrow`, and cross-references against off-chain EHR records, so that I can trust the settlement layer operates correctly and detect reconciliation gaps.

The reconciliation workflow fetches **outstanding BILLED claims from the EHR system** (Synthea-format data served by provider-adapter-api) via ConfidentialHTTPRequest, computes deterministic `claim_id` hashes from off-chain fields, and cross-checks each against on-chain state. This is the **key demo of ProofPA's value** — showing traditional claims stuck in BILLED status for weeks while the same claims are already settled on-chain in under 120 seconds.

Falls back to legacy on-chain-only mode if the EHR is unreachable.

```
WF-004: Reconciliation Monitor — Data Flow
═══════════════════════════════════════════

TRIGGER: CronCapability fires every 30s (staging) / 15min (production)

 Step 1 ── [ConfidentialHTTPClient + AES-GCM Encryption] ───────────────────
 │
 │  GET http://localhost:3005/v1/ehr/claims?status=BILLED
 │
 │  Fetches outstanding BILLED claims from the EHR system (Synthea-format
 │  data loaded from data/synthea/claims.csv at service startup).
 │  encryptOutput: true → response encrypted through DON.
 │
 │  ◄── Returns: {
 │        claims: [
 │          { Id: "aa1b..09", patient_name: "Maria Garcia",
 │            provider_name: "Sarah Chen", Outstanding1: "7275.00",
 │            procedures: [{ code: "36969009", description: "Coronary stent",
 │                           cost: "38000.00" }] },
 │          { Id: "aa1b..10", patient_name: "William O'Brien",
 │            Outstanding1: "4600.00", ... }
 │        ],
 │        count: 2
 │      }
 │
 ▼
 Step 2 ── [For each outstanding claim] ────────────────────────────────────
 │
 │  Compute deterministic claim_id from off-chain fields:
 │    claim_id = keccak256(payer_id | hash(provider_id) | hash(encounter_id)
 │                         | diagnosis_code | service_date)
 │
 │  This mirrors the same keccak256 used in provider-adapter-api and WF-001,
 │  ensuring off-chain records map to the correct on-chain claim.
 │
 ▼
 Step 3 ── [EVMClient.callContract — READ] ──────────────────────────────────
 │
 │  Contract: ClaimDecisionRegistry (0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9)
 │  Function: getDecision(bytes32 claimId) → ClaimDecision
 │
 │  For each outstanding EHR claim, reads on-chain state:
 │
 │  Cross-reference findings:
 │    - state == NONE:  "Claim not on-chain — candidate for ProofPA submission"
 │    - state == PAID:  "RECONCILIATION FINDING — settled on-chain but EHR
 │                       still shows $7,275 outstanding"
 │    - state == PROOF_PENDING, age > SLO: "SLO VIOLATION"
 │    - state == APPROVED: check escrow status (step 4)
 │
 ▼
 Step 4 ── [EVMClient.callContract — READ] (conditional) ───────────────────
 │
 │  Contract: ClaimEscrow (0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9)
 │  Function: getPayout(bytes32 claimId) → PayoutInstruction
 │
 │  Returns: { recipient, amount, status }
 │  Payout status: 0=NONE, 1=SCHEDULED, 2=RELEASED, 3=CANCELLED
 │
 │  Cross-contract consistency checks:
 │    - Claim PAID but payout not RELEASED → MISMATCH
 │    - Claim APPROVED but no payout scheduled → MISMATCH
 │
 ▼
 RESULT: {
   workflow: "WF-004-ReconciliationMonitor",
   timestamp: "2026-03-07T...",
   ehr_claims_checked: 2,
   settled_on_chain: 1,
   stuck_claims: 0,
   mismatches: 0,
   findings: [
     { ehr_claim_id: "aa1b..09", patient: "Maria Garcia",
       status: "SETTLED_ON_CHAIN", outstanding: "7275.00",
       recommendation: "Update EHR to reflect on-chain settlement" },
     { ehr_claim_id: "aa1b..10", patient: "William O'Brien",
       status: "NOT_ON_CHAIN", outstanding: "4600.00",
       recommendation: "Submit via WF-001 for instant settlement" }
   ]
 }

 KEY DEMO INSIGHT:
   Traditional system: Maria Garcia's $38K stent claim sits BILLED for 30-90 days.
   ProofPA: Same claim settled on-chain in <120 seconds. WF-004 detects the gap.
```

---

## WF-005: Encrypted Credential Audit (AES-GCM Showcase)

**User Stories:**

> **As a credentialing coordinator**, I want to verify that a provider's NPI is valid, their license is active, the patient's consent is on-chain, and the policy covers the procedure — all in a single automated audit — so that I don't have to manually check four different systems before approving a provider for network participation.

> **As a security architect**, I want every HTTP call in the audit pipeline to be AES-GCM encrypted end-to-end through the DON, so that credential details, policy data, and proof evaluations are never exposed in plaintext to individual oracle nodes.

> **As a compliance officer**, I want an audit trail that shows exactly which checks passed or failed (credential, consent, policy, proof) with encryption metadata, so that I can demonstrate to regulators that the verification pipeline meets HIPAA transport security requirements.

A dedicated workflow that showcases AES-GCM encryption as its headline feature. Makes **5 encrypted HTTP calls** (registry lookup + credential verify + policy fetch + proof eval + callback) chained with 1 on-chain consent verification to perform a full credential audit cycle.

```
WF-005: Encrypted Credential Audit — Data Flow
════════════════════════════════════════════════

TRIGGER: CronCapability fires every 30 seconds

 Step 0 ── [ConfidentialHTTPClient + AES-GCM Encryption] ─────────────────────
 │
 │  GET http://localhost:3002/v1/registry/providers
 │
 │  Fetches a real provider from the Synthea registry to use a real
 │  provider identity instead of a hardcoded fixture.
 │  Organization name is embedded in the response (no second call needed).
 │
 │  ◄── Returns: { providers: [{ Name: "Sarah Chen",
 │        Speciality: "General Surgery",
 │        OrganizationName: "Mercy General Hospital" }] }
 │
 │  Extracted: providerName, providerSpecialty, providerOrgName
 │  Falls back to demo fixture if registry unreachable.
 │
 ▼
 Step 1 ── [ConfidentialHTTPClient + AES-GCM Encryption] ───────────────────
 │
 │  POST http://localhost:3002/v1/credentials/verify
 │
 │  Verifies provider credentials (NPI) via encrypted enclave call.
 │  Uses real provider name/specialty from Step 0.
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
     encrypted_calls: 5,
     total_calls: 5,
     all_responses_encrypted: true
   },
   steps: { ... }
 }
```

**Quota usage**: 5 HTTP calls (limit 5), 1 EVM read (limit 10) — at capacity.

---

## WF-006: Medication Payment Verification

**User Stories:**

> **As a pharmacist**, I want medication prior authorizations to be evaluated against the payer's formulary coverage and amount caps, so that I know immediately whether the prescription will be covered.

> **As a payer**, I want medication claims to go through the same on-chain settlement pipeline as procedure claims, proving that my contract architecture generalizes beyond surgical procedures.

Extends the prior-auth model from procedures to medications. Evaluates 8 predicates including formulary coverage (denial bitmap bits 6-7) and medication amount caps.

```
WF-006: Medication Payment Verification — Data Flow
════════════════════════════════════════════════════

TRIGGER: CronCapability fires every 30 seconds

 Step 0 ── [ConfidentialHTTPClient + AES-GCM] ────── GET /v1/ehr/medications/pending-auth
 Step 1 ── [HTTPClient + DON Consensus] ──────────── GET /v1/policies/payer-demo-001/v1
 Step 2 ── [EVMClient — READ] ────────────────────── ConsentRegistry.isConsentActive
 Step 3 ── [EVMClient — READ] ────────────────────── PolicyRegistry.isPolicyActive
 Step 4 ── [ConfidentialHTTPClient + AES-GCM] ────── POST /v1/proofs/medical-necessity
 Step 5 ── [EVMClient — WRITE] ───────────────────── ClaimDecisionRegistry.submitClaim
 Step 6 ── [EVMClient — WRITE] ───────────────────── ClaimDecisionRegistry.setProofResult
 Step 7 ── [EVMClient — WRITE] ───────────────────── ClaimEscrow.schedulePayout
 Step 8 ── [EVMClient — WRITE] ───────────────────── ClaimEscrow.releasePayout + markPaid
 Step 9 ── [ConfidentialHTTPClient + AES-GCM] ────── POST /v1/callbacks/prior-auth-decision

 DEMO: Maria Garcia prescribed Clopidogrel 75mg ($280) for MI
       → BlueCross PPO formulary covers it → payer pays $238 → APPROVED → PAID
```

---

## WF-007: Claim Transfer Settlement (Log Trigger — Event-Driven)

**User Stories:**

> **As a hospital transfer coordinator**, I want inter-department transfer claims to be automatically settled when submitted on-chain, without waiting for a cron poll cycle.

> **As a CRE developer**, I want to demonstrate that workflows can react to on-chain events (logs) in addition to time-based and HTTP-based triggers.

First event-driven workflow using `EVMClient.logTrigger()`. Fires when `ClaimSubmitted(bytes32 indexed claimId, bytes32 policyHash)` is emitted on-chain. Skips `submitClaim` since the claim is already SUBMITTED (that's what triggered the workflow).

```
WF-007: Claim Transfer Settlement — Data Flow (Log Trigger)
═══════════════════════════════════════════════════════════

TRIGGER: EVMClient.logTrigger() on ClaimSubmitted event

 Step 0 ── [ConfidentialHTTPClient + AES-GCM] ────── GET /v1/ehr/claims/transfers/pending
 Step 1 ── [HTTPClient + DON Consensus] ──────────── GET /v1/policies/payer-demo-001/v1
 Step 2 ── [EVMClient — READ] ────────────────────── ConsentRegistry.isConsentActive
 Step 3 ── [EVMClient — READ] ────────────────────── PolicyRegistry.isPolicyActive
 Step 4 ── [ConfidentialHTTPClient + AES-GCM] ────── POST /v1/proofs/medical-necessity
 Step 5 ── [EVMClient — WRITE] ───────────────────── ClaimDecisionRegistry.setProofResult
           (No submitClaim — claim already SUBMITTED from the triggering tx)
 Step 6 ── [EVMClient — WRITE] ───────────────────── ClaimEscrow.schedulePayout
 Step 7 ── [EVMClient — WRITE] ───────────────────── ClaimEscrow.releasePayout + markPaid
 Step 8 ── [ConfidentialHTTPClient + AES-GCM] ────── POST /v1/callbacks/prior-auth-decision

 DEMO: cast send submitClaim(0x07..07, 0xa1..a1) → ClaimSubmitted event
       → WF-007 fires → consent + policy verified → proof passes
       → payer coverage ($32,300) paid → APPROVED → PAID
```

---

## WF-008: HTTP Prior Auth (HTTP Trigger — Request-Driven)

**User Stories:**

> **As a provider**, I want my prior authorization to be processed immediately when I submit it, not 30 seconds later on the next cron tick.

> **As a CRE developer**, I want to demonstrate that the same prior-auth pipeline can be triggered by a signed HTTP request instead of cron polling, eliminating latency and saving one ConfidentialHTTP call (no EHR fetch needed — data comes from the payload).

Completes the three-trigger architecture. Provider-adapter-api signs a request and sends it directly to the CRE gateway — the workflow fires immediately with the full submission payload. All claim data comes from the HTTP payload, saving 1 ConfidentialHTTP call vs WF-001.

```
WF-008: HTTP Prior Auth — Data Flow (HTTP Trigger)
══════════════════════════════════════════════════

TRIGGER: HTTPCapability — signed HTTP request from provider-adapter-api

 Step 0  ── [DECODE PAYLOAD] ──────────────────────── Parse HTTP payload bytes → JSON
            Extract: claim_id, payer_id, procedure_code, requested_amount,
                     consent_id, policy_hash, service_date
 Step 1  ── [EVMClient — READ] ────────────────────── ConsentRegistry.isConsentActive
 Step 2  ── [EVMClient — READ] ────────────────────── PolicyRegistry.isPolicyActive
 Step 3  ── [HTTPClient + DON Consensus] ──────────── GET /v1/policies/payer-demo-001/v1
 Step 4  ── [ConfidentialHTTPClient + AES-GCM] ────── POST /v1/proofs/medical-necessity
 Step 5  ── [EVMClient — WRITE] ───────────────────── ClaimDecisionRegistry.submitClaim
 Step 6  ── [EVMClient — WRITE] ───────────────────── ClaimDecisionRegistry.setProofResult
 Step 7  ── [EVMClient — WRITE] ───────────────────── ClaimEscrow.schedulePayout
 Step 8  ── [EVMClient — WRITE] ───────────────────── ClaimEscrow.releasePayout + markPaid
 Step 9  ── [ConfidentialHTTPClient + AES-GCM] ────── POST /v1/callbacks/prior-auth-decision

 DEMO: Provider submits prior auth via HTTP trigger → WF-008 fires immediately
       → consent + policy verified → proof passes → claim submitted + approved
       → payer coverage ($38,000) paid → APPROVED → PAID
```

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
│  WF-001           ──►  Provider Adapter       GET /v1/ehr/claims/outstanding │
│                        (:3005)               → patient, procedure, cost     │
│                                               [ENC] ConfidentialHTTPClient │
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
│                                               [ENC] ConfidentialHTTPClient │
│                                                                              │
│  WF-002           ──►  ConsentRegistry       callContract: isConsentActive  │
│                        (on-chain)            → bool (verify before revoke)  │
│                                                                              │
│  WF-002           ──►  ConsentRegistry       writeReport: revokeConsent     │
│                        (on-chain)            → ACTIVE → REVOKED             │
│                                                                              │
│  WF-002           ──►  ClaimDecisionRegistry callContract: getDecision      │
│                        (on-chain)            → affected claim state         │
│                                                                              │
│  WF-002           ──►  ClaimDecisionRegistry writeReport: challengeClaim    │
│                        (on-chain)            → APPROVED → CHALLENGED        │
│                                                                              │
│  WF-002           ──►  ClaimEscrow           writeReport: cancelPayout      │
│                        (on-chain)            → SCHEDULED → CANCELLED        │
│                                                                              │
│  WF-002           ──►  Callback Service      POST /v1/callbacks/consent-    │
│                        (:3006)               revoked → cascade result       │
│                                                                              │
│  WF-003           ──►  ClaimDecisionRegistry logTrigger: ProofEvaluated     │
│                        (on-chain)            → fires on approval events     │
│                                                                              │
│  WF-003           ──►  ClaimDecisionRegistry callContract: getDecision      │
│                        (on-chain)            → { state, proofHash, ... }    │
│                                                                              │
│  WF-003           ──►  ConsentRegistry       callContract: isConsentActive  │
│                        (on-chain)            → bool (post-approval check)   │
│                                                                              │
│  WF-003           ──►  Policy Service        GET /v1/policies/:payer/:ver   │
│                        (:3001)               → policy predicates [consensus]│
│                                                                              │
│  WF-003           ──►  Proof Service Stub    POST /v1/proofs/med-necessity  │
│                        (:3003)               → compliance re-eval [ENC]     │
│                                                                              │
│  WF-003           ──►  ClaimDecisionRegistry writeReport: challengeClaim    │
│                        (on-chain)            → auto-challenge if risk       │
│                                                                              │
│  WF-003           ──►  Callback Service      POST /v1/callbacks/challenge-  │
│                        (:3006)               resolved → compliance result   │
│                                                                              │
│  WF-004           ──►  Provider Adapter       GET /v1/ehr/claims?status=    │
│                        (:3005)               BILLED → outstanding claims   │
│                                               [ENC] ConfidentialHTTPClient │
│                                                                              │
│  WF-004           ──►  ClaimDecisionRegistry callContract: getDecision      │
│                        (on-chain)            → { state, updatedAt }         │
│                                                                              │
│  WF-004           ──►  ClaimEscrow           callContract: getPayout        │
│                        (on-chain)            → { status, amount }           │
│                                                                              │
│  WF-005           ──►  Credential Service   GET /v1/registry/providers     │
│                        (:3002)               → provider + org name [ENC]   │
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
│  WF-006           ──►  Provider Adapter      GET /v1/ehr/medications/       │
│                        (:3005)               pending-auth → medications     │
│                                               [ENC] ConfidentialHTTPClient │
│                                                                              │
│  WF-006           ──►  Policy Service        GET /v1/policies/:payer/:ver   │
│                        (:3001)               → formulary + caps             │
│                                                                              │
│  WF-006           ──►  Proof Service Stub    POST /v1/proofs/med-necessity  │
│                        (:3003)               → 8-predicate eval [ENC]       │
│                                                                              │
│  WF-006           ──►  ClaimDecisionRegistry writeReport: submit+approve    │
│                        (on-chain)            → full settlement pipeline     │
│                                                                              │
│  WF-006           ──►  ClaimEscrow           writeReport: payout pipeline   │
│                        (on-chain)            → schedule + release + markPaid│
│                                                                              │
│  WF-006           ──►  Callback Service      POST /v1/callbacks/prior-auth  │
│                        (:3006)               -decision → { status } [ENC]  │
│                                                                              │
│  WF-007           ──►  ClaimDecisionRegistry logTrigger: ClaimSubmitted     │
│                        (on-chain)            → fires on new claims          │
│                                                                              │
│  WF-007           ──►  Provider Adapter      GET /v1/ehr/claims/transfers/  │
│                        (:3005)               pending → transfer data [ENC] │
│                                                                              │
│  WF-007           ──►  Policy Service        GET /v1/policies/:payer/:ver   │
│                        (:3001)               → policy predicates            │
│                                                                              │
│  WF-007           ──►  Proof Service Stub    POST /v1/proofs/med-necessity  │
│                        (:3003)               → proof result [ENC]           │
│                                                                              │
│  WF-007           ──►  ClaimDecisionRegistry writeReport: approve+markPaid  │
│                        (on-chain)            → settle transfer claim        │
│                                                                              │
│  WF-007           ──►  ClaimEscrow           writeReport: payout pipeline   │
│                        (on-chain)            → schedule + release           │
│                                                                              │
│  WF-007           ──►  Callback Service      POST /v1/callbacks/prior-auth  │
│                        (:3006)               -decision → { status } [ENC]  │
│                                                                              │
│  WF-008           ──►  Policy Service        GET /v1/policies/:payer/:ver   │
│                        (:3001)               → policy predicates [consensus]│
│                                                                              │
│  WF-008           ──►  Proof Service Stub    POST /v1/proofs/med-necessity  │
│                        (:3003)               → proof result [ENC]           │
│                                                                              │
│  WF-008           ──►  ClaimDecisionRegistry writeReport: submit+approve    │
│                        (on-chain)            → full settlement pipeline     │
│                                                                              │
│  WF-008           ──►  ClaimEscrow           writeReport: payout pipeline   │
│                        (on-chain)            → schedule + release + markPaid│
│                                                                              │
│  WF-008           ──►  Callback Service      POST /v1/callbacks/prior-auth  │
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
 6    Medication not on formulary   medication not in formulary list (WF-006)
 7    Medication amount exceeds cap requested_amount > medication cap (WF-006)
```

A bitmap of `0` = all checks pass = `APPROVED`. A bitmap of `8` (bit 3 set) = consent invalid = `DENIED`.

---

## CRE Capability Usage Per Workflow

How many of each CRE capability type each workflow uses (and the CRE platform limits):

```
                    Trigger   HTTP    Confidential    EVM       EVM
                    Type     Client   HTTP [ENC]    READ     WRITE     Notes
                   ──────   ──────   ────────────  ──────   ──────    ─────
  WF-001           Cron       1          3           2        5       Full prior-auth pipeline
  WF-002           HTTP       0          2           2        0-3     Consent cascade (revoke+challenge+cancel)
  WF-003           Log        1          2           2        0-1     Automated compliance gate
  WF-004           Cron       0          1           1-2      0       EHR cross-check reconciliation
  WF-005           Cron       0          5           1        0       AES-GCM encryption showcase
  WF-006           Cron       1          3           2        5       Medication prior-auth pipeline
  WF-007           Log        1          3           2        4       Transfer claim settlement
  WF-008           HTTP       1          2           2        5       HTTP prior-auth (no EHR fetch)
                   ──────   ──────   ────────────  ──────   ──────
  Total per WF       ≤5         ≤5          ≤10      ≤10     All within CRE limits

  Trigger types: Cron (CronCapability), HTTP (HTTPCapability), Log (EVMClient.logTrigger)
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
make simulate-wf004    # EHR cross-check + EVM reads (needs services + Anvil)
make simulate-wf001    # full prior-auth flow (needs services + Anvil)
make simulate-wf002    # consent cascade via HTTP trigger
make simulate-wf003    # compliance gate (needs TX_HASH from on-chain event)
make simulate-wf005    # AES-GCM encryption showcase
make simulate-wf006    # medication prior-auth
make simulate-wf007    # transfer settlement (needs TX_HASH from submitClaim)
make simulate-wf008    # HTTP prior-auth via signed payload
make simulate          # run cron-triggered workflows sequentially

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
├── data/                        Synthetic healthcare data (Synthea CSV format)
│   └── synthea/                     10 CSV files: patients, encounters, procedures,
│       ├── patients.csv             conditions, claims, claims_transactions, payers,
│       ├── encounters.csv           payer_transitions, providers, organizations
│       ├── claims.csv               8 patients, 6 providers, 5 payers, 12 encounters,
│       ├── claims_transactions.csv  13 procedures, 12 claims — all interlinked via FKs
│       └── ...                      Loaded at startup by @proofpa/schemas
│
├── packages/                    Shared TypeScript packages (npm workspaces)
│   ├── schemas/                     Zod schemas, denial bitmap, computeClaimId,
│   │                                Synthea CSV loader (loadSyntheaData)
│   ├── eip712-types/                EIP-712 typed data for signed payloads
│   ├── observability/               Structured JSON logging + correlation IDs
│   └── sdk-client/                  Contract ABIs + API client functions
│
├── services/                    Backend Express services (ports 3001-3006)
│   ├── policy-service/              :3001 — GET /v1/policies + /v1/payers/*
│   ├── credential-service/          :3002 — POST /v1/credentials + /v1/registry/*
│   ├── proof-service-stub/          :3003 — POST /v1/proofs/medical-necessity
│   ├── consent-service/             :3004 — grant/revoke + GET revocations
│   ├── provider-adapter-api/        :3005 — POST /v1/prior-auth + /v1/ehr/*
│   └── decision-callback-service/   :3006 — decision/consent/challenge callbacks
│
├── ProofPACRE/                  CRE workflow project (bun, separate from npm)
│   ├── project.yaml                 CRE targets, RPCs, experimental chains (Anvil)
│   ├── secrets.yaml                 Vault secret → env var mappings
│   ├── .env                         Local simulation env vars
│   ├── wf-001-prior-auth-decision/  Cron trigger — full prior-auth pipeline
│   ├── wf-002-consent-revocation/   HTTP trigger — consent cascade
│   ├── wf-003-challenge-resolution/ Log trigger — automated compliance gate
│   ├── wf-004-reconciliation-monitor/ Cron trigger — EHR cross-check
│   ├── wf-005-encrypted-credential-audit/ Cron trigger — 5x AES-GCM encrypted calls
│   ├── wf-006-medication-payment-verification/ Cron trigger — pharmaceutical benefit
│   ├── wf-007-claim-transfer-settlement/ Log trigger — event-driven settlement
│   └── wf-008-http-prior-auth/      HTTP trigger — request-driven prior auth
│
├── apps/
│   └── demo-dashboard/          Next.js 16 + React 19 dashboard (:3000)
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
| 3001 | policy-service | `GET /v1/policies/:payerId/:version`, `GET /v1/payers`, `GET /v1/payers/:id`, `GET /v1/payers/:id/members`, `GET /v1/payer-transitions` | WF-001, WF-002, WF-005, Dashboard |
| 3002 | credential-service | `POST /v1/credentials/verify`, `GET /v1/registry/providers`, `GET /v1/registry/providers/:id`, `GET /v1/registry/organizations`, `GET /v1/registry/organizations/:id` | WF-005, Dashboard |
| 3003 | proof-service-stub | `POST /v1/proofs/medical-necessity` | WF-001, WF-005 |
| 3004 | consent-service | `POST /v1/consents/grant\|revoke`, `GET /v1/consents/revocations` | WF-002 |
| 3005 | provider-adapter-api | `POST /v1/prior-auth/submit`, `GET /v1/ehr/patients`, `GET /v1/ehr/encounters`, `GET /v1/ehr/procedures`, `GET /v1/ehr/conditions`, `GET /v1/ehr/claims`, `GET /v1/ehr/claims/outstanding` | Provider Portal, WF-001, WF-003, WF-004, Dashboard |
| 3006 | decision-callback-service | `POST /v1/callbacks/prior-auth-decision`, `POST /v1/callbacks/consent-revoked`, `GET /v1/callbacks/pending-challenges`, `POST /v1/callbacks/challenge-resolved` | WF-001, WF-002, WF-003, WF-005 |

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

## Synthetic EHR Data (Synthea Format)

The `data/synthea/` directory contains realistic synthetic healthcare data in [Synthea CSV format](https://github.com/synthetichealth/synthea/wiki/CSV-File-Data-Dictionary) — the same format used by professional EHR systems. All data is fictional (no real PHI).

| File | Records | Description |
|------|---------|-------------|
| `patients.csv` | 8 | Patient demographics, income, lifetime healthcare costs |
| `providers.csv` | 6 | Clinicians across 5 organizations |
| `organizations.csv` | 5 | Hospitals, specialty clinics, imaging centers |
| `payers.csv` | 5 | BlueCross PPO, Aetna HMO, Medicare, Medicaid CA, UnitedHealth |
| `encounters.csv` | 12 | Office visits, inpatient admissions, pre-op evaluations |
| `procedures.csv` | 13 | CABG, stent placement, MRI, biopsy, CT, echo, stress test |
| `claims.csv` | 12 | Insurance claims — 10 CLOSED + 2 BILLED with outstanding balances |
| `claims_transactions.csv` | 15 | CHARGE, PAYMENT, TRANSFERIN/OUT per claim line |

**Key demo claims (outstanding):**

| Patient | Procedure | Total Cost | Outstanding | ProofPA Mapping |
|---------|-----------|-----------|-------------|-----------------|
| Maria Garcia | Coronary stent ($38K) | $48,500 | $7,275 | WF-001 happy path → settled in <120s |
| William O'Brien | PCI ($52K) | $92,000 | $4,600 | Medicare prior auth → instant settlement |

These are served by the provider-adapter-api at `GET /v1/ehr/claims/outstanding` and fetched by WF-001, WF-003, and WF-004 via ConfidentialHTTPRequest. WF-002 fetches payer enrollment from the policy-service, and WF-005 fetches provider/org data from the credential-service.

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
make simulate-wf004      # simulate WF-004 (needs services + Anvil)
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
- **Deterministic claim ID** — `keccak256(payer_id | provider_id_hash | encounter_ref_hash | procedure_code | service_date)` ensures the same claim always gets the same ID. Duplicate submissions revert.
- **ZK deferred** — MVP uses signature-based verification (physician JWS attestation, payer policy hash signature, CRE decision report signature). ZK proof circuits are post-hackathon.
- **All 3 CRE capabilities** — HTTPClient for public consensus reads, ConfidentialHTTPClient for secret-injected enclave calls, EVMClient for on-chain contract interaction. This is the first project to use all three in a single healthcare workflow.
- **AES-GCM output encryption** — All 16 ConfidentialHTTPClient calls across WF-001/002/003/004/005 use `encryptOutput: true`, ensuring HTTP response payloads are AES-GCM encrypted end-to-end through the DON network. Every workflow now fetches Synthea data via encrypted calls: WF-001 fetches EHR claims, WF-002 fetches payer enrollment, WF-003 fetches EHR challenge context, WF-004 cross-checks outstanding claims, and WF-005 fetches provider registry data (5 encrypted calls, at CRE limit).
- **Synthea-format EHR data** — Realistic synthetic healthcare data (patients, encounters, procedures, claims, payers, providers) in [Synthea CSV format](https://github.com/synthetichealth/synthea/wiki/CSV-File-Data-Dictionary) is loaded at service startup and served via REST endpoints. CRE workflows fetch this data via ConfidentialHTTPRequest to cross-check against on-chain state, demonstrating how ProofPA integrates with existing EHR/billing systems.
- **CRE log privacy** — Workflow `runtime.log()` calls never emit PHI. Logs reference only claim/consent hashes, procedure codes (e.g., `PROC_KNEE_MRI`), predicate pass/fail counts, provider fixture IDs, and on-chain state names. Clinical narrative (patient names, diagnoses, dollar amounts) stays in the service responses — parsed for business logic but never echoed to DON logs.
- **Network**: Base Sepolia (with local Anvil for development via experimental-chains)
- **Token**: ERC-20 mock USDC (6 decimals)

### CRE SDK Feedback: Missing `ConfidentialHTTPSendRequester`

The Chainlink CRE workshop demonstrated a `ConfidentialHTTPSendRequester` callback pattern for confidential HTTP calls with explicit per-call DON consensus — analogous to the `SendRequester` + `consensusIdenticalAggregation` pattern available on `HTTPClient`. **This type does not exist in `@chainlink/cre-sdk` as of v1.1.4** (latest at time of writing, March 2026). The `ConfidentialHTTPClient` capability is still `confidential-http@1.0.0-alpha` and only exposes the direct `sendRequest(runtime, input)` API without a consensus aggregation overload.

**Current workaround**: Confidential HTTP calls get DON consensus at the **workflow level** — all DON nodes independently execute the handler, and the DON verifies identical workflow output. Per-call explicit consensus (as shown in the workshop) would allow finer-grained verification and is the pattern we'd like to adopt once the SDK ships it.

**What we'd use**: Every `ConfidentialHTTPClient.sendRequest()` call (16 across 5 workflows) would be wrapped in the callback+consensus pattern, giving judges a clear demonstration of DON consensus on each encrypted HTTP call — not just on the final workflow output.

| Component | Version | Status |
|---|---|---|
| CRE CLI | v1.3.0 | Updated |
| `@chainlink/cre-sdk` | v1.1.4 | Latest — `ConfidentialHTTPSendRequester` not yet available |
| `confidential-http` capability | `1.0.0-alpha` | Alpha — direct API only, no callback+consensus overload |
| `http-actions` capability | `1.0.0-alpha` | Has `SendRequester` + `consensusIdenticalAggregation` (used in WF-001) |

See `docs/MVP_DECISIONS.md` for the full list of frozen architecture decisions.
