# EASE eHealth — Reality Map: how the US payer↔provider backbone actually works (and where it's broken)

**Status:** Validated evidence base · **Date:** 2026-06-30
**Method:** two adversarially-verified deep-research passes (49 sources fetched, ~240 claims extracted, 50 verified via 3-vote refutation, 20 surviving after synthesis). Primary/authoritative sources prioritized (HL7, X12, CMS, DOJ/court filings, SEC filings, JAMA/Health Affairs, CAQH, KFF, Senate Finance, AMA). Confidence + caveats flagged per claim.
**Purpose:** validate/correct our system model and ground the "where their systems have gaps and why connecting them is an efficiency gain" positioning in cited fact, not assumption.

---

## 1. The real prior-auth flow — legacy EDI with a FHIR wrapper, via an intermediary

- Prior auth runs on the **X12 278** transaction (+ 275 attachments) — the HIPAA-named standard *(x12.org; CMS 278 Companion Guide)*.
- **HL7 Da Vinci (CRD → DTR → PAS) does not replace X12 — it wraps it.** A provider/EHR sends FHIR; a **clearinghouse/intermediary converts the FHIR bundle into X12 278** for the payer and converts the 278 response back to FHIR *(HL7 Da Vinci PAS/CRD IGs, verbatim)*. **CRD** = "is PA required + rules + alternatives + documentation," surfaced in the EHR at point of care (provider-pull via CDS Hooks); **DTR** = payer's structured documentation forms; **PAS** = the submission.
- It's mostly **not automated**: only **31% of PAs are fully electronic**, 32% portal/IVR, **37% fully manual** (fax/phone/mail); even electronic PA costs **~$6 and ~11 min** each *(2023 CAQH Index)*. Practices spend **~13 hrs/week**, ~40 PAs per physician/week; **phone is the most common method** *(2025 AMA survey, n=1,000)*.
- Harm is quantified: **95%** of physicians report care delays; **26%** report a PA-caused *serious adverse event* *(2025 AMA; corroborated AHA)*.
- Reversible-denial churn: Medicare Advantage 2024 saw **~53M PA requests, 7.7% denied, but 80.7% of appealed denials overturned** *(KFF / CMS CY2024 data)*.
- **Regulatory trajectory:** **CMS-0057-F** mandates a FHIR Prior Authorization API + Patient/Provider/Payer-to-Payer Access APIs, **72-hour (urgent)/7-day (standard)** decisions, specific denial reasons, and public metrics. Operational rules **effective Jan 1 2026**; APIs by **Jan 1 2027**. FHIR R4 is the base standard; Da Vinci is "strongly encouraged"; HHS enforcement discretion lets payers go **FHIR-only** *(CMS fact sheet / NSG letter)*.

## 2. Concentration & fragility — the intermediary layer is a chokepoint

- **Change Healthcare** (now Optum Insight / UnitedHealth) runs the **nation's largest EDI clearinghouse** — ~14B transactions/yr, connecting ~5,500 hospitals, 900,000 physicians, 2,400 insurers — and **just over 50% of all US commercial medical claims "touch" it** (*judicially confirmed*, Sept 21 2022 Memorandum Opinion, US v. UnitedHealth/Change). **>95%** of medical claims flow through clearinghouses generally; McKinsey (United's own consultant) found Change connects to **>70%** of all payers/providers/pharmacies/physician orgs.
- **Feb 2024 ransomware attack** — the flagship fragility case: entry via **a single Citrix remote-access portal that lacked MFA** *(sworn CEO testimony, Senate Finance)* cascaded into a nationwide outage of a clearinghouse touching ~50% of commercial claims.
- **Financial blast radius** *(SEC-audited filings + CEO testimony)*: UnitedHealth advanced **$8.904B** in provider loans through 9 months of 2024 (**34% to safety-net** providers/FQHCs), only **$3.189B repaid** by Sept 30 2024; UHG booked **$2.457B** in cyberattack impacts through 9M 2024, **~$2.87B** projected full-year. Change payment processing = **~6% of all US health-system payments**; still only **~86% recovered** ~10 weeks later.
- Claims-editing concentration: the proposed merger would have been **>80% first-pass claims editing**; ClaimsXten ~70% alone (served 38 of the top 40 insurers) — severe enough the court forced its divestiture. *(Medium confidence; distinct market from the clearinghouse; don't conflate.)*

## 3. Fragmentation, duplication & administrative waste

- **Administrative complexity is the single largest domain of US health-system waste — ~$265.6B/yr, ~$248B of it billing-and-coding** *(Shrank et al., JAMA 2019)*. CAQH: **~$400B (~10% of NHE)** is administrative complexity; **$89B** on the nine tracked transactions; **$18.3B immediately savable** by moving remaining manual/partial transactions to fully electronic *(2023 CAQH Index)*.
- The **manual tail is disproportionately expensive even where standards exist**: eligibility (270/271) is the single largest automation savings opportunity (**$9.8B**) despite **~94% electronic** adoption; PA is the least automated (31%/37%).
- The US is a **global BIR outlier**: billing cost per inpatient surgical bill = **$215 (US) vs $6 (Canada)** — ~36× — driven by coding (**$172/bill US vs $16 Netherlands**) *(Health Affairs 2022; JAMA 2018 Duke micro-costing)*.
- **Provider directories are >80% inaccurate ("ghost networks")**: Senate Finance 2023 secret-shopper found **>80%** of listed in-network mental-health providers were "ghosts" (appointments bookable only **18%** of the time); CMS Round 3 review found **48.74%** of locations had ≥1 inaccuracy and providers **should not have been listed at 33.14%** of locations. Root cause: **each payer maintains its own siloed copy**.

## 4. The named remedy — the positioning payload

The most important finding: **primary federal and peer-reviewed sources diagnose fragmentation/duplication as the cause and explicitly prescribe a centralized, interoperable, shared data backbone as the fix.**

> **CMS (2018):** *"a centralized repository for provider data is a key component missing from the accurate provider directory equation… when an MAO identifies a directory error, it is fixed only for their own directory, whereas a corrected error in a centralized database would improve directory accuracy for all MAOs using that system."*
>
> **Shrank et al. (JAMA 2019):** administrative complexity stems *"from fragmentation"*; proposals *"to foster data interoperability… will hopefully alleviate some burden as information flows more freely and billing and authorization processes become more automated."*

**Our twist (and the whole thesis):** the prescribed remedy — a shared source of truth — is exactly what Change Healthcare *became*, and its centralization is precisely why one missing MFA control froze ~50% of US claims. A *literally* centralized repository just recreates that chokepoint. **A verifiable, shared-but-unowned source of truth (on-chain plan/eligibility/network state) delivers the shared-truth benefit the sources call for while avoiding the single-point-of-control/failure the same sources decry.** That is the gap only a verifiable-distributed approach fills.

## 5. Reconciliation — our current mock vs. reality

| Real-world touchpoint | Our model today | Verdict / action |
|---|---|---|
| Patient/clinical data | Synthea | ✅ plausible (FHIR regen planned) |
| PA request (X12 278 / Da Vinci **PAS**) | custom `/prior-auth/submit` JSON | ❌ reshape as FHIR `ServiceRequest`/PAS |
| Coverage discovery (**CRD**: PA required? rules?) | not modeled | ❌ missing — *is* our plan-as-contract |
| Eligibility (270/271) | "consent active" proxy | ❌ missing — `CoverageRegistry` (FHIR `Coverage`) |
| Provider network / in-network | not modeled | ❌ missing — `OrganizationRegistry` (minimal) |
| Clearinghouse FHIR↔X12 intermediary | not modeled (direct) | ⚠️ **intentionally removed** — the differentiator |
| Claim → remittance (837/835) | instant escrow | ⚠️ **intentionally collapsed** — strong contrast |
| Decision timeline | instant | ✅ trivially beats the 72hr/7-day mandate |
| Denial + reason + appeal | state machine + `challengeClaim` | ✅ present; real world churns 80.7%-overturned denials |
| Shared source of truth for plan/eligibility/network | our on-chain registries | ✅ **the thesis** — the "centralized repository" without the chokepoint |

**Read:** we model the *decision + settlement* end well; we under-model the *front of the flow* (coverage discovery, eligibility, PA-request shape, network) — which is exactly M1/M2, and the evidence says to shape that work as **Da Vinci CRD + FHIR Coverage + PAS**, not custom JSON.

## 6. Positioning — gap → our angle (evidence-backed)

| Verified gap | Figure | Our angle |
|---|---|---|
| Manual / slow / costly | 31% e-PA; ~$6 & ~11 min; 13 hrs/wk | instant, automated, standards-shaped decisions |
| Intermediary chokepoint + fragility | Change touches ~50% of claims; one MFA gap → $8.9B provider loans | verifiable shared state, no single-owner intermediary to translate or fail |
| Fragmentation waste | ~$265.6B/yr admin; $18.3B immediately savable | one shared source of truth removes per-payer duplication + reconciliation |
| Ghost networks | >80% inaccurate; 33% shouldn't be listed | shared network/eligibility state; a fix propagates to all |
| Reversible-denial churn | 7.7% denied, 80.7% overturned | rule-based adjudication vs a *signed* plan + attested necessity + auditable reasons |
| Regulatory pressure | CMS-0057-F: FHIR APIs, 72hr/7-day, by 2027 | we're aligned with / ahead of the mandate |

**Honesty line (do not overclaim):** the evidence *robustly proves the gaps are real and quantified*. It does **not** prove our specific design delivers the gain — that is a hypothesis the gap data supports **indirectly**. We earn the "efficiency gain" claim by building it and measuring, not by assertion.

## 7. Still unverified (open — do not assert as fact)

- **CMS-0057-F / TEFCA / QHIN real adoption** (production FHIR-API and nationwide-exchange volume ahead of 2027) — **area 4 is entirely unverified** across both passes; needs a dedicated pass to harden the "future-state" half.
- **Change Healthcare attack-scale specifics** — individuals breached (a widely-circulated ~190M figure appeared in one source but did not survive verification) and ransom paid — not confirmed here.
- **Availity's share** and the **current (2025-26) post-attack Change footprint** (many providers diversified clearinghouses after Feb 2024) — the ~50% figure is a 2022 commercial-claims "touch" metric.
- Named payers'/EHR vendors' internal architecture (Epic/Oracle Cerner, payer core admin systems) — not publicly detailed.

## 8. Implications for the build

1. **Shape M1/M2 to the standard, not to custom JSON:** submit = FHIR `ServiceRequest` (PAS-shaped); coverage discovery = CRD = our on-chain plan-as-contract; eligibility = FHIR `Coverage`; network = `OrganizationRegistry`.
2. **Make the thesis explicit in the demo:** a verifiable shared source of truth for plan/eligibility/network that *removes the FHIR↔X12 intermediary translation* and *collapses the claim→remit cycle into instant settlement* — the "centralized backbone" CMS/JAMA prescribe, without the Change-Healthcare chokepoint.
3. **Instrument for the efficiency claim:** capture decision latency, manual-touch count, and reconciliation steps eliminated, so the "gain" is measured, not asserted.

## 9. Implementation models validated + adoption reality (pass 3 + direct spec fetches)

The concrete FHIR/Da Vinci models we build to are now confirmed (the operational detail lives in `MVP_BUILD_PLAN.md` → *Standards conformance*):

- **Da Vinci PAS** (prior-auth request/response) and **CRD/DTR** (coverage rules) — verified *verbatim* against the HL7 IG machine-readable `StructureDefinition`/`OperationDefinition` JSON. PA request = `PASClaim` (Claim, `use`=preauthorization); decision = `PASClaimResponse` with the `reviewAction` extension (approve/deny/pend + reason, bound to X12 278 HCR01) and `preAuthRef`/`preAuthPeriod`. Coverage rules = CRD `ext-coverage-information` (`covered` / `pa-needed` / `doc-needed`).
- **Eligibility** = `CoverageEligibilityResponse` (`insurance.inforce`+`benefitPeriod`, `item.authorizationRequired`, `item.network`, `item.benefit`) + `Coverage`. **Network** = Da Vinci **Plan-Net** `OrganizationAffiliation`/`PractitionerRole` with a `network` reference (Network = a constrained `Organization`; `InsurancePlan`→networks). **CMS-0057 basis:** required = FHIR R4 + US Core + SMART/OAuth2 + Bulk Data; Da Vinci PAS/CRD/DTR/PDex/Plan-Net are *strongly encouraged, not mandated*.
- **⚠ Version-pin caveat:** the CI `build.fhir.org` details are a moving target (codes/invariants/paths differ across versions) — pin to a published STU (PAS/CRD/DTR **STU 2.1**, US Core) at implementation.

**Adoption reality (closes most of §7's open items):** WEDI (Dec 2025 survey) — only **~47% of providers** confident of meeting the Jan 2027 API deadline (**down 22 pts** from 69%); **~38% of payers plan FHIR-only vs. ~38% FHIR+X12**, and **57% of clearinghouses** plan dual. Read: the mandated future-state is uncertain and the **X12/intermediary layer persists** — reinforcing the opening. *(Still thin: designated-QHIN production exchange volumes; the Change attack's individuals-breached/ransom specifics.)*

## Key sources
X12.org (278); HL7 Da Vinci CRD/DTR/PAS IGs; CMS-0057-F fact sheet + NSG enforcement letter; 2023 CAQH Index; 2025 AMA Prior Authorization Survey; KFF (MA 2024 PA data); US v. UnitedHealth/Change (DOJ complaint + Sept 2022 court opinion); NY AG merger suit; Sen. Finance Witty testimony; UHG SEC Q3-2024 filing; Shrank et al. JAMA 2019; Tseng et al. JAMA 2018; Richman/Kaplan Health Affairs 2022; Senate Finance 2023 ghost-network study; CMS Round 3 provider-directory review (2018).
