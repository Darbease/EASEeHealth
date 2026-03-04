# ProofPA

Privacy-preserving prior authorization and claim payout using Chainlink CRE, signed attestations, and onchain settlement.

## Current Status
- PRD completed: `PRD_ProofPA.md`
- Technical architecture spec completed: `TECH_ARCHITECTURE_SPEC_ProofPA.md`
- MVP trust model: signature-first with CRE orchestration and confidential data fetches

## Repository Structure
- `apps/`: UI clients for provider, payer ops, and patient consent
- `services/`: offchain APIs and decisioning dependencies
- `workflows/cre/`: CRE workflow definitions and runtime configs
- `contracts/`: Solidity contracts, scripts, and tests
- `packages/`: shared schemas, typed data, SDK, and observability utilities
- `infra/`: local/deploy/runtime environment configuration
- `tests/`: integration and end-to-end scenarios
- `docs/`: architecture docs, wiremaps, and decision records

## MVP Build Sequence
1. Finalize signed payload schemas and replay protection rules.
2. Implement contract state machine and role-based controls.
3. Build API stubs and CRE workflows for prior auth decisioning.
4. Run three demo paths: approve and pay, deny, challenge and block payout.

## Next Immediate Step
Read `docs/MVP_DECISIONS.md` and confirm any changes before implementation starts.
