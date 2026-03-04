# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Status

ProofPA is in the **architecture-locked, pre-implementation phase** (locked March 4, 2026). No production code exists yet — only documentation and directory scaffolding. Implementation follows the backlog in `TECH_ARCHITECTURE_SPEC_ProofPA.md` § 14. Before implementing anything, read `docs/MVP_DECISIONS.md`. Any deviation from locked decisions requires updating that file with date and rationale.

## Build Commands

No build scripts exist yet. When scaffolding them, the expected stack is:
- **Contracts**: Hardhat or Foundry (`npx hardhat compile` / `forge build`)
- **Services/apps**: TypeScript with Node.js (`tsc`, `ts-node`)
- **Tests**: Hardhat/Foundry for contracts; integration tests under `tests/`

## Architecture Overview

The system connects three portals → six backend services → Chainlink CRE workflows → four Solidity contracts on Base Sepolia.

**Critical data flow (WF-001 happy path):**
Provider Portal → `POST /v1/prior-auth/submit` → CRE WF-001 → [ConsentRegistry check] → [Policy Service] → [Proof Service stub] → `ClaimDecisionRegistry.submitClaim()` + `setProofResult()` → `ClaimEscrow.schedulePayout()` + `releasePayout()` → callback to provider

**Deterministic ID — never recompute differently:**
```
claim_id = keccak256(payer_id | provider_id_hash | encounter_ref_hash | procedure_bucket | service_date)
```

**State machine — only these transitions are valid:**
```
SUBMITTED → PROOF_PENDING → APPROVED → PAID
SUBMITTED → PROOF_PENDING → DENIED
APPROVED → CHALLENGED → APPROVED | DENIED
```
`PAID` can only follow `APPROVED`. `CHALLENGED` blocks payout. Duplicate `submitClaim` for same `claim_id` must revert.

## Smart Contracts (`contracts/src/`)

Four contracts, all using OpenZeppelin role-based access. Roles: `WORKFLOW_ROLE` (CRE signer), `POLICY_ADMIN_ROLE`, `CHALLENGE_ROLE`, `TREASURY_ROLE`.

| Contract | Responsibility |
|---|---|
| `ConsentRegistry` | Consent lifecycle (ACTIVE/REVOKED/EXPIRED), `upsertConsent`, `revokeConsent`, `isConsentActive` |
| `PolicyRegistry` | Policy version hashes, `setPolicyVersion`, `isPolicyActive` |
| `ClaimDecisionRegistry` | State machine, `submitClaim`, `setProofResult`, `challengeClaim`, `resolveChallenge`, `markPaid` |
| `ClaimEscrow` | ERC-20 mock USDC pool, `schedulePayout`, `releasePayout`, `cancelPayout` |

See `TECH_ARCHITECTURE_SPEC_ProofPA.md` §§ 5.2–5.5 for full method signatures and events.

## Services (`services/`)

| Service | Key endpoint |
|---|---|
| `provider-adapter-api` | `POST /v1/prior-auth/submit` — triggers WF-001 |
| `consent-service` | `POST /v1/consents/grant|revoke` — triggers WF-002 |
| `policy-service` | `GET /v1/policies/{payer_id}/{policy_version}` |
| `proof-service-stub` | `POST /v1/proofs/medical-necessity` — returns `proof_hash`, `result`, `reason_bitmap` |
| `credential-service` | Provider credential validation |
| `decision-callback-service` | Webhook delivery for state transitions |

All signed payloads use **EIP-712 typed data**. All requests carry anti-replay fields (`nonce`, `issued_at`, `expires_at`) and a `correlation_id` that must be propagated end-to-end.

## CRE Workflows (`workflows/cre/`)

- **WF-001** `PriorAuthDecision` — HTTP trigger; orchestrates the full approval-to-payout path
- **WF-002** `ConsentRevocation` — HTTP trigger; revokes consent and flags pending claims
- **WF-003** `ChallengeResolution` — HTTP trigger; blocks payout until ops resolves
- **WF-004** `ReconciliationMonitor` — scheduled every 15 min; detects stuck `PROOF_PENDING` or state mismatches

Transient failures retry with exponential backoff (max 3). Proof timeouts set state to `PROOF_PENDING` and hand off to WF-004.

## Privacy Constraints (Non-Negotiable)

- **No PHI onchain** — only hashes, commitments, state, policy refs, and payout events
- Sensitive API calls must use CRE confidential HTTP
- Schema linting must reject any payload with PHI fields outside the allowlist
- Proof witness metadata stored offchain only, never in logs

## Denial Reason Bitmap

| Bit | Meaning |
|---|---|
| 0 | Provider credential invalid |
| 1 | Procedure not covered |
| 2 | Amount exceeds cap |
| 3 | Consent invalid/revoked |
| 4 | Duplicate/nullifier collision |
| 5 | Stale attestation |

## Demo Scenarios (Acceptance Criteria)

- **Scenario A**: valid attestation + proof → `APPROVED` → `PAID`
- **Scenario B**: revoked consent or invalid signature → `DENIED` (bit 3 set for consent)
- **Scenario C**: challenge action → payout blocked until manual resolution

## Observability

Every service event must be structured JSON with: `timestamp`, `correlation_id`, `claim_id`, `workflow_id`, `stage`, `status`, `metadata`. See `TECH_ARCHITECTURE_SPEC_ProofPA.md` § 16 for the canonical event schema.

SLO targets: p95 decision latency ≤ 120s, payout success ≥ 99%, zero unresolved `PROOF_PENDING` after 15 min.

## Deploy Order

1. Deploy 4 contracts; grant roles to CRE signer and ops addresses
2. Seed policy versions and verifier key hashes in `PolicyRegistry`
3. Launch services (Provider Adapter, Policy, Proof)
4. Activate CRE workflows and WF-004 schedule

Network: **Base Sepolia**. Settlement token: ERC-20 mock USDC (6 decimals).

## ZK Status

ZK proof circuits and onchain verifier are **deferred post-hackathon**. The MVP uses signature-based verification: physician attestation (JWS), payer policy hash signature, CRE decision report signature. The `proof-service-stub` implements a non-ZK attested verification path.
