# EASE eHealth MVP Decisions (Step 1 Lock)

Date locked: March 4, 2026
Owner: Product and Engineering

This document freezes the MVP architecture choices so implementation can start without churn.

## 1. Network and Settlement
- Execution network: Base Sepolia (default)
- Settlement asset: ERC-20 mock USDC (`6` decimals)
- Finality assumption: testnet confirmations suitable for demo only

## 2. Verification Trust Model
- Primary model: signature-based verification + CRE-orchestrated decisioning
- Signers in trust boundary:
  - physician attestation issuer
  - payer policy signer
  - CRE workflow signer (decision report)
- ZK status: deferred from MVP, reserved as a post-hackathon upgrade path

## 3. Privacy and Data Handling
- No PHI onchain
- Onchain data limited to:
  - hashes/commitments
  - claim state transitions
  - policy hash/version
  - payout and challenge events
- Sensitive API access should be performed using CRE confidential capabilities when possible

## 4. Contract Pattern
- Contracts in MVP:
  - `MockUSDC` (ERC-20 settlement token)
  - `ConsentRegistry`
  - `PolicyRegistry`
  - `ClaimDecisionRegistry`
  - `ClaimEscrow`
- Access control: role-based (`WORKFLOW_ROLE`, `POLICY_ADMIN_ROLE`, `CHALLENGE_ROLE`, `TREASURY_ROLE`)

## 5. Decision State Machine
- Allowed state paths:
  - `SUBMITTED -> APPROVED -> PAID`
  - `SUBMITTED -> DENIED`
  - `APPROVED -> CHALLENGED -> APPROVED|DENIED`
- Payout cannot execute while claim is `CHALLENGED`

## 6. Workflow Set
- `WF-001`: Prior auth decision and payout
- `WF-002`: Consent revocation (HTTP trigger — consent cascade, updated 2026-03-08)
- `WF-003`: Challenge resolution (log trigger — automated compliance gate, updated 2026-03-08)
- `WF-004`: Reconciliation monitor
- `WF-005`: Encrypted credential audit (AES-GCM showcase, added 2026-03-05)
- `WF-006`: Medication payment verification (pharmaceutical benefit check, added 2026-03-08)
- `WF-007`: Claim transfer settlement (log trigger — event-driven, added 2026-03-08)
- `WF-008`: HTTP prior auth (HTTP trigger — request-driven, added 2026-03-08)

## 7. API Contract Standards
- Signed payload format: EIP-712 typed data where applicable
- Required anti-replay fields:
  - nonce
  - issued_at
  - expires_at
- Required tracing field:
  - `correlation_id` propagated across all services/workflows

## 8. Demo Acceptance Paths
- Scenario A: valid submission -> approved -> payout released
- Scenario B: HTTP trigger -> consent revoked on-chain -> cascade challenges affected claims + cancels payouts
- Scenario C: ProofEvaluated log trigger -> automated compliance check -> auto-challenge if risk detected -> payout blocked
- Scenario D: medication prior auth -> formulary check -> approved -> payer coverage paid out
- Scenario E: transfer claim submitted on-chain -> log trigger fires WF-007 -> TRANSFERIN settled -> payer coverage paid out
- Scenario F: HTTP trigger -> WF-008 fires immediately with full payload -> consent + policy verified -> proof passes -> APPROVED -> PAID

## 9. Explicit Deferrals
- Full ZK circuit generation and onchain verifier integration
- Live payer core system integration
- Fiat payment rails

## 10. AES-GCM Output Encryption (added 2026-03-05)
- **Decision**: Enable `encryptOutput: true` on all ConfidentialHTTPClient calls across WF-001, WF-002, WF-003, WF-005
- **Rationale**: CRE DON nodes relay HTTP responses through the network in cleartext by default. Enabling AES-GCM output encryption (via `san_marino_aes_gcm_encryption_key` secret already provisioned in secrets.yaml) ensures response payloads containing sensitive claim/policy data are encrypted end-to-end. This is a zero-cost privacy improvement — the SDK auto-decrypts on the workflow side.
- **Scope**: 6 existing ConfidentialHTTPClient call sites + new WF-005 (4 additional encrypted calls)
- **New workflow**: `WF-005-EncryptedCredentialAudit` — dedicated showcase workflow demonstrating 4 encrypted HTTP calls + 1 on-chain consent read for a full credential audit cycle

## 12. Medication Payment Verification (added 2026-03-08)
- **Decision**: Add WF-006 to demonstrate pharmaceutical benefit prior authorization using existing contracts
- **Rationale**: Extends the prior-auth model from procedures to medications, proving the contract architecture generalizes. Adds formulary coverage checks (denial bitmap bits 6-7), a `medications.csv` Synthea dataset, and two new service endpoints (`/v1/ehr/medications`, `/v1/ehr/medications/pending-auth`)
- **Scope**: 1 new CRE workflow, 1 new data file, extensions to proof-service predicate evaluator, policy-service formulary data, and provider-adapter-api medication endpoints. Zero contract changes.
- **Demo path**: Maria Garcia prescribed Clopidogrel 75mg ($280.00) for MI -> BlueCross PPO formulary covers it -> payer pays $238.00 via ClaimEscrow -> APPROVED -> PAID

## 13. Log Trigger Workflow (added 2026-03-08)
- **Decision**: Add WF-007 as the first event-driven workflow using `EVMClient.logTrigger()` instead of `CronCapability`
- **Rationale**: Demonstrates reactive CRE capability — workflow fires when `ClaimSubmitted(bytes32 indexed claimId, bytes32 policyHash)` is emitted on-chain, rather than polling on a cron schedule. Uses TRANSFERIN claim transaction data for high-value inter-department transfers. No contract changes needed (`ClaimSubmitted` event already exists). Skips `submitClaim` call since the claim is already SUBMITTED (that's what triggered the workflow).
- **Scope**: 1 new CRE workflow, 1 new service endpoint (`/v1/ehr/claims/transfers/pending`), 1 new CSV row, Makefile targets for log-trigger simulation (`--evm-tx-hash` / `--evm-event-index`). Zero contract changes.
- **Demo path**: `cast send submitClaim(0x07..07, 0xa1..a1)` → ClaimSubmitted event → WF-007 fires → consent + policy verified → proof passes → payer coverage ($32,300) paid via ClaimEscrow → APPROVED → PAID

## 15. WF-002/WF-003 Trigger Upgrades (updated 2026-03-08)
- **Decision**: Convert WF-002 from Cron to HTTP trigger; convert WF-003 from Cron to Log trigger
- **WF-002 rationale**: Consent revocation is patient-initiated — a discrete event, not something to batch-discover every 30s. HTTP trigger fires immediately when the patient portal sends a signed revocation request. Now implements a consent cascade: revoke on-chain → check affected claims → challenge APPROVED claims → cancel scheduled payouts. Cross-contract fan-out across ConsentRegistry + ClaimDecisionRegistry + ClaimEscrow.
- **WF-003 rationale**: Challenges should be reactive, not polled. WF-003 now fires on `ProofEvaluated(bytes32 indexed claimId, bytes32 proofHash, bool approved, uint256 reasonBitmap)` events. When a claim is approved, WF-003 runs automated compliance checks (re-evaluates against policy predicates, verifies consent still active) and auto-challenges if risk is detected. This makes CRE an autonomous on-chain compliance gate.
- **Scope**: 2 workflow rewrites, config changes (removed `schedule`, added trigger-specific fields), Makefile target updates. Zero contract changes, zero service changes.

## 16. HTTP Trigger Workflow (added 2026-03-08)
- **Decision**: Add WF-008 as the first HTTP-triggered workflow using `HTTPCapability` instead of `CronCapability`
- **Rationale**: Completes the three-trigger architecture (HTTP request-driven, Log event-driven, Cron time-driven). Provider-adapter-api signs a request and sends it directly to the CRE gateway — the workflow fires immediately with the full submission payload, eliminating the cron polling delay. All claim data comes from the HTTP payload, saving 1 ConfidentialHTTP call vs WF-001. No contract changes needed.
- **Scope**: 1 new CRE workflow, Makefile targets for HTTP trigger simulation (`--http-payload`). Zero contract changes, zero service changes.
- **Demo path**: Provider submits prior auth via HTTP trigger -> WF-008 fires immediately -> consent + policy verified -> proof passes -> claim submitted + approved -> payer coverage ($38,000) paid via ClaimEscrow -> APPROVED -> PAID

## 17. Change Policy
Any change to these decisions requires an explicit update to this file with date and rationale.
