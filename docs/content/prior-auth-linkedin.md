# Two Questions and a Payment: Rebuilding US Prior Authorization on Rails No One Owns

*LinkedIn article — companion visuals in `docs/content/visuals/linkedin-*.png`. Cover: `linkedin-cover.png`. Figures cited in [`docs/REALITY_MAP.md`](../REALITY_MAP.md).*

---

In February 2024, ransomware operators logged into a remote-access portal at Change Healthcare. The portal was missing one control — multi-factor authentication — and that single gap was the way in. What followed was the largest outage in American healthcare history: Change is the nation's biggest claims clearinghouse, with just over half of all US commercial medical claims touching its systems. Claims stopped flowing nationwide. UnitedHealth ultimately advanced $8.9 billion in emergency loans to providers — a third of it to safety-net clinics — just to keep the lights on.

I keep coming back to that story because of what it reveals: **America already built a shared backbone for healthcare transactions. It just built it as a single company.** And when one control at that company failed, the whole country felt it.

We spent the last months building what we believe should replace it. Here's the problem, the design choices we made and why, and what runs today.

## The problem, in numbers

Prior authorization — the process where an insurer approves care before it happens — is the most manual, most resented transaction in US healthcare:

- Only **31% of prior auths are fully electronic**; 37% still run on fax, phone, and mail.
- Even the electronic ones cost **~$6 and ~11 minutes each**. Practices spend **~13 hours per physician per week** on them.
- **95% of physicians** say prior auth delays care; 26% report it caused a serious adverse event.
- In Medicare Advantage, **7.7% of requests are denied — and 80.7% of appealed denials are overturned.** The denials mostly don't survive scrutiny; the churn happens anyway.
- Administrative complexity is the single largest category of US health-system waste: roughly **$265 billion a year** (JAMA).

And the strangest part: the federal government already diagnosed the cause and prescribed the cure. CMS wrote in 2018 that provider data problems persist because every payer maintains its own siloed copy, and that *"a corrected error in a centralized database would improve directory accuracy for all."* The industry's actual version of that centralized database is Change Healthcare — the chokepoint that failed.

So the real requirement, stated plainly: **a shared source of truth that no single party owns and no single control failure can take down.** A literally centralized repository can't satisfy it. That's not a blockchain looking for a problem — that's a problem specification that reads like a datasheet.

## Why now: the dominoes fell in order

*(Visual: `linkedin-timeline.png`)*

Three things had to be true before this system could exist, and all three happened recently:

**1. Health data must move over APIs — by law.** The 21st Century Cures Act made health-data blocking illegal. Then CMS-0057-F went further: by January 2027, insurers must expose prior authorization, eligibility, and patient data over standardized FHIR APIs. This isn't a trend to bet on; it's a compliance deadline — and industry surveys suggest only about 47% of providers expect to be ready, which tells you how much room there is for whoever shows up with working rails.

**2. Money is moving to programmable rails.** The GENIUS Act gave stablecoins a federal framework, and financial institutions are moving payment and settlement onto tokenized infrastructure. Programmable money is becoming boring, regulated plumbing — which is exactly when real industries can build on it.

**3. The middleman model publicly failed.** February 2024 wasn't an argument about decentralization; it was a demonstration.

Data legally moving over APIs. Settlement moving to smart contracts. A discredited intermediary in between. Sitting between APIs and smart contracts, with no owner in the middle, is precisely what Chainlink's runtime (CRE) is built to do. The use case found its infrastructure.

## The thesis: two questions and a payment

Strip prior authorization to its essentials and it's this:

1. **Does the patient medically require this care?**
2. **Is the patient in the network, on the plan?**

If both are true, funds should release to cover the care. That's the whole transaction. Everything else — the faxes, the translation layers, the weeks of claim-remittance reconciliation — is overhead that grew around a broken substrate.

That one line dictated the architecture. Question 2 is a *rules* question over shared facts, so it belongs in smart contracts. Question 1 is answered by the clinical record itself. And the payment should be a consequence of the answers, not a separate months-long process.

## The design choices, and the why behind each

*(Visual: `linkedin-choices.png`)*

**Shared registries with no owner — because a fix should propagate.** Provider directories are more than 80% inaccurate ("ghost networks") for a structural reason: every payer maintains its own copy, so every correction fixes exactly one silo. We put network membership, member eligibility, and plan rules in shared on-chain registries. Two payers and two providers in our demo read and write the same state — a membership correction written once is instantly true for everyone. That's the CMS-prescribed "centralized repository," minus the company that can fail or rent-seek.

**FHIR and Da Vinci shapes, not custom JSON — because the mandate already chose the models.** Our intake is a FHIR ServiceRequest; eligibility mirrors FHIR Coverage; network membership mirrors the Da Vinci Plan-Net model; decisions map to the standard claim-response shapes with machine-readable denial reasons. Why invent a data model when regulation already picked one and every payer must implement it by 2027? Conforming makes us legible to the industry we're trying to serve.

**The hybrid plan: key gates on-chain, the full design pinned by hash — because authenticity beats volume.** A full insurance benefit design doesn't belong on-chain. What belongs on-chain is what gets adjudicated: is the procedure covered, does it need prior auth, what's the cap. We put those gates on-chain and committed the complete benefit document by cryptographic hash, **signed by the payer** (EIP-712). The workflow fetches the document, hashes it, and verifies it against the signed on-chain commitment before trusting a byte. Insurers can't quietly rewrite plan terms; verifying them requires no one's permission.

**Medical necessity judged from the EHR record — because that's how adjudication actually works.** Real payer medical policies are largely criteria checklists: a qualifying diagnosis, documented failed conservative therapy, supporting clinical findings. When the data comes straight from the EHR — diagnosis codes, treatment history, the physician's documentation — the record itself answers the necessity question against the plan's published criteria. In our demo case, a knee MRI qualifies because the record shows osteoarthritis, twelve physical-therapy sessions, an injection with only transient relief, and the ordering physician's letter. No black box; a criteria evaluation anyone can audit.

**Privacy as a constraint, not a feature — because this is healthcare.** No protected health information ever touches the chain. On-chain: hashes, state transitions, payout events. The clinical record travels exclusively over CRE's confidential HTTP, encrypted end-to-end — the oracle network's own nodes relay ciphertext. The workflow also re-fetches the record from the source and cross-checks the submission, because a system like this shouldn't trust its caller.

**Enforcement in the contract, not the workflow — because trust should bottom out somewhere.** The escrow contract will not release funds unless the claim is APPROVED in the on-chain decision registry. Not "the workflow checks first" — the contract *reverts*. Even a buggy or malicious orchestrator cannot pay a denied claim. When someone asks "but what if your middleware is wrong?", the answer is: the money doesn't care.

## What runs today

*(Visual: `linkedin-before-after.png`)*

The full flow is live on our demo stack: a provider submits a FHIR ServiceRequest; the signed HTTP call triggers a CRE workflow; the workflow confidentially fetches and cross-checks the clinical record, makes three smart-contract reads — in-network? on the plan? covered and under the cap? — verifies the payer-signed benefit design, evaluates necessity from the record, writes the decision on-chain, and, if approved, releases stablecoin funds from escrow to the provider. Measured results:

- Knee MRI, $850, in-network, on plan, covered → **APPROVED → PAID in 328 milliseconds**
- Not covered → **DENIED in 139 ms**, machine-readable reason attached
- Out-of-network provider → **DENIED in 139 ms**
- Lapsed coverage → **DENIED in 140 ms**

The regulatory ceiling for these decisions is 72 hours for urgent requests and 7 days for standard ones. And the claim-to-remittance cycle that takes weeks in the wild collapses into the approval itself.

An honesty note, because the healthcare industry has heard too many big claims: the $265B problem is documented; that this design recaptures it is a hypothesis we intend to keep earning with measurements, not assertions. That's why the workflow instruments its own decision latency and why every figure above traces to a primary source in our public evidence base.

## Where this goes

The 2027 mandate is coming whether the industry is ready or not, and roughly half of it isn't. The rails we built — standards-shaped intake, verifiable shared state, contract-enforced settlement — are our proposal for what "ready" should look like: not another intermediary, but infrastructure no one owns and everyone can verify.

The code, the demo, and the fully cited evidence base are public: **github.com/Darbease/EASEeHealth**

*Built on Chainlink CRE (HTTP triggers, confidential HTTP, on-chain reads/writes with decentralized consensus), Solidity/Foundry, FHIR R4 with Da Vinci profiles, and Synthea synthetic clinical data. No PHI was used; all patient data is synthetic.*
