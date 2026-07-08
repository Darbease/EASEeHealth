# X/Twitter thread — EASE eHealth: prior auth on Chainlink CRE

*15 tweets, each ≤280 chars. Arc: CRE could solve one of American healthcare's biggest problems — the dominoes falling (health-data-over-APIs law, finance moving to stablecoins/smart contracts) → the two-questions thesis → the prior-auth problem and today's flow → how CRE fixes it. Figures cited in [`docs/REALITY_MAP.md`](../REALITY_MAP.md).*

---

**1/**
Chainlink CRE could be used to solve one of the biggest problems in American healthcare.

Not a toy demo — the actual $265B/yr problem.

But a few dominoes had to fall first. They're falling now. 🧵

**2/**
Domino 1: the data.

The 21st Century Cures Act made blocking health data illegal. Then CMS-0057-F went further: by Jan 2027, insurers MUST expose prior auth, eligibility, and patient data over standard FHIR APIs.

Health data moving over APIs isn't a trend. It's signed law.

**3/**
Domino 2: the money.

The GENIUS Act gave stablecoins a federal framework, and financial institutions are moving payment and settlement onto tokenized rails and smart contracts.

Programmable money is becoming boring, regulated infrastructure.

**4/**
Domino 3: the middleman already failed.

~50% of US medical claims flow through ONE clearinghouse. In Feb 2024, a single missing MFA control there froze the nation's claims — $8.9B in emergency loans to keep clinics alive.

The industry is actively looking for what's next.

**5/**
So: health data legally must move over APIs. Money is moving to smart contracts. And the centralized middleman is a proven single point of failure.

Sitting between APIs and smart contracts, with no owner in the middle, is exactly what CRE is.

The use case: prior authorization.

**6/**
Healthcare payments should be two questions:

1. Does the patient medically require this care?
2. Is the patient in the network, on the plan?

If both are true, funds should release to cover the care. That's the whole transaction.

Everything else is overhead.

**7/**
Prior auth is how insurers approve care before it happens — and it's brutal:

• 37% still runs on fax/phone/mail
• ~$6 + 11 minutes per request
• ~13 hrs per physician per week
• 7.7% denied, yet 80.7% of appealed denials get OVERTURNED

95% of doctors say it delays care.

**8/**
How it works today:

The doctor's EHR sends a request → a clearinghouse translates it into a 1990s EDI format (X12 278) → the payer's system → back through the middleman again. Days to weeks.

And every payer keeps its own private copy of plans, eligibility, and directories.

**9/**
How we rebuilt it: the shared facts move on-chain, and @chainlink CRE sits in the middle of the API calls instead of a clearinghouse.

Provider submits a FHIR ServiceRequest (the exact shape the 2027 mandate requires) → the signed HTTP call triggers a CRE workflow directly.

**10/**
First, CRE re-fetches the clinical record over confidential HTTP and cross-checks the submission against the source.

Patient data stays encrypted end-to-end — DON nodes relay ciphertext.

No PHI ever touches the chain. Only hashes, states, and payouts do.

**11/**
Then CRE checks the smart contracts — three reads against shared registries:

• OrganizationRegistry: is this provider in-network for the plan?
• CoverageRegistry: is this patient actually ON the plan, right now?
• PolicyRegistry: is the procedure covered, under the cap?

**12/**
Those aren't our rules — they're the insurer's.

Each plan's gates live on-chain, signed by the payer (EIP-712), with the full benefit design pinned by hash. One judgment call remains — medical necessity — handled by a confidential AI in a TEE reading the physician's letter.

**13/**
The decision is written on-chain via DON-signed reports. If APPROVED, stablecoin funds release from escrow to the provider in the same flow.

The escrow contract enforces the gate itself: releasePayout REVERTS unless the claim is APPROVED on-chain.

A denied claim cannot be paid.

**14/**
Measured, end-to-end:

Knee MRI, $850, in-network, on plan, covered → APPROVED → PAID in 328ms.
Not covered / out-of-network / not on plan → DENIED in ~140ms, each with a machine-readable reason.

The regulatory ceiling for these decisions: 72 hours.

**15/**
The dominoes: data must move over APIs by 2027 (only ~47% of providers will be ready). Money is moving on-chain. The middleman failed.

CRE connects all three: FHIR APIs in, smart-contract verification, stablecoin settlement out.

Code + evidence: github.com/Darbease/EASEeHealth
