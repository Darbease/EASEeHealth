# EASE eHealth — Hackathon → Product Roadmap

**Status:** Strategy / direction · **Date:** 2026-06-22
**Companion docs:** `docs/ATTESTER_INTEGRATION_PLAN.md` (the AI-attester integration that's already built), `PRD_ProofPA.md`, `TECH_ARCHITECTURE_SPEC_ProofPA.md`

> This is the plan for evolving the CRE hackathon proof-of-concept into the product. The hackathon build was (correctly) shaped to showcase every CRE trigger/capability for judging; this roadmap reshapes that breadth into product depth.

---

## 1. The thesis

**Real prior authorization is two questions** — *"is this care medically necessary?"* (clinical judgment over documents) and *"is it covered for this member?"* (benefit + eligibility rules) — **and if both are yes, money moves to the provider.**

We put the first question in a **TEE-attested AI**, the second in **smart contracts**, orchestrate both with **CRE confidential compute + HTTP**, and settle with **escrow.**

| Question | Owner | Today | Target |
|---|---|---|---|
| Medically necessary? | AI-in-TEE (Attester) over documents | wired, thin, offline | structured rubric over real clinical docs |
| Covered for this member? | Smart contracts (plan + eligibility) | hash + validity only; real rules off-chain | benefit design + eligibility adjudicated on-chain |
| Move the money | `ClaimEscrow` | done; gated on APPROVED | + allowed-amount / cost-share math |
| Orchestrate it all | CRE workflows | 8 showcase workflows | consolidated lifecycle |

## 2. Parity anchor — mirror the real standard (Da Vinci + CMS-0057-F)

Your "parity with how traditional plans work" goal has a concrete, current target: HL7's **Da Vinci Burden Reduction** IGs, which **CMS-0057-F mandates** payers expose as FHIR APIs (phased 2026–2027). Our architecture already maps onto it — saying so is a strong, defensible design statement:

| Da Vinci IG | What it does (real world) | Our component |
|---|---|---|
| **CRD** (Coverage Requirements Discovery) | At point of order: is prior auth required, and what are the rules? | **Plan-as-contract** (`PolicyRegistry` → `PlanRegistry`) |
| **DTR** (Documentation Templates & Rules) | What documentation is needed to support the request? | **Document gathering + necessity criteria** fed to the attester |
| **PAS** (Prior Authorization Support) | Submit the prior auth, get a decision | **submit → adjudicate → AI necessity → approve/deny → settle** |

Aligning the data model (FHIR R4) and flow to Da Vinci is the cleanest path to genuine parity — and it's a differentiator: doing it with confidential compute + on-chain plans + instant escrow settlement, instead of X12 278 batch EDI.

## 3. Where we are today

**Kept from the hackathon build (the foundation — see ATTESTER_INTEGRATION_PLAN.md):**
- CRE workflow patterns: triggers (cron/HTTP/log), confidential HTTP, EVM read/write, two-phase DON report.
- `attester-proof-adapter` + **graceful fallback** (the seam abstraction that decouples us from the Attester's uptime).
- `ClaimEscrow` **APPROVED-gate**, the EIP-712 **attester-attestation** envelope, and the **native callback** topology (`wf-009`, document never touches the DON).
- Contracts: `ClaimDecisionRegistry` (state machine), `ConsentRegistry`, `ClaimEscrow`, `PolicyRegistry`, `MockUSDC`; the no-PHI-on-chain invariant + structured observability.

**Stubbed / showcase-grade (the product work):**
- Plan adjudication: benefit design lives in an **off-chain hardcoded map** (`policy-service`); on-chain is just a hash + validity.
- No **member eligibility** (enrolled/active coverage) — "consent active" stands in.
- Data + documents are **synthetic** (Synthea CSV + generated letters); no FHIR.
- AI evaluation is a **boolean**, not a structured clinical rubric — and is offline.
- Settlement is **MockUSDC, single treasury** — no allowed-amount / cost-share math.
- Trust gaps: physician attestation (JWS) **never verified**; provider credentialing + member identity are fixtures.
- 8 workflows are **trigger/capability demos**, not the business lifecycle.

## 4. Design principles (carry these into every phase)

1. **On-chain = source of truth for coverage; off-chain confidential = clinical judgment.** Plans/eligibility/decisions on-chain (auditable, payer-signed); PHI + clinical reasoning off-chain in a TEE.
2. **No PHI on-chain, ever** — only hashes, state, policy refs, payout events. Enforce by schema lint.
3. **Graceful degradation** — every external dependency (Attester, FHIR source) has a defined fallback; the system never hard-fails.
4. **Parity, not reinvention** — mirror Da Vinci/FHIR data shapes and real benefit-design semantics so payers/providers recognize it.
5. **Attestation-based trust now, ZK later** — TEE remote attestation + signed digests are the near-term assurance; ZK is a later upgrade, not a blocker.

## 5. The roadmap

Sizing is rough T-shirt (S/M/L). "Buildable now" = no dependency on the Attester being back or external systems.

### R1 — Plans as real on-chain contracts + eligibility  ·  **L · Buildable now**
*The coverage half. Closes the biggest gap to the vision.*
- New/extended **`PlanRegistry`**: encode benefit design — covered procedures, amount caps, prior-auth-required list, formulary (tiers/step therapy), cost-share params (deductible/coinsurance/copay/OOP-max). Versioned + **payer-signed** (EIP-712), effective-dated.
- New **eligibility/coverage** concept (FHIR `Coverage`-shaped): member enrolled, active coverage period, plan binding. On-chain `CoverageRegistry` or attested eligibility.
- Workflow **adjudicates the claim against the on-chain plan** (replaces the off-chain hardcoded `policy-service` map, or makes `policy-service` a read-through of chain).
- **Needs:** nothing external. **Unblocks:** meaningful AI necessity (a necessity verdict now feeds a *real* coverage decision); real settlement math (R5); maps directly to Da Vinci **CRD**.

### R2 — Real clinical data substrate (FHIR R4)  ·  **M · Buildable now (mock FHIR)**
*The data the system reasons over.*
- Move EHR ingestion from Synthea CSV → **FHIR R4**: `Patient`, `Coverage`, `Condition`, `Procedure`, `ServiceRequest` (the PA request itself), `DocumentReference` (the clinical docs).
- Real(istic) clinical documents via `DocumentReference`, fetched over **CRE confidential HTTP**.
- **Needs:** a FHIR source (mock FHIR server now; real EHR sandbox later, e.g. SMART/HL7 test servers). **Unblocks:** R1 eligibility reads `Coverage`; R3's rubric has structured documents; maps to Da Vinci **DTR**.

### R3 — Richer AI evaluation (the necessity half)  ·  **M · AI half needs Attester live**
*Make the clinical judgment real and structured.*
- Replace the boolean with a **structured medical-necessity rubric**: does the documentation support the diagnosis? does the diagnosis meet the procedure's necessity criteria **carried by the plan (R1)**? Return per-criterion findings + citations + confidence — not a single bool.
- Attester signs the structured verdict; adapter maps it (already wired); on-chain stores the digest + reason bitmap.
- **Needs:** Attester endpoint back for the *live* half (prompt/rubric/parsing are buildable now and run in fallback until then). **Unblocks:** the full two-question decision with both halves real; verifiable TEE attestation (R5 trust).

### R4 — Reshape showcase → product lifecycle  ·  **M · Buildable now**
*Make the spine product-shaped.*
- Consolidate the 8 trigger-demo workflows into the real flows:
  - **Prior-auth decision** (HTTP submit → eligibility → benefit adjudication → AI necessity → approve/deny → settle) — the native-callback path (`wf-009`) becomes primary.
  - **Appeal / challenge** (log-trigger on dispute → re-review).
  - **Reconciliation** (cron).
  - **Consent lifecycle** (HTTP).
- Keep CRE trigger diversity only where it maps to a real event. Retire pure capability demos (e.g. encrypted-credential-audit) or fold them into the above.
- **Needs:** best done after R1–R3 so flows reflect the real decision steps. **Unblocks:** a coherent product surface + demo.

### R5 — Settlement realism, identity & compliance  ·  **L · mixed**
*Production hardening.*
- **Settlement:** allowed amount + member cost-share split (from R1 plan params) + provider contracted rate; real stablecoin rails optional.
- **Identity/trust:** verify the physician attestation (JWS) — close the never-verified gap; provider credentialing (NPPES/NPI + payer network status); member identity. **Verify the TEE remote attestation** (enclave quote), not just the signature.
- **Compliance:** formalize no-PHI-on-chain (schema lint in CI), audit trail, minimum-necessary, retention; HIPAA posture (BAA), and the regulatory framing (ERISA self-funded plans, state insurance, CMS-0057-F alignment).
- **Needs:** external integrations (credentialing, real payer contracts) for full realism; the on-chain math is buildable now.

## 6. Trust, compliance & infra gaps (cross-cutting)

| Gap | Today | Target | Phase |
|---|---|---|---|
| Physician attestation (JWS) | accepted, never verified | signature + issuer/credential verified | R5 |
| Provider credentialing | hardcoded | NPI/NPPES + network status | R5 |
| Member eligibility | "consent active" proxy | FHIR `Coverage` / eligibility | R1/R2 |
| Plan authenticity | unsigned hash | payer-signed, versioned plan | R1 |
| TEE assurance | signed digest only | verify remote attestation (enclave quote) | R3/R5 |
| PHI boundary | invariant by convention | enforced by schema lint in CI | R4/R5 |
| Settlement correctness | flat amount | allowed-amount + cost-share | R5 |
| Attester uptime | single hosted preview | graceful fallback (built) + HA/self-host path | R3 |

## 7. Sequencing

- **Now (unblocked, foundation):** R1 (plan-as-contract + eligibility) and R2 (FHIR substrate) — parallelizable; together they make "covered for this member?" real.
- **Next:** R3 rubric (runs in fallback; flips live when the Attester returns) → R4 lifecycle reshape.
- **Later:** R5 settlement/identity/compliance hardening.

The Attester being offline blocks **only** the live half of R3. Everything else proceeds today.

## 8. Open questions / decisions

- Plan representation: full benefit design **on-chain** vs. an on-chain **signed commitment** to an off-chain plan the workflow adjudicates against (gas/complexity trade-off).
- FHIR source for R2: mock server vs. a public sandbox (SMART Health IT, HAPI) vs. a real EHR integration.
- How far to follow Da Vinci literally (full PAS/CRD/DTR conformance) vs. borrow its shapes.
- Attester future: rely on the team's hosted preview (with our fallback), or stand up an HA / self-hosted TEE inference path.
- Regulatory scope: is this a decision-support tool, or making binding coverage determinations (changes the compliance bar materially).
