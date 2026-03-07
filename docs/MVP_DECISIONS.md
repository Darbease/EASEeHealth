# ProofPA MVP Decisions (Step 1 Lock)

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
  - `ConsentRegistry`
  - `PolicyRegistry`
  - `ClaimDecisionRegistry`
  - `ClaimEscrow`
- Access control: role-based (`WORKFLOW_ROLE`, `POLICY_ADMIN_ROLE`, `CHALLENGE_ROLE`, `TREASURY_ROLE`)

## 5. Decision State Machine
- Allowed state paths:
  - `SUBMITTED -> PROOF_PENDING -> APPROVED -> PAID`
  - `SUBMITTED -> PROOF_PENDING -> DENIED`
  - `APPROVED -> CHALLENGED -> APPROVED|DENIED`
- Payout cannot execute while claim is `CHALLENGED`

## 6. Workflow Set
- `WF-001`: Prior auth decision and payout
- `WF-002`: Consent revocation
- `WF-003`: Challenge resolution
- `WF-004`: Reconciliation monitor

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
- Scenario B: revoked consent or invalid signature -> denied
- Scenario C: challenge action -> payout blocked until resolution

## 9. Explicit Deferrals
- Full ZK circuit generation and onchain verifier integration
- Live payer core system integration
- Fiat payment rails

## 10. AES-GCM Output Encryption (added 2026-03-05)
- **Decision**: Enable `encryptOutput: true` on all ConfidentialHTTPClient calls across WF-001, WF-002, WF-003
- **Rationale**: CRE DON nodes relay HTTP responses through the network in cleartext by default. Enabling AES-GCM output encryption (via `san_marino_aes_gcm_encryption_key` secret already provisioned in secrets.yaml) ensures response payloads containing sensitive claim/policy data are encrypted end-to-end. This is a zero-cost privacy improvement — the SDK auto-decrypts on the workflow side.
- **Scope**: 6 existing ConfidentialHTTPClient call sites + new WF-005 (4 additional encrypted calls)
- **New workflow**: `WF-005-EncryptedCredentialAudit` — dedicated showcase workflow demonstrating 4 encrypted HTTP calls + 1 on-chain consent read for a full credential audit cycle

## 11. Change Policy
Any change to these decisions requires an explicit update to this file with date and rationale.
