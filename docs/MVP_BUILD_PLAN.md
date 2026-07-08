# EASE eHealth — Product MVP Build Plan (v1)

**Status:** Proposed — for sign-off · **Date:** 2026-06-30
**Companions:** `docs/PRODUCT_ROADMAP.md` (strategy), `docs/ATTESTER_INTEGRATION_PLAN.md` (AI integration — tabled/warm)

## Objective
Build the first **real-product** slice: one genuine prior-authorization decision, end-to-end, on a realistic on-chain backbone. Not a CRE capability showcase — the actual business flow.

## Locked decisions
- **Audience:** real product MVP (not a pitch demo) → optimize for realism / parity.
- **Positioning:** realistic, **payer-signed** plans + **key gates on-chain** (the hybrid) — not full-on-chain, not trustless-wow.
- **AI attester:** tabled but **warm** — adapter + graceful fallback stay; the necessity step runs in fallback; reintegrate when the service is live (next hackathon). The MVP is built **AI-ready** — the FHIR `DocumentReference` + the adapter seam are the slot it drops back into.
- **Org relationships:** v1 = **minimal in-network check** only. The richer data-sharing / agreement graph (BAAs, HIE/TEFCA, AI-validated agreements) is the **next pillar (v2)**.
- **Data:** **Synthea → FHIR R4** (Synthea is FHIR-native), served locally — no external EHR for v1.
- **Da Vinci:** **borrow the shapes** (CRD / DTR / PAS mapping), not full conformance.
- **Regulatory stance:** decision-**support** (not a binding determination) for v1.

## v1 scope — the five pillars
1. **Organizations & network** — provider + payer orgs as on-chain identities; provider↔plan **network membership** (`isInNetwork`). Minimal.
2. **Plans as contracts** — payer-**signed** benefit design (`planHash` + payer sig + version + validity) with **on-chain gates**: prior-auth-required set + amount caps. (Da Vinci **CRD**.)
3. **Eligibility / coverage** — member↔plan↔active coverage period (FHIR `Coverage`).
4. **FHIR substrate** — Synthea → FHIR R4: Patient, Coverage, Condition, Procedure, ServiceRequest, DocumentReference; served by `provider-adapter-api`.
5. **The decision flow** — one consolidated prior-auth workflow: submit → in-network + eligible + benefit-adjudicated → necessity (fallback) → approve/deny → escrow settle (already gated).

## Standards conformance — what we build *to* (validated: see REALITY_MAP.md)

Shape the MVP data models to the real FHIR/Da Vinci profiles so it *conforms* to the standard, not merely echoes it. **Pin to published STU versions (PAS/CRD/DTR STU 2.1, US Core), NOT build.fhir.org — the CI build is a moving target (codes, invariants, and element paths differ between versions).**

| Pillar | FHIR / Da Vinci model | Key fields / mechanism | CMS-0057 API |
|---|---|---|---|
| PA request | **Da Vinci PAS** `PASClaim` (R4 `Claim`, `use`=preauthorization, `status`=active) + supporting `ServiceRequest` | `patient`/`provider`/`insurer`/`insurance`(→`Coverage`)/`item`; item ext `certificationType`, `serviceItemRequestType`, `productOrService` | Prior Auth API |
| Decision | **PAS** `PASClaimResponse` (`ClaimResponse`) | `reviewAction` ext on `item.adjudication` (approve/deny/pend `code` + `reasonCode`, bound to X12 278 HCR01); `preAuthRef` + `preAuthPeriod` | Prior Auth API |
| Plan-as-contract (coverage rules) | **Da Vinci CRD** `ext-coverage-information` + `InsurancePlan` | `covered` (covered/not-covered/conditional), `pa-needed` (no-auth/auth-needed/satisfied), `doc-needed` — our on-chain plan encodes these gates + caps | CRD (Prior Auth API) |
| Eligibility | FHIR `CoverageEligibilityResponse` + `Coverage` | `insurance.inforce` + `benefitPeriod` (active?), `item.excluded` (covered?), `item.authorizationRequired`, `item.network` (in-network?), `item.benefit` (limits) | Patient / Provider Access |
| Network membership | **Da Vinci Plan-Net** `OrganizationAffiliation` (+ `PractitionerRole`); Network = constrained `Organization`; `InsurancePlan`→networks | `OrganizationAffiliation.network` reference + active `period` (date-filtered query = "in-network now?") | Provider Access / directory |
| Settlement | (our escrow — replaces the 837/835 claim→remit cycle; no direct FHIR analog) | `ClaimEscrow` gated on APPROVED | — |

**CMS-0057-F basis (what's required vs. encouraged):** required base = FHIR R4 + US Core/USCDI + SMART/OAuth2 + Bulk Data; the Da Vinci IGs (PAS/CRD/DTR/PDex/Plan-Net) + CARIN are **"strongly encouraged," not mandated** — the rule mandates *capabilities*, not a specific IG. So conforming to the Da Vinci shapes is the credible, future-aligned choice without being forced.

**Thesis in standards terms:** we implement the *shapes* of the CMS-0057 Prior-Auth + directory APIs (PAS / CRD / Plan-Net), but back them with **verifiable shared on-chain state** for plan/eligibility/network — the "centralized interoperable backbone" CMS/JAMA prescribe, without a Change-Healthcare-style owned intermediary.

**Timing holds (adoption is lagging):** WEDI (Dec 2025) — only **~47% of providers** are confident of meeting the Jan 2027 API deadline (**down 22 pts**); **~38% of payers plan FHIR-only vs. ~38% FHIR+X12** (57% of clearinghouses dual). The mandated future-state is uncertain and the **X12/intermediary layer persists** — that gap is our opening.

## Explicitly out of v1 (→ roadmap)
- Richer **org data-sharing / agreement graph** (the next pillar) + AI-validated agreements.
- **Live AI** necessity (until the attester returns).
- Full **Da Vinci** conformance; **cost-share / allowed-amount** math; **credentialing** depth; real EHR/FHIR source; the other showcase workflows (consolidated away / parked, kept in-repo for reference).

## Target flow (v1)
```
provider submits ServiceRequest (FHIR)
   -> [EVM]  provider in-network for member's plan?     (OrganizationRegistry)
   -> [EVM]  member eligible / coverage active?         (CoverageRegistry)
   -> [HTTP+EVM] benefit adjudication:                  (Plan/PolicyRegistry + signed plan)
              auth-required? covered? within cap?
   -> [HTTP] medical necessity                          (attester-proof-adapter -> FALLBACK)
   -> [EVM]  setProofResult(APPROVED/DENIED, proofHash) (ClaimDecisionRegistry)
   -> if APPROVED: schedule -> release -> markPaid       (ClaimEscrow, gated on APPROVED)
```

## Components to build / change
**Contracts (`contracts/src/`):**
- NEW `OrganizationRegistry` — org identities + provider↔plan network membership.
- EVOLVE `PolicyRegistry` → plan: add payer signature, prior-auth-required gates, amount caps (keep validity + `verifierKeyHash`).
- NEW `CoverageRegistry` — member eligibility (member, planHash, active period), payer-written/signed.
- `ClaimDecisionRegistry`, `ClaimEscrow` — unchanged (escrow already APPROVED-gated). `Deploy.s.sol` wires the new registries + seeds demo orgs/plan/coverage; forge tests for all new logic.

**Services (`services/`):**
- `provider-adapter-api` — serve FHIR R4 resources from Synthea-FHIR (replace the CSV EHR endpoints).
- `policy-service` — host the off-chain **signed benefit design** the workflow verifies against the on-chain `planHash` (or retire in favor of on-chain reads + the signed doc).
- `attester-proof-adapter` — unchanged (necessity, fallback).

**Workflows (`ProofPACRE/`):**
- ONE consolidated **prior-auth decision** workflow (evolve WF-001) doing the real flow above. The 8 showcase workflows are parked for the product surface (kept in-repo for reference).

**Data:**
- Synthea → FHIR R4 bundles + a regen script; `provider-adapter-api` serves them.

## Milestones
- **M1 — FHIR substrate (R2):** Synthea → FHIR regen + provider-adapter serves FHIR resources. *(parallel with M2)*
- **M2 — Contracts (R1):** OrganizationRegistry + Plan (PolicyRegistry evolve) + CoverageRegistry + payer signing + gates + Deploy + forge tests. *(parallel with M1)*
- **M3 — Decision workflow (R4 core):** wire the one prior-auth flow end-to-end (in-network + eligible + benefit + necessity-fallback + settle).
- **M4 — Verify + demo:** end-to-end on anvil (fallback necessity) → APPROVED→PAID with real on-chain plan/eligibility/network checks.

## Verification
- `forge test` for all new contract logic (network membership, plan adjudication gates, eligibility, payer-signature verification).
- FHIR endpoint smokes (resources are well-formed R4).
- End-to-end decision run in fallback: a covered + eligible + in-network knee-MRI → APPROVED→PAID; a not-covered / out-of-network / ineligible variant → DENIED with no payout (escrow gate holds). (`cre --broadcast` local-persistence quirk is known — use forge / direct calls for on-chain assertions.)

## Open sub-decisions (small — decide as we build)
- Evolve `PolicyRegistry` in place vs. add a sibling `PlanRegistry`.
- Eligibility: payer **writes** an on-chain registry vs. payer **signs** an eligibility attestation the workflow verifies. *(Leaning: registry for v1 — simpler to read in-workflow.)*
- Keep `policy-service` as a signed-plan host vs. fold the signed plan into provider-adapter / on-chain.

## Maps to roadmap
v1 delivers **R1** (plans + eligibility, hybrid) + **R2** (FHIR substrate) + the **core of R4** (one real lifecycle flow). R3 (live AI) is warm; R5 (settlement/identity/compliance) and the org-data-graph are next.
