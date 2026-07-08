# X/Twitter thread — EASE eHealth: prior auth on Chainlink CRE

*12 tweets, each ≤280 chars. Arc: the problem → how it works today → CRE in the middle of the API calls → smart-contract verification (patient on plan) → funds release. Figures cited in [`docs/REALITY_MAP.md`](../REALITY_MAP.md).*

---

**1/**
US doctors spend ~13 hours a week asking insurers for permission to treat their patients.

Prior authorization: 37% still happens by fax/phone/mail. ~$6 and 11 minutes per request. 7.7% denied — and 80.7% of appealed denials get overturned.

We automated it end-to-end. 🧵

**2/**
How it works today: the doctor's EHR sends a request → a clearinghouse translates it into a 1990s EDI format (X12 278) → the payer's system → back through the middleman again.

And every payer keeps its own private copy of plans, eligibility, and network directories.

**3/**
That middleman layer is so concentrated that ~50% of US claims flow through ONE company.

In Feb 2024, a single missing MFA control there froze the nation's claims. $8.9B in emergency loans to keep clinics open.

A shared backbone — built as a single point of failure.

**4/**
Our version: the shared facts move on-chain, and @chainlink CRE sits in the middle of the API calls instead of a clearinghouse.

No translation layer. No owner. Every payer and provider reads and writes the same verifiable state.

**5/**
The flow: a provider submits the prior-auth request as a FHIR ServiceRequest — the same shape CMS mandates payers support by 2027.

That signed HTTP call triggers a CRE workflow directly. No cron. No queue. No intermediary inbox.

**6/**
First, CRE re-fetches the clinical record over confidential HTTP and cross-checks the submission against the source.

Patient data stays encrypted end-to-end — DON nodes relay ciphertext.

No PHI ever touches the chain. Only hashes, states, and payouts do.

**7/**
Then CRE checks the smart contracts — three reads against the shared registries:

• OrganizationRegistry: is this provider in-network for the plan?
• CoverageRegistry: is this patient actually ON the plan, right now?
• PolicyRegistry: is the procedure covered, under the cap?

**8/**
Those aren't our rules — they're the payer's.

Each plan's gates live on-chain, signed by the payer (EIP-712), with the full benefit design pinned by keccak256 hash. CRE verifies the served document against the signed commitment before trusting a byte of it.

**9/**
If the rules pass, one judgment call remains: medical necessity.

CRE sends the physician's letter to a confidential AI in a TEE over encrypted HTTP; it returns a signed verdict.

(Deterministic fallback when the TEE is offline — stamped honestly as verdict_source: fallback.)

**10/**
The decision is written on-chain via DON-signed reports. If APPROVED, funds release from escrow to the provider in the same flow.

The escrow contract enforces the gate itself: releasePayout REVERTS unless the claim is APPROVED on-chain.

A denied claim cannot be paid. Period.

**11/**
Measured results:

Knee MRI, $850, in-network, patient on plan, covered → APPROVED → PAID in 328ms.
Not covered / out-of-network / not on the plan → DENIED in ~140ms, each with a machine-readable reason.

The regulatory ceiling for these decisions: 72 hours.

**12/**
The claim→remittance cycle that takes weeks today (837/835) collapses into the approval itself.

FHIR R4 + Da Vinci shapes. Foundry contracts, 96 tests. @chainlink CRE: HTTP triggers, confidential HTTP, EVM reads/writes with DON consensus.

Code: github.com/Darbease/EASEeHealth
