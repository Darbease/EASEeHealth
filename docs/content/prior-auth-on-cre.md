# One Missing MFA Control Froze Half of America's Medical Claims. We Rebuilt the Backbone It Broke — on Chainlink CRE.

*How EASE eHealth turns a prior authorization — the most manual, most hated transaction in US healthcare — into a sub-second, verifiable, payer-signed decision with instant settlement. A build story in three parts: the evidence, the design choices, and what actually runs.*

---

## Part 1: The reality nobody designed

In February 2024, ransomware operators logged into a Citrix remote-access portal at Change Healthcare. The portal had no multi-factor authentication — sworn CEO testimony before the Senate Finance Committee confirmed that single missing control was the way in. What followed was the largest outage in US healthcare history: Change is the nation's biggest EDI clearinghouse, and **just over 50% of all US commercial medical claims "touch" it** (a figure confirmed judicially, in the 2022 *US v. UnitedHealth/Change* opinion). Claims stopped flowing nationwide. UnitedHealth ended up advancing **$8.9 billion in emergency loans** to providers — a third of it to safety-net clinics — just to keep the lights on.

Hold that image, because it's the key to everything that follows: **the US already built a shared backbone for payer↔provider transactions. It just built it as a single company.**

The rest of the picture, from primary sources (every figure below is cited in our [reality map](../REALITY_MAP.md), assembled from HL7, X12, CMS, DOJ filings, SEC filings, JAMA, CAQH, and the Senate Finance Committee):

- Prior authorization runs on the **X12 278** EDI transaction. HL7's modern FHIR standards (Da Vinci CRD/DTR/PAS) don't replace it — a clearinghouse **translates FHIR into X12 and back** in the middle.
- It's barely automated: only **31% of prior auths are fully electronic**; 37% are still fax, phone, and mail. Even the electronic ones cost **~$6 and ~11 minutes each**. Practices burn **~13 hours per physician per week** on this.
- It's harmful: 95% of physicians report care delays; **26% report a prior-auth-caused serious adverse event** (2025 AMA survey).
- It's arbitrary: Medicare Advantage 2024 saw ~53M requests, 7.7% denied — and **80.7% of appealed denials were overturned**. The denials mostly don't survive scrutiny; the system churns anyway.
- It's expensive at civilizational scale: administrative complexity is the single largest domain of US health-system waste — **~$265.6 billion per year** (Shrank et al., *JAMA* 2019).

And here's the part that shaped our whole design. CMS itself, back in 2018, diagnosed the root cause and prescribed the cure:

> *"…a centralized repository for provider data is a key component missing from the accurate provider directory equation… a corrected error in a centralized database would improve directory accuracy for all MAOs using that system."* — CMS, 2018

The industry's actual attempt at that "centralized repository" is Change Healthcare. The prescribed remedy, literally implemented, **became the chokepoint that failed**. That's the gap: healthcare needs a *shared source of truth that no single party owns and no single control failure can take down*. Federal regulators have named the destination; a centralized intermediary structurally can't be it.

That is not a blockchain looking for a problem. That is a problem specification that reads like a blockchain's datasheet.

## Part 2: The design choices (and why)

Our thesis compresses to one line:

> **Prior authorization is two questions and a payment.** *"Is this care medically necessary?"* and *"Is it covered for this member?"* — and if both are yes, money moves to the provider.

Every architectural choice falls out of taking that line seriously.

### "Covered?" is a rules question → smart contracts

Coverage is deterministic: is the provider in-network, is the member enrolled, is the procedure covered, is the amount under the cap. Rules over shared facts — exactly what verifiable shared state is for. Three registries on one chain:

| Contract | Real-world analog | Gap it closes |
|---|---|---|
| `OrganizationRegistry` | Da Vinci Plan-Net `OrganizationAffiliation` | Ghost networks: **>80% of directory listings inaccurate** because each payer maintains its own siloed copy. Here, two payers read one registry — a fix written once propagates to all. |
| `CoverageRegistry` | FHIR `Coverage` / eligibility (270/271) | Eligibility checks are ~94% electronic yet still the **single largest savings opportunity ($9.8B)** — because everyone re-asks everyone, constantly. Here it's one indexed read. |
| `PolicyRegistry` | Da Vinci CRD coverage rules + the plan itself | Plan rules are opaque and per-payer. Here the plan is **payer-signed and its gates are readable by anyone adjudicating against it**. |

**Design choice — the hybrid plan.** We didn't put the whole benefit design on-chain, and we didn't leave it as an off-chain PDF. The key gates (covered / prior-auth-required / amount cap, per procedure) live on-chain where the workflow adjudicates against them. The *full* benefit design is a JSON document served off-chain — but pinned on-chain by its keccak256 hash inside an **EIP-712 `PlanCommitment` signed by the payer's registered key**:

```
PlanCommitment(bytes32 policyHash, bytes32 benefitDesignHash,
               uint64 effectiveFrom, uint64 effectiveTo)
```

The workflow fetches the document, hashes it, and compares against the signed on-chain commitment before trusting a byte of it. Payers can't quietly rewrite plan terms; verifiers don't need the payer's cooperation to check them. Gas stays sane.

**Design choice — standards shapes, not custom JSON.** CMS-0057-F mandates FHIR prior-auth APIs by January 2027 (and only ~47% of providers expect to make it — that's the market opening). We shaped everything to the real models: intake is a FHIR R4 `ServiceRequest` (Da Vinci PAS-style), eligibility mirrors `CoverageEligibilityResponse`, network membership mirrors Plan-Net, decisions map to `ClaimResponse` reviewActions with machine-readable denial reasons. Pinned to published STU versions, not the moving CI build. A payer integrating with this recognizes every shape.

### "Necessary?" is a judgment question → confidential AI, behind a seam

Medical necessity is a clinical judgment over documents — a physician's letter arguing that four months of failed conservative therapy plus a positive McMurray sign justifies a knee MRI. That's not a rules engine's job. It's an LLM-in-a-TEE's job: the **Confidential AI Attester** reasons over the letter privately and returns a signed verdict.

**Design choice — the fallback seam.** The Attester is a gated dev preview; it's offline outside hackathon windows. So the necessity step lives behind an adapter (`attester-proof-adapter`) that calls the TEE when it's live and **falls back to deterministic predicate evaluation when it isn't** — reporting `verdict_source: "fallback"` honestly all the way to the workflow output. The system is AI-ready, never AI-blocked. (Fail-open on attester outage is a deliberate, documented product decision — flagged for revisiting, not buried.)

**Design choice — rules first.** The deterministic coverage rules run before the necessity step. A claim that's out-of-network or not covered is denied without ever invoking the AI — mirroring how real adjudication sequences, and never spending a confidential inference on a claim the rules already killed.

### Privacy is a constraint, not a feature

**No PHI on-chain, ever.** On-chain you'll find hashes, state transitions, policy references, and payout events. Member IDs are keccak256 of an opaque identifier. The FHIR resources — the actual clinical data — travel exclusively over CRE **confidential HTTP** with AES-GCM output encryption, so even DON nodes relay ciphertext.

## Part 3: What actually runs — CRE as the connective tissue

Everything above needs an orchestrator that can (a) fire on a signed request, (b) fetch sensitive data confidentially, (c) read and write chain state with DON consensus, and (d) not be itself a trusted middleman. That's Chainlink CRE's exact shape. **WF-010**, the consolidated decision workflow, is one HTTP-triggered program compiled to isolated WASM:

```
0. HTTP trigger        — signed fhir-submit payload from provider-adapter-api
1. Confidential HTTP   — re-fetch ServiceRequest + Coverage from the FHIR source;
                         cross-check them against the submission (don't trust the caller)
2. EVM read            — OrganizationRegistry.isInNetwork(provider, plan, now)
3. EVM read            — CoverageRegistry.isEligible(member, plan, now)
4. EVM read            — PolicyRegistry.checkCoverage(plan, procedure, amount, now)
                         → (ok, reasonBitmap, authRequired) against payer-signed gates
5. HTTP + consensus    — fetch the benefit design; keccak256 it; verify against the
                         on-chain EIP-712 PlanCommitment
6. Confidential HTTP   — medical necessity via the attester adapter (rules passed)
7. EVM write (report)  — submitClaim + setProofResult (two-phase DON report)
8. EVM write (report)  — if APPROVED: schedulePayout → releasePayout → markPaid
9. Confidential HTTP   — decision callback to the provider
```

The write path uses CRE's two-phase report pattern — the DON signs the calldata as a consensus report before it ever touches the chain:

```ts
const report = runtime.report(prepareReportRequest(calldata)).result();
evmClient.writeReport(runtime, { receiver, report, gasConfig: { gasLimit: "500000" } });
```

And the settlement layer enforces the decision *in the contract, not in the workflow*: `ClaimEscrow.releasePayout` reverts unless `ClaimDecisionRegistry.isApproved(claimId)` is true. Even a buggy or malicious orchestrator cannot move money for a denied claim.

### The measured result

Four deterministic fixtures, run end-to-end on the demo stack (`make demo-v1`), Synthea-derived FHIR data, two payers and two providers sharing one set of registries:

| Scenario | Decision | Reason bitmap | Latency |
|---|---|---|---|
| Knee MRI, in-network, eligible, covered, $850 | **APPROVED → PAID** | 0 | **328 ms** |
| Acupuncture — plan doesn't cover it | DENIED | 2 (not covered) | 139 ms |
| Same MRI, out-of-network provider | DENIED | 256 (out-of-network) | 139 ms |
| Same MRI, member's coverage lapsed | DENIED | 512 (ineligible) | 140 ms |

On the approved claim, exactly 850 USDC (6-decimal mock) lands in the provider's treasury and the claim reaches the terminal `PAID` state. On the denied claims, payout attempts revert with `ClaimEscrow: claim not approved`. Every denial carries a machine-readable reason — the thing CMS-0057-F now requires and today's system mostly fails to deliver. 96 Foundry tests (unit + fuzz + invariant) cover the state machine, the gates, the signatures, and the windows.

Against the incumbent backbone: **the regulation's ceiling is 72 hours for urgent requests and 7 days for standard ones. This decides — with reasons, with a payer-signed rule base, with settlement — in under a third of a second**, and the claim-to-remittance cycle (837→835, weeks in the wild) collapses into the same transaction as the approval.

### An honesty line

The evidence proves the gaps are real and quantified. It does **not** yet prove this design recaptures the $265B — that's a hypothesis the gap data supports, which we earn by measuring, not asserting. That's why the workflow instruments its own decision latency, why `verdict_source: fallback` is stamped on-chain-adjacent rather than hidden, and why the demo's before/after contrast cites its sources. What we can already claim: the prescribed remedy — a shared, interoperable source of truth for plans, eligibility, and networks — runs today, without the single owner whose one missing MFA control can freeze it.

### What's next

Live TEE inference through the same adapter seam the moment the Attester returns; structured clinical rubrics instead of a boolean verdict; allowed-amount and cost-share math in settlement; the appeal/challenge flow surfaced (the state machine already supports it); and the org data-sharing agreement graph as the next pillar.

---

*EASE eHealth is built on Chainlink CRE (HTTP triggers, confidential HTTP, EVM read/write with DON reports), Foundry/Solidity 0.8.24 with OpenZeppelin AccessControl, FHIR R4 with Da Vinci PAS/CRD/Plan-Net shapes, and Synthea synthetic clinical data. Code: [github.com/Darbease/EASEeHealth](https://github.com/Darbease/EASEeHealth) (branch `feat/mvp-v1`). Evidence base with full citations: [`docs/REALITY_MAP.md`](../REALITY_MAP.md). Run it: `make demo-v1`.*
