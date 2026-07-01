# EASE eHealth — MVP Build Handoff

**For:** the build agent (Fable 5) picking up the v1 MVP · **From:** the planning/strategy session that precedes this · **Date:** 2026-07-01
**Repo:** `/Users/darbease/Demos/EASEeHealth/EASEeHealth` — ⚠️ the git repo is the **nested** dir, not its parent. Remote: GitHub `Darbease/EASEeHealth`. Working branch: **`feat/ai-attester-integration`** (`main` = pre-Attester state).
**Human owner:** darby (darby.martinez82@gmail.com). **Confirm the OPEN DECISIONS in §9 with darby before/early in the build** — two scoping questions were not yet locked at handoff.

---

## 0. Read these first (in order)
1. **This doc** — orientation + concrete build spec + landmines.
2. **`docs/MVP_BUILD_PLAN.md`** — the locked scope, five pillars, milestones, and the **Standards conformance** table (the FHIR/Da Vinci models to build to).
3. **`docs/REALITY_MAP.md`** — the cited evidence base: how the real US prior-auth backbone works, where it's broken, and the validated data models. This is *why* the build is shaped the way it is.
4. **`docs/PRODUCT_ROADMAP.md`** — where v1 sits in the R1–R5 arc + parked decisions (incl. the fallback-policy decision, §8).
5. **`CLAUDE.md`**, **`docs/ATTESTER_INTEGRATION_PLAN.md`** — the *existing* system (contracts, services, CRE workflows, and the already-built Confidential AI Attester integration).

Everything below is a distillation; the four docs above are the source of truth.

## 1. Mission — what you're building
Build **v1**: **one real prior-authorization decision, end-to-end**, on a realistic, standards-conformant, on-chain backbone. NOT a CRE capability showcase — the actual business flow. Scope = roadmap **R1 (plans + eligibility) + R2 (FHIR substrate) + the core of R4 (one consolidated decision workflow)**. The AI medical-necessity step stays **warm in deterministic fallback** — the Confidential AI Attester is currently gated/offline (see §7); build it AI-ready but fallback-default.

## 2. The thesis + why (build with intent, not mechanically)

**The spine — hold this one line:**
> **Prior authorization is two questions and a payment.** *"Is this care medically necessary?"* and *"Is it covered for this member?"* — and if both are yes, money moves to the provider.

- "**Covered?**" is a *rules* question → deterministic → **smart contracts** (payer-signed plan + eligibility + network as shared, verifiable state).
- "**Necessary?**" is a *judgment over documents* → **confidential AI in a TEE** (warm/fallback now).
- Orchestration + confidential data fetch → **CRE**. Payment → **escrow**, gated on the decision.

**Why on-chain shared state (not blockchain-for-its-own-sake):** CMS and JAMA diagnose the ~$265B/yr admin waste as *fragmentation* (every payer siloing its own plan/eligibility/directory data) and explicitly prescribe *a shared, interoperable backbone* as the fix. But the one time the industry built that, it became **Change Healthcare** — ~50% of all claims through one owner, where a single missing MFA control froze the nation's claims and forced $8.9B in provider loans. So the unmet need is **"a shared source of truth that no single party owns and can't be a single point of failure"** — exactly what verifiable on-chain state provides. **We build the prescribed remedy, minus the chokepoint.** Timing: CMS-0057-F forces FHIR prior-auth APIs by 2027, but only ~47% of providers expect to make it and X12/intermediaries persist — the opening.

**Every piece maps to a documented, cited gap:**

| Piece | Gap it targets | Cited fact (see REALITY_MAP.md) |
|---|---|---|
| On-chain shared plan/eligibility/network | per-payer siloed data → fragmentation | ~$265B/yr admin waste; the *prescribed* remedy |
| …made *verifiable*, not owned | one intermediary = single point of failure | Change ~50% of claims; one MFA gap → $8.9B loans |
| `OrganizationRegistry` (network) | "ghost networks" | >80% of directory listings inaccurate |
| Automated rules + AI decision | manual, slow, costly PA | 31% e-PA; ~$6 & ~11 min; 13 hrs/wk/practice |
| Verifiable rule-based adjudication | arbitrary, reversible denials | 7.7% denied, 80.7% of appeals overturned |
| Escrow, instant, gated on APPROVED | slow 837→835 claim/remit cycle | trivially beats the 72hr/7-day mandate |

## 3. Where the repo is NOW (what you build on)

**Already built + committed** (branch `feat/ai-attester-integration`, commit `87fbba5`): the 3-phase Confidential AI Attester integration — `services/attester-proof-adapter` (calls the Attester, maps the verdict, **falls back deterministically** when it's down), WF-001/006/007/008 write the real `proof_hash`, `ClaimEscrow.releasePayout` gated on `APPROVED` (+5 forge tests), the EIP-712 attester envelope, and `wf-009-attester-callback`. **57 forge tests pass.**

**Uncommitted at handoff** (working tree): the planning/research docs — `REALITY_MAP.md`, `MVP_BUILD_PLAN.md`, `PRODUCT_ROADMAP.md`, this file. *(Recommend committing these as the handoff baseline so your build lands as a clean diff — confirm with darby.)*

**Architecture surface you'll extend:**
- **Contracts** (`contracts/src/`, Foundry, Solidity 0.8.24, OZ `AccessControl`, no forwarder): `MockUSDC`, `ConsentRegistry`, `PolicyRegistry`, `ClaimDecisionRegistry`, `ClaimEscrow`. Roles: `WORKFLOW_ROLE` (CRE signer), `POLICY_ADMIN_ROLE`, `CHALLENGE_ROLE`, `TREASURY_ROLE`.
- **Services** (`services/`, npm workspaces, Express + `tsx`): `provider-adapter-api` (:3005, EHR data + submit), `policy-service` (:3001), `credential-service` (:3002), `proof-service-stub` (:3003), `consent-service` (:3004), `decision-callback-service` (:3006), `attester-proof-adapter` (:3007). Shared packages: `@proofpa/schemas`, `@proofpa/observability`, `@proofpa/eip712-types`.
- **CRE workflows** (`ProofPACRE/`, bun per-workflow, compile to isolated WASM): WF-001 (cron prior-auth) … WF-009. WF-001 is the reference full flow; WF-008 is the HTTP-trigger exemplar.
- **Data:** `data/synthea/*.csv`, `data/necessity-letters/`.
- **Harness:** `Makefile` (`make demo-full`, `deploy-local`, `broadcast-wf00X`); Anvil chain 31337; per-workflow `config.staging.json` holds the deterministic Anvil addresses + service URLs (`proofServiceUrl` → :3007).
- **Secret:** `.env` (gitignored) holds `INFERENCE_API_KEY` — Attester currently gated (§7), fallback active.

## 4. Build plan — milestones
- **M1 — FHIR substrate (R2):** Synthea → FHIR R4 (Synthea is FHIR-native — regen via FHIR export or transform the CSVs). `provider-adapter-api` serves `Patient`, `Coverage`, `Condition`, `Procedure`, `ServiceRequest`, `DocumentReference`. *(Parallel with M2.)*
- **M2 — Contracts (R1):** `OrganizationRegistry` (new), evolve `PolicyRegistry` → the signed plan + gates, `CoverageRegistry` (new). Deploy wiring + seed demo data + forge tests. *(Parallel with M1.)*
- **M3 — Decision workflow (R4 core):** one consolidated prior-auth workflow wiring the real flow (in-network + eligible + benefit-adjudicated + necessity-fallback + settle).
- **M4 — Verify + demo:** end-to-end on Anvil (fallback necessity) → APPROVED→PAID with real on-chain plan/eligibility/network checks; a DENIED variant (out-of-network / ineligible / not-covered) with no payout (escrow gate holds).

## 5. Standards conformance — build TO these (the concrete models)

Validated verbatim from the HL7 IGs (see `REALITY_MAP.md` §9). **Pin to a published STU (PAS/CRD/DTR STU 2.1, US Core) — NOT build.fhir.org (moving target).**

| Pillar | FHIR / Da Vinci model | Key fields |
|---|---|---|
| PA request | Da Vinci **PAS** `PASClaim` (`Claim`, use=preauthorization) + `ServiceRequest` | patient/provider/insurer/insurance(→Coverage)/item; item ext certificationType, serviceItemRequestType, productOrService |
| Decision | **PAS** `PASClaimResponse` (`ClaimResponse`) | `reviewAction` ext on item.adjudication (approve/deny/pend + reasonCode ↔ X12 278 HCR01); `preAuthRef` + `preAuthPeriod` |
| Plan (coverage rules) | Da Vinci **CRD** `ext-coverage-information` + `InsurancePlan` | covered / pa-needed / doc-needed → your on-chain plan encodes these gates + caps |
| Eligibility | `CoverageEligibilityResponse` + `Coverage` | insurance.inforce + benefitPeriod (active?), item.excluded (covered?), item.authorizationRequired, item.network, item.benefit |
| Network | Da Vinci **Plan-Net** `OrganizationAffiliation` (+ `PractitionerRole`); Network = constrained `Organization` | OrganizationAffiliation.network reference + active period (date-filtered = "in-network now?") |

CMS-0057-F basis: FHIR R4 + US Core + SMART/OAuth2 + Bulk required; Da Vinci IGs strongly-encouraged (not mandated) — conforming to the Da Vinci shapes is the credible, future-aligned choice.

## 6. Concrete build spec (component by component)

**Contracts** (model on the existing ones; every new/changed contract gets forge tests):
- **NEW `OrganizationRegistry.sol`** — orgs as identities `{ orgId: bytes32, kind: {PROVIDER,PAYER}, active }` + network membership modeled on Plan-Net `OrganizationAffiliation`: a `(providerOrg, network/planHash, effectiveFrom, effectiveTo)` mapping with `isInNetwork(providerOrg, planHash, atTs) → bool`. Gate writes behind a registrar role (mirror `POLICY_ADMIN_ROLE`).
- **EVOLVE `PolicyRegistry.sol` → the plan.** Today: `PolicyVersion{policyHash, verifierKeyHash, effectiveFrom, effectiveTo, active}`. Add the CRD gates: prior-auth-required set (per procedure), covered set, amount caps — plus a payer signature / signed-commitment to the full off-chain benefit design (hybrid: full design off-chain by hash, key gates on-chain). Keep `verifierKeyHash` (attester anchor) + validity. Expose the gates for the workflow to adjudicate against.
- **NEW `CoverageRegistry.sol`** — member eligibility modeled on `CoverageEligibilityResponse`: `{ memberId, planHash, effectiveFrom, effectiveTo, active }` + `isEligible(memberId, planHash, atTs) → bool`. Payer-written (registrar role).
- **KEEP** `ClaimDecisionRegistry` (maps to PAS `ClaimResponse`; `reasonBitmap` ≈ reviewAction reasonCode) and `ClaimEscrow` (APPROVED-gate already done, Phase 3).
- **`Deploy.s.sol`** — deploy + wire the new registries; seed a demo provider org + payer org + a network + an in-network membership + a plan with gates + a member eligibility. Keep the existing demo policy `0xa1a1…a1` + `verifierKeyHash=keccak256("demo-verifier-key")`.

**Services:**
- **`provider-adapter-api`** — serve FHIR R4 resources from Synthea-FHIR; add a submit endpoint shaped as FHIR `ServiceRequest` (PAS-style). Replace/augment the CSV EHR endpoints.
- **`policy-service`** — host the off-chain signed benefit design the workflow verifies against the on-chain `planHash` (or fold into on-chain reads + a signed doc).
- **`attester-proof-adapter`** — leave as-is (necessity + fallback). Keep warm.

**Workflow** (`ProofPACRE/`):
- Build ONE consolidated prior-auth decision workflow (evolve WF-001 or a new `wf-010`). Sequence: fetch `ServiceRequest`/`Coverage`/`Condition`/`Procedure` (confidential HTTP → provider-adapter :3005) → EVM reads: `isInNetwork` (OrganizationRegistry), `isEligible` (CoverageRegistry), plan gates (PolicyRegistry) → necessity (attester-adapter :3007, fallback) → `setProofResult` (ClaimDecisionRegistry) → schedule/release/markPaid (ClaimEscrow). Model on WF-001. **Duplicate ABI fragments per-workflow** (CRE WASM isolation — no shared imports). Park the 8 showcase workflows (keep for reference).

**Data:** Synthea → FHIR R4 regen script (`scripts/` or `infra/`); provider-adapter serves the bundles.

## 7. Gotchas / landmines (these WILL bite — read before debugging)
- **`cre workflow simulate --broadcast` does not persist writes to local Anvil in this environment** (returns `tx status: 2`, even for the untouched `submitClaim`). It's pre-existing/environmental — `demo-full` marks it "non-blocking." **Use `forge` / `cast` for on-chain assertions; do not chase tx-status-2.**
- **CRE signer vs deployer:** `.env` sets `CRE_ETH_PRIVATE_KEY` to Anvil **acct 0 (deployer)**, but `WORKFLOW_ROLE` is granted to the **creSigner = acct 1** — writes signed by acct 0 revert. Export `CRE_ETH_PRIVATE_KEY=$CRE_SIGNER_KEY` for broadcasts.
- **Attester is gated:** the dev-preview returns `503 service_disabled` outside hackathon events; the adapter falls back cleanly. Build AI-ready, fallback-default. Don't block on live AI.
- **Repo-wide `tsc` is NOT clean** — pre-existing type errors in `@proofpa/observability` and `@proofpa/schemas`. Not yours. New Express services need `app.use(correlationMiddleware as unknown as RequestHandler)` (pattern already used in the adapter). Judge *your* files by whether *they* add errors.
- **CRE workflow specifics:** compile to isolated WASM (duplicate ABI fragments, no cross-workflow imports); `Date.now()`/`Math.random()` DO work in workflows (that restriction is only for Workflow-tool scripts, not CRE). Two-phase write = `runtime.report(prepareReportRequest(calldata))` → `evmClient.writeReport(...)`.
- **Fixtures:** WF-001 uses deterministic demo hashes (claimId `0x01…01`, policyHash `0xa1…a1`, consentId `0xc0…c0`). Deploy seeds the plan at `0xa1…a1`.
- **Pin FHIR/Da Vinci** to a published STU version, not the CI build.

## 8. Verification
- `forge test --root contracts` (run from repo root, or `cd contracts`) — 57+ tests must stay green; add tests for every new contract (network membership, plan gates, eligibility).
- Adapter/service smokes: start a service, POST a request, check the response shape.
- End-to-end: `make demo-full` (Anvil 31337 → `deploy-local` → services → broadcast) then `cast call <ClaimDecisionRegistry> "getDecision(bytes32)" <claimId>` — expect the decision + a real (non-fixture) `proofHash`; verify a DENIED variant yields no payout. (Mind the tx-status-2 caveat — assert via forge/cast, not the cre broadcast alone.)

## 9. OPEN DECISIONS — confirm with darby before building
These were not locked at handoff (my recommendation in parens):
1. **Does v1 model >1 payer/provider?** The anti-fragmentation thesis ("a fix propagates to all") is only *visible* with ≥2 orgs sharing the same on-chain state. *(Rec: seed 2 orgs so the thesis is demonstrable, not just the flow.)*
2. **Does the demo show a before/after contrast** (manual/intermediary path vs. our instant/verifiable one)? *(Rec: yes — the efficiency claim lands hardest as a contrast.)*
3. **Fail-open vs fail-closed vs provisional** when AI necessity can't run (parked in ROADMAP §8; currently fail-open). *(Rec: keep fail-open for the demo; flag as a real product decision.)*
4. **Plan representation split** — confirmed hybrid (payer-signed plan + on-chain gates); the exact on-chain-vs-signed-off-chain boundary is yours to set at M2. *(Rec: gates + caps + auth-required on-chain; full benefit design signed off-chain by hash.)*

## 10. File & repo map
| Concern | Path |
|---|---|
| Build plan / scope / conformance | `docs/MVP_BUILD_PLAN.md` |
| Evidence base / reality | `docs/REALITY_MAP.md` |
| Roadmap + parked decisions | `docs/PRODUCT_ROADMAP.md` |
| Existing system overview | `CLAUDE.md`, `docs/ATTESTER_INTEGRATION_PLAN.md` |
| Contracts | `contracts/src/*.sol`, tests `contracts/test/`, deploy `contracts/script/Deploy.s.sol` |
| Services | `services/*/src/index.ts` |
| CRE workflows | `ProofPACRE/wf-00X-*/main.ts` (+ per-wf `config.staging.json`, `workflow.yaml`) |
| Data | `data/synthea/`, `data/necessity-letters/` |
| Harness | `Makefile`, `infra/deploy/` |
