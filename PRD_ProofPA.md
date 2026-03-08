# Product Requirements Document (PRD)

## Product
- Name: ProofPA (working title)
- Tagline: Privacy-preserving prior authorization and claim payout using cryptographic proof
- Version: v0.1 (Hackathon + MVP)
- Date: March 3, 2026

## 1. Executive Summary
ProofPA is a healthcare insurance protocol that allows payers to approve and fund care based on proof of medical necessity and policy compliance, without exposing unrelated patient data. The system combines verifiable credentials, selective disclosure, zero-knowledge proofs, and onchain settlement orchestration.

The initial product wedge is prior authorization and pre-approval payout, not full claims replacement. Chainlink Runtime Environment (CRE) is the orchestration backbone connecting provider systems, policy checks, proof services, and onchain settlement.

## 2. Problem Statement
Current healthcare claims and prior authorization flows expose more patient data than necessary to determine coverage eligibility. This creates three major issues:
- Privacy risk: insurers often receive broad records rather than minimum-required evidence.
- Operational friction: approvals are slow and inconsistent due to manual document review.
- Trust gap: providers and patients cannot easily verify fair policy enforcement.

### Core problem to solve
How can a payer release funds when they only see a cryptographic proof that required conditions are met, instead of full patient records?

## 3. Product Vision
Enable minimum-necessary, machine-verifiable adjudication for healthcare insurance decisions:
- Patients share less data.
- Providers get faster approvals and payout confidence.
- Payers retain auditability, fraud controls, and policy enforcement.

## 4. Goals and Non-Goals
### Goals (MVP)
- Prove medical-necessity and coverage predicates without exposing full patient history.
- Automate prior-auth decisioning with deterministic policy rules.
- Release testnet funds through onchain escrow when proof verification passes.
- Provide immutable audit trail of decision state transitions.
- Demonstrate end-to-end workflow in 3-5 minutes.

### Non-Goals (MVP)
- Replacing all payer adjudication workflows.
- Storing PHI onchain.
- Supporting all procedure categories and all payer policy formats.
- Full legal/regulatory deployment readiness.
- Production-grade integration with live insurer core systems.

## 5. Target Users and Stakeholders
### Primary users
- Physician office / care coordinator: submits necessity attestation and prior-auth request.
- Payer operations analyst: monitors proof-based decisions and exception queue.
- Provider revenue-cycle team: receives funding decision and payout status.

### Secondary users
- Patient: grants consent and can view high-level decision trace.
- Compliance/audit teams: review immutable logs and challenge records.

### Stakeholders
- Health systems and provider groups
- Payers / TPAs
- Supplemental care funds / risk pools
- Regulators and auditors (future phase)

## 6. User Needs
- Providers need rapid approvals without sending unnecessary chart data.
- Payers need deterministic policy checks and anti-fraud guardrails.
- Patients need selective disclosure and transparency into how decisions were made.
- Auditors need tamper-evident evidence trails and controlled exception paths.

## 7. Scope
### In-scope (MVP)
- Prior authorization request flow (limited procedure set).
- Physician signed attestation input.
- Policy compliance checks against machine-readable rules.
- ZK proof generation and verification for required predicates.
- Onchain decision state + escrow payout on success.
- Revocation/challenge flow with manual exception status.

### Out-of-scope (MVP)
- Complex post-adjudication appeals lifecycle.
- Full EHR interoperability across multiple vendors.
- Fiat rails and real insurer payment rails.
- Diagnosis coding optimization and NLP extraction.

## 8. Product Requirements
## 8.1 Functional Requirements
1. Consent registration:
- System records patient consent reference and scope hash.
- Consent status can be ACTIVE, REVOKED, EXPIRED.

2. Provider attestation intake:
- Accept signed physician attestation for procedure necessity.
- Validate provider credential status before acceptance.

3. Policy rule evaluation:
- Pull policy version and required predicates (in-network, coverage, necessity threshold, time validity).
- Produce deterministic pass/fail evaluation input for prover.

4. Zero-knowledge proof path:
- Generate proof that required predicates evaluate true.
- Verify proof in a verifiable service path and anchor result hash onchain.

5. Decision and payout:
- If proof passes and no blocking flags exist, set decision APPROVED.
- Trigger escrow release of testnet stablecoin to provider wallet.
- If proof fails, set decision DENIED with standardized reason code.

6. Exception/challenge window:
- Payer can place decision into CHALLENGED during configured window.
- Challenge creates audit entry and blocks payout finalization if pending.

7. Audit trail:
- Every state transition emits an immutable event with timestamp, claim ID hash, policy version hash, and actor role.

8. Medication payment verification:
- System fetches medications pending prior authorization from EHR data (cost > $100, active prescription).
- Verify patient consent and policy status on-chain before evaluation.
- Check medication against payer formulary (covered medication list) and per-medication cost caps.
- If formulary check passes and all existing predicates pass, approve claim and release payer coverage amount via escrow.
- Denial bitmap extended with bits 6 (medication not on formulary) and 7 (medication amount exceeds cap).

## 8.2 Non-Functional Requirements
- Privacy:
  - No PHI onchain.
  - Use hashed identifiers and scoped commitments only.
- Performance:
  - End-to-end decision in <= 2 minutes for demo payloads.
- Reliability:
  - Retry policy for API failures and proof-service timeouts.
- Security:
  - Role-based authorization for updater services.
  - Signature verification for attestations and system callbacks.
- Observability:
  - Workflow logs include correlation IDs across offchain and onchain components.

## 9. System Architecture (High-Level)
### Offchain components
- Provider API Adapter (FHIR-like payload intake, mock for MVP)
- Credential/Attestation Service (issues signed provider necessity attestations)
- Policy Service (versioned machine-readable coverage rules)
- ZK Prover Service (proof generation)
- Chainlink CRE workflows (orchestration)
- Payer Ops Console (monitoring and exceptions)

### Onchain components
- ConsentRegistry
- PolicyRegistry (policy version hashes)
- ClaimDecisionRegistry
- ClaimEscrow
- ProofVerifier adapter contract (or anchored verification result bridge)

### Data handling model
- Raw medical data remains offchain.
- Only hashes, proofs, decision states, and policy references are stored onchain.

## 10. CRE Workflow Requirements
1. Prior-auth submission workflow:
- Trigger: HTTP request from provider adapter
- Steps:
  - validate request schema/signatures
  - fetch consent and policy metadata
  - fetch provider credential status
  - invoke prover service
  - verify proof result
  - write decision onchain
  - release escrow if approved
  - send callback to provider system

2. Consent revocation workflow:
- Trigger: HTTP consent revoke event
- Steps:
  - validate event
  - update consent status onchain
  - block pending requests linked to consent scope as needed

3. Monitoring workflow:
- Trigger: scheduled
- Steps:
  - reconcile workflow IDs, tx hashes, and payout statuses
  - flag stuck decisions to ops console

## 11. Smart Contract Requirements (MVP)
### ConsentRegistry
- Upsert consent scope hash and status
- Revoke consent
- Query active status

### ClaimDecisionRegistry
- Create/update claim decision state
- Store reason codes and policy hash
- Emit events for every transition

### ClaimEscrow
- Hold pool funds
- Release payout on APPROVED state
- Block release during CHALLENGED state

### Access Control
- Only authorized workflow signer/service can mutate claim state.
- Admin role can update policy references and challenge params.

## 12. Decision State Machine
- Submitted -> ProofPending -> Approved -> Paid
- Submitted -> ProofPending -> Denied
- Approved -> Challenged -> Approved or Denied

State transitions must be explicit and evented.

## 13. Policy and Proof Model (MVP)
For each request, proof must attest that:
- provider credential is valid at request time
- policy version supports requested procedure class
- request amount <= policy cap for class
- consent is active and scope-compatible
- no duplicate approved claim exists for same encounter key

Output:
- boolean result
- reason code set (if false)
- proof artifact reference hash

## 14. Compliance and Risk Controls
- PHI minimization by design.
- Role separation:
  - provider attestation issuer
  - payer challenge authority
  - workflow executor
- Randomized audit mode:
  - select subset of approved claims for deeper disclosure review.
- Fraud controls:
  - duplicate detection
  - outlier amount flags
  - credential revocation checks

## 15. UX Requirements (MVP)
- Provider portal flow:
  - submit request in < 5 form steps
  - receive decision and payout status
- Payer console:
  - view queue by state
  - open challenge action with reason code
- Patient consent view:
  - active scopes
  - revocation action
  - decision trace summary (non-clinical)

## 16. Success Metrics
### Hackathon metrics
- 100% successful demo flows across two scenarios:
  - valid proof -> payout
  - invalid proof -> denial
- end-to-end runtime <= 2 minutes per request
- 0 PHI fields written onchain

### Product metrics (post-MVP)
- prior-auth cycle time reduction (%)
- provider resubmission rate reduction (%)
- denial-overturn rate tracking
- privacy leakage incidents (target: 0)

## 17. Milestones
### Milestone 1: Core protocol skeleton
- contract deployment
- CRE workflow scaffold
- mock API endpoints

### Milestone 2: Proof + policy integration
- predicate compiler and prover integration
- deterministic reason codes

### Milestone 3: End-to-end payout demo
- escrow release path
- challenge path
- observability and logs

### Milestone 4: Submission readiness
- 3-5 minute demo video
- architecture diagram
- reproducible runbook

## 18. Open Questions
- Which proof system and circuit complexity are feasible within hackathon time?
- Should proof verification happen directly onchain or offchain with anchored attestations?
- What minimum policy vocabulary is needed for credible prior-auth logic?
- What challenge-window duration balances payout speed vs risk?
- Which stablecoin and testnet combination offers best demo reliability?

## 19. Risks and Mitigations
- Risk: Proof pipeline latency too high.
  - Mitigation: limit predicates and precompute where possible.

- Risk: Policy logic ambiguity.
  - Mitigation: start with narrow procedure classes and explicit deterministic rules.

- Risk: Fraud via colluding attestations.
  - Mitigation: challenge window, anomaly detection, and selective audits.

- Risk: Integration brittleness.
  - Mitigation: stable mock adapters + fallback fixtures for live demo.

## 20. MVP Acceptance Criteria
1. A provider can submit a request with signed attestation and active consent.
2. System generates and verifies proof for defined policy predicates.
3. Approved request updates onchain state and triggers escrow payout.
4. Denied request returns machine-readable reason codes.
5. Consent revocation blocks new approval attempts for revoked scope.
6. Full audit trail can be exported from logs + onchain events.
7. A medication prescription triggers formulary verification and payer coverage payout when approved.

## 21. Future Roadmap (Post-Hackathon)
- Expand from prior-auth to post-procedure claims settlement.
- Add selective disclosure standards support for credential transport.
- Add multi-payer policy packs and network-level interoperability.
- Introduce risk tranches and liquidity provider underwriting models.
- Integrate formal compliance reporting workflows.

## 22. Demo Narrative (Submission-Ready)
1. Patient grants consent for defined data scope.
2. Provider submits prior-auth request with physician attestation.
3. CRE orchestrates policy lookup, credential checks, proof path, and onchain decision.
4. Approved claim pays out from escrow.
5. Second request fails proof and is denied without exposing full chart data.
6. Patient is prescribed a medication. CRE fetches the pending prescription, verifies formulary coverage and cost caps, and pays out the payer-covered amount through escrow — no PHI touches the chain.

This demonstrates privacy-preserving adjudication with verifiable automation.
