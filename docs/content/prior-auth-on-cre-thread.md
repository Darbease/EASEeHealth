# X/Twitter thread — EASE eHealth: prior auth on Chainlink CRE

*15 tweets, each ≤280 chars. Companion to [`prior-auth-on-cre.md`](./prior-auth-on-cre.md). Figures cited in [`docs/REALITY_MAP.md`](../REALITY_MAP.md).*

---

**1/**
In Feb 2024, one missing MFA control at one company froze ~half of all US medical claims.

UnitedHealth loaned providers $8.9B just to keep clinics alive.

That company was the de-facto "shared backbone" of US healthcare.

We rebuilt it so no one owns it. 🧵

**2/**
Prior authorization today:
• 31% fully electronic; 37% still fax/phone/mail
• ~$6 + 11 minutes per request
• 13 hrs per physician per week
• 7.7% denied — and 80.7% of appealed denials get OVERTURNED

Admin waste across the system: ~$265B/yr (JAMA).

**3/**
CMS prescribed the fix in 2018: a shared central repository — "a corrected error… would improve accuracy for all."

The industry built exactly that. It became Change Healthcare: ~50% of claims through one chokepoint.

The prescribed remedy became the single point of failure.

**4/**
So the real spec is: a shared source of truth that NO single party owns and no single control failure can take down.

Regulators named the destination. A centralized intermediary structurally can't be it.

That's not blockchain-hunting-for-a-problem. That's a datasheet.

**5/**
Our thesis in one line:

Prior authorization is two questions and a payment.

"Is this care medically necessary?" — judgment over documents.
"Is it covered for this member?" — rules over shared facts.

Both yes → money moves to the provider.

**6/**
"Covered?" is deterministic → smart contracts. Three registries shared by every payer & provider:

• OrganizationRegistry — in-network? (ghost networks: >80% of directory listings are wrong)
• CoverageRegistry — eligible?
• PolicyRegistry — the plan itself, payer-signed

**7/**
The plan is hybrid:

Key gates (covered / auth-required / caps) live on-chain, adjudicated per procedure.

The full benefit design lives off-chain — pinned by keccak256 inside an EIP-712 PlanCommitment signed by the payer.

Payers can't quietly rewrite terms.

**8/**
"Necessary?" is judgment → confidential AI in a TEE, reasoning over the physician's letter.

It sits behind an adapter with deterministic fallback (verdict_source stamped honestly).

And rules run FIRST — no confidential inference spent on a claim the rules already killed.

**9/**
No PHI on-chain. Ever.

On-chain: hashes, state transitions, policy refs, payout events.

Clinical FHIR data moves only over @chainlink CRE confidential HTTP — DON nodes relay ciphertext.

**10/**
CRE is the connective tissue. ONE workflow:

HTTP trigger (signed submit) → confidential FHIR fetch + cross-check → 3 EVM reads (network, eligibility, signed plan gates) → benefit-design hash vs on-chain commitment → AI necessity → two-phase DON report writes → escrow.

**11/**
And the money can't misbehave:

ClaimEscrow.releasePayout REVERTS unless the decision registry says APPROVED.

Even a buggy or malicious orchestrator cannot pay a denied claim. Enforcement lives in the contract, not the workflow.

**12/**
Measured end-to-end (2 payers + 2 providers on ONE shared registry set):

✅ Knee MRI, $850 → APPROVED→PAID in 328ms
❌ Not covered → DENIED (bitmap 2), 139ms
❌ Out-of-network → DENIED (256), 139ms
❌ Coverage lapsed → DENIED (512), 140ms

The regulatory ceiling: 72 hours.

**13/**
Every denial carries a machine-readable reason — what CMS-0057-F requires by 2027, a deadline only ~47% of providers expect to hit.

And the claim→remittance cycle (837/835, weeks in the wild) collapses into the same transaction as the approval.

**14/**
Honesty line: the $265B gap is proven. That our design recaptures it is a hypothesis — one we earn by measuring, not asserting.

That's why the workflow instruments its own decision latency and stamps verdict_source=fallback instead of hiding it.

**15/**
Standards-shaped (FHIR R4, Da Vinci PAS/CRD/Plan-Net). Foundry + OpenZeppelin, 96 tests. Synthea clinical data.

Built on @chainlink CRE: HTTP triggers, confidential HTTP, EVM read/write with DON consensus.

Code + cited evidence base:
github.com/Darbease/EASEeHealth
