# EASE eHealth × Chainlink Confidential AI Attester — Implementation Plan

**Status:** Planning complete, awaiting go-ahead · **Date:** 2026-06-20
**Companion to:** the integration handoff (Attester source: `smartcontractkit/chainlink-confidential-ai-attester-demo`)
**Scope chosen:** Full arc — **Phase 1** (sync adapter + real `proofHash`) → **Phase 2** (native callback, PHI never touches the DON) → **Phase 3** (on-chain enforcement).

---

## 1. Context — why this change

EASE eHealth (ProofPA) already has a perfectly-shaped, currently-hollow socket for a TEE-attested AI judgment. Six of eight CRE workflows call one Confidential-HTTP endpoint — `POST /v1/proofs/medical-necessity` — and write the result on-chain via `ClaimDecisionRegistry.setProofResult(claimId, proofHash, reasonBitmap, approved)`. Today that endpoint is a **deterministic stub** that reads no clinical content, the `proofHash` written on-chain is a **hardcoded fixture** (`0xb2…b2`), the real hash the service returns is **discarded**, and the physician's necessity attestation (`attestation_jws`) is **never verified**.

The Confidential AI Attester drops into exactly that seat: an LLM running **inside a TEE** that actually reasons over an unstructured clinical document, returns the same structured verdict EASE eHealth already consumes, and signs a **response digest** that becomes the on-chain `proofHash` — turning a self-asserted hash into tamper-evident provenance. Intended outcome: the project's "clinical reviewer = proof-service" trust-equivalence claim becomes *real* (genuine AI reasoning, in an enclave, provable on-chain), and — in Phase 3 — money becomes provably gated on that attested verdict.

## 2. Verification summary — the handoff doc checks out

Four read-only agents verified ~15 load-bearing claims against current `HEAD`. **Every structural claim CONFIRMED**, line numbers barely drifted. Corrections to carry forward:

| # | Doc said | Reality | Impact |
|---|---|---|---|
| C1 | `ProofRequest` has `verifier_key_hash` | It does **not** — that field lives on `ProofBundle` (`packages/schemas/src/claim.ts:85`) and as `verifierKeyHash` on `PolicyRegistry.PolicyVersion` (`contracts/src/PolicyRegistry.sol:13`) | TEE-key anchor goes in **PolicyRegistry**, not the proof request (Phase 3) |
| C2 | Stub checks 2 predicates | It evaluates **6–8** (`predicate-evaluator.ts`); bits 0/3/4/5 are fed **hardcoded literals** at the WF call site (`wf-001 main.ts:325-328`); no diagnosis field exists anywhere | LLM's job is to make bits **data-driven** + add necessity, not invent them |
| C3 | `proofServiceUrl` in `project.yaml` | It's in per-workflow `config.staging.json` (`http://localhost:3003`), ×6 workflows | Swap point is the per-WF config |
| C4 | Uniform `WORKFLOW_ROLE` | `challengeClaim`→`CHALLENGE_ROLE`; `PolicyRegistry`→`POLICY_ADMIN_ROLE`; `MockUSDC`→public mint | Seeding `verifierKeyHash` needs `POLICY_ADMIN_ROLE` (deploy-time) |
| C5 | (not mentioned) | `decision-callback-service` exists but is an inbound **logging** sink — can't write on-chain or trigger workflows | Phase 2 needs a **new HTTP-trigger workflow** + a relay |
| C6 | (not mentioned) | EIP-712 domain `chainId` is hardcoded **84532 (Base Sepolia)**; runtime is Anvil 31337 / Eth Sepolia 11155111 | Reconcile before wiring EIP-712 verify (Phase 3) |

**Confirmed verbatim:** the seam + secrets + `encryptOutput`; the `0xb2…b2` fixture written while the returned `proof_hash` is discarded (workflow only reads `.result`/`.reason_bitmap`); the 9-step settlement sequence; `setProofResult(bytes32,bytes32,uint256,bool)` gated by `WORKFLOW_ROLE`; `State.APPROVED == 3`; `ClaimEscrow.releasePayout` checks **only** `status == SCHEDULED` and holds zero reference to the decision registry; `verifierKeyHash` stored/emitted/returned but consumed by no logic; the entire EIP-712 layer (5 types + `sign`/`verify`) defined and used nowhere; data is all coded Synthea CSV with **no unstructured document**; and both pre-existing bugs (`challengeClaim(bytes32,uint16)` vs the workflow's `string` encoding; WF-004's `getDecision` tuple swapping `state`↔`policyHash`).

## 3. Target architecture

One paragraph: the swap point is the single URL behind `proofServiceUrl`. Because sync-vs-async for the Attester is **open**, Phase 1 puts an **await-the-result adapter** behind that URL (works whether the Attester blocks or calls back) and starts writing the **real signed digest** as `proofHash`. Phase 2 moves to the Attester's **native callback** so the document goes provider → TEE and never touches the DON. Phase 3 makes the attestation **load-bearing on-chain** (payout gated on APPROVED + TEE key anchored in policy + attester signature verified).

```
PHASE 1 (sync adapter, minimal surgery):
  WF-001 cron ──Confidential HTTP──► [attester-proof-adapter]  (NEW, behind proofServiceUrl)
                                        ├─ resolve synthetic necessity letter for claim
                                        ├─ POST Attester /v1/inference (doc + policy prompt)
                                        ├─ await verdict (hides sync/async)
                                        └─ return {result, reason_bitmap,
                                                   proof_hash = response_digest,        ◄── real provenance
                                                   public_inputs_hash = request_digest,
                                                   clinical_context}
  WF-001 then writes setProofResult(claimId, proof_hash, …)  ◄── EDIT: use returned hash, not 0xb2…b2

PHASE 2 (native callback, best PHI posture):
  provider-adapter-api ──upload doc──► Attester TEE ──signed verdict(cre_callback)──►
     decision-callback-service /v1/callbacks/attester-result (NEW inbound) ──authenticated relay──►
        wf-009-attester-callback (NEW, HTTP trigger like WF-008) ──► setProofResult + settlement on-chain
  (DON never sees the document — only verdict + digests)

PHASE 3 (provable enforcement):
  ClaimEscrow.releasePayout ──reads──► ClaimDecisionRegistry.getDecision(claimId).state == APPROVED
  workflow asserts PolicyRegistry.getPolicyVersion(policyHash).verifierKeyHash == attesterKeyHash
  verify EIP-712 attester signature over {claim_id, request_digest, response_digest, result, reason_bitmap}
```

## 4. Phase 0 — Prerequisites (can start immediately; no API key needed)

- **Generate synthetic necessity letters.** A small generator producing one short clinical-necessity note per demo scenario from `CLINICAL` (`packages/schemas/src/demo-clinical-data.ts`) + Synthea rows (`data/synthea/{conditions,procedures,encounters}.csv`, using the free-text `ReasonDescription`). Two rich scenarios exist: **Maria Garcia / M17.11 right-knee OA → knee MRI (CPT 73721) / Dr. Chen**, and **James Patterson / I25.10 → cardiac CT (CPT 75574) / Dr. Torres**. Output as text/markdown (base64-encodable) keyed by `procedure_code` (and later `claim_id`). Proposed home: `data/necessity-letters/` + a generator under `infra/` or `services/attester-proof-adapter/`.
- **Provision `INFERENCE_API_KEY`** for `confidential-ai-dev-preview.cldev.cloud` into the env (gates *live* Attester calls only — not scaffolding).
- **Open item:** confirm with the Attester team whether `/v1/inference` has a synchronous mode (would let us drop the adapter's internal wait). Design does not block on the answer.

## 5. Phase 1 — Synchronous adapter + real `proofHash`

**Goal:** real LLM-in-TEE verdict + real signed digest on-chain, with no contract changes and no workflow restructuring.

**New service `services/attester-proof-adapter/`** (templated on `proof-service-stub/src/index.ts` — same Express + Zod + observability shape):
- Exposes `POST /v1/proofs/medical-necessity` returning the **exact** existing response shape (`{proof_id, proof_hash, public_inputs_hash, result, reason_bitmap, clinical_context:{predicate_checks, checks_passed, checks_total, denial_reasons}}`) so callers need no shape change.
- Internally: resolve the synthetic document for the claim → build Attester `/v1/inference` request (model, system prompt, prompt embedding `policy_predicates` + diagnosis, `resources[].content_base64` = the letter) → **await** the verdict (internal callback receiver or poll — hides sync/async) → parse the fenced-JSON verdict → map:
  - `result` ← `approved ? "PASS" : "FAIL"`
  - `reason_bitmap` ← fold the LLM's per-predicate booleans into the existing 8 bits (`predicate-evaluator.ts` constants); optionally reserve **bit 8 = `MEDICAL_NECESSITY_NOT_ESTABLISHED`** (`uint256` on-chain ⇒ additive, no contract change; extend `CLINICAL.decodeBitmap` label list).
  - `proof_hash` ← Attester `resources[0].response_digest`
  - `public_inputs_hash` ← Attester `resources[0].request_digest`
  - `clinical_context.denial_reasons` ← `[verdict.reason]`

**Workflow edit (the core provenance win):** in `wf-001 main.ts`, stop writing the fixture — change `setProofResult` arg from the `0xb2…b2` constant (line 177/382) to `proofData.proof_hash` from the adapter response. Repeat in the other 5 calling workflows (WF-003/005/006/007/008) or at least WF-001 + demo-path workflows.

**Config:** point `proofServiceUrl` at the adapter in the relevant `config.staging.json`. Add `inferenceServiceApiKey → INFERENCE_SERVICE_API_KEY_ALL` to `ProofPACRE/secrets.yaml` only if the **DON** calls the Attester directly; in the adapter topology the key lives in the adapter's env, not the DON vault.

**Done when:** `make demo-full` then `make broadcast-wf001` → `cast call getDecision(claimId)` returns a **non-fixture** `proofHash` equal to the Attester `response_digest`, state `APPROVED`→`PAID`, and adapter logs show a genuine LLM verdict over the letter.

**Reuse:** `proof-service-stub` (response shape + `predicate-evaluator.ts`), `CLINICAL` (clinical detail), the existing Confidential-HTTP call site (unchanged).

## 6. Phase 2 — Native callback topology (document never touches the DON)

**Goal:** mirror the Attester's validated async pattern; strongest PHI posture.

- **`provider-adapter-api`** (`POST /v1/prior-auth/submit`): generate/attach the synthetic letter and call the Attester `/v1/inference` with `cre_callback.url` = the EASE eHealth inbound endpoint. Document goes provider → Attester TEE only.
- **`decision-callback-service`**: add inbound `POST /v1/callbacks/attester-result` (Zod-validated, same observability pattern) that receives the signed verdict + digests, then **authenticated-relays** into the new workflow. Relay rationale (C5): a CRE HTTP trigger requires an ECDSA-signed payload against `authorizedSignerAddress`; an external hosted Attester won't hold that key, so the callback-service (which can hold it) signs and forwards.
- **New `ProofPACRE/wf-009-attester-callback/`** (HTTP trigger, modeled on `wf-008-http-prior-auth/main.ts` — `HTTPCapability().trigger({ authorizedKeys: [ECDSA] })`, handler decodes `bytesToString(payload.input)`): receives verdict+digests, writes `setProofResult(claimId, proof_hash=response_digest, reasonBitmap, approved)` + settlement (`schedulePayout`→`releasePayout`→`markPaid`, reusing WF-001's two-phase `prepareReportRequest`→`writeReport` blocks), notifies callback-service. This splits WF-001 into a **pre-phase** (consent/policy/`submitClaim`) and a **callback-phase** (proof + settlement).
- **Files:** new workflow dir (`main.ts`, `config.staging.json`, `config.production.json`, `workflow.yaml`, `package.json`, `tsconfig.json`); `Makefile` (`simulate-wf009`/`broadcast-wf009`, add to `install-cre`); `decision-callback-service` endpoint; `provider-adapter-api` Attester-trigger logic.

**Done when:** a submit drives provider → Attester → callback → wf-009 → on-chain; DON logs show **no document content**; state transitions are correct.

**Reuse:** WF-008 (HTTP-trigger workflow skeleton), WF-001 settlement blocks, decision-callback-service Zod/observability scaffold.

## 7. Phase 3 — On-chain enforcement

**Goal:** make the attested verdict provably load-bearing.

1. **Gate payout on the decision.** `contracts/src/ClaimEscrow.sol`: add `claimDecisionRegistry` to the constructor + storage; in `releasePayout`, before transfer, `require(IClaimDecisionRegistry(claimDecisionRegistry).getDecision(claimId).state == State.APPROVED, "not approved")` (optionally also non-zero `proofHash`). Add an `IClaimDecisionRegistry` interface. Maintain CEI/`nonReentrant` ordering. Update `contracts/script/Deploy.s.sol` (pass registry address; CRE signer already gets `WORKFLOW_ROLE` on both) and `contracts/test/` (new revert-path tests).
2. **Anchor the TEE key in policy.** Seed `PolicyRegistry.verifierKeyHash` (Deploy already calls `setPolicyVersion`; `POLICY_ADMIN_ROLE`) with the Attester enclave/model key hash. In the writing workflow (WF-001 / wf-009), read `getPolicyVersion(policyHash).verifierKeyHash` and assert it equals the verdict's attester key before `setProofResult`. Note `policyHash` is the `0xa1…a1` fixture in WF-001 — the seeded policy must match.
3. **Verify the attester signature (EIP-712).** Wire the dead `ProofResult` type (or a new `AttesterAttestation` type) with `verifyEip712Signature` to verify the Attester's signature over `{claim_id, request_digest, response_digest, result, reason_bitmap}`. **Fix the domain `chainId`** (84532 → per-env 31337/11155111) in `packages/eip712-types/src/domain.ts`. Two signatures compose: DON report sig (workflow ran) + TEE/content sig (this verdict came from this model on this document) — the latter fills the "Confidential HTTP has no per-node consensus on response content" gap.
4. **(Recommended) Richer on-chain provenance.** Since Phase 3 already touches contracts, extend `ClaimDecision`/`setProofResult` with `bytes32 requestHash` and `bytes32 attesterKeyHash` so both digests + identity land on-chain. Lighter alternative: overload `proofHash = response_digest` only (no struct change).

**Done when:** `forge test` proves `releasePayout` reverts unless `APPROVED`; the workflow asserts `verifierKeyHash`; an EIP-712 attester-signature unit test passes against the corrected domain.

## 8. Cross-cutting cleanups (fold in opportunistically)

- **Stale chain config:** reconcile `CLAUDE.md`, `infra/env/.env.template` (`CHAIN_ID=84532`), `infra/deploy/deploy-contracts.sh`, and the EIP-712 domain to the real runtime (Anvil 31337 / Eth Sepolia 11155111). Required before Phase 3 EIP-712 verify; cosmetic elsewhere.
- **Pre-existing WF-003 `challengeClaim` ABI mismatch:** workflow encodes `(bytes32, string)`; contract is `(bytes32 claimId, uint16 reasonCode)`. Fix the fragment to `uint16` **before** routing any Attester-driven re-review through the `CHALLENGED` path.
- **Pre-existing WF-004 `getDecision` tuple bug:** `wf-004` swaps `state`↔`policyHash` (and uses `uint256` vs `uint64 updatedAt`). Fix to canonical `(claimId, state, policyHash, proofHash, reasonBitmap, updatedAt)` if reused for any attester path.
- **(Optional) Schema convergence:** point the adapter/stub at the shared `@proofpa/schemas` `ProofRequest` (`attestation_refs[]`) and adopt the EIP-712 `ProofResult` envelope, retiring the stub's local schema.

## 9. Verification / testing (end-to-end)

- **Stack:** `make demo-full` (anvil 31337 → `Deploy.s.sol` → services 3001-3006 → scenarios A–F → `broadcast-wf001`).
- **Single workflow:** `make broadcast-wf001` (`cre workflow simulate ./wf-001-prior-auth-decision --target=staging-settings --broadcast`); wf-009 via `--trigger-index=0 --http-payload='{…}'`.
- **On-chain assert:** `cast call <ClaimDecisionRegistry> "getDecision(bytes32)" <claimId> --rpc-url http://127.0.0.1:8545` → real `proofHash`, state `PAID`.
- **Contracts:** `cd contracts && forge test -vvv` (add escrow-gating revert tests + EIP-712 verify test).
- **Privacy check (Phase 2):** grep CRE simulate logs to confirm no document content traverses the DON.

## 10. Reuse map

| Need | Reuse |
|---|---|
| Phase 1 adapter skeleton + response shape | `services/proof-service-stub/src/index.ts`, `predicate-evaluator.ts` |
| HTTP-trigger workflow (wf-009) | `ProofPACRE/wf-008-http-prior-auth/main.ts` |
| Settlement write sequence | `wf-001 main.ts:357-447` (`prepareReportRequest`→`writeReport`) |
| Inbound callback endpoint scaffold | `services/decision-callback-service/src/index.ts` |
| EIP-712 sign/verify + domain | `packages/eip712-types/src/{sign,verify,domain}.ts` |
| Clinical detail for letters | `packages/schemas/src/demo-clinical-data.ts` (`CLINICAL`) |
| Deploy + roles + policy seed | `contracts/script/Deploy.s.sol` |

## 11. Open items / decisions

- [ ] `INFERENCE_API_KEY` provisioned? (gates live Attester calls)
- [ ] Attester `/v1/inference` synchronous mode? (would simplify Phase 1; default = await-adapter)
- [ ] Phase 3 provenance: extend `ClaimDecision` struct with `requestHash`/`attesterKeyHash` (recommended) vs overload `proofHash` only?
- [ ] Which scenarios get synthetic letters first (knee-MRI + cardiac-CT are the rich two)?
