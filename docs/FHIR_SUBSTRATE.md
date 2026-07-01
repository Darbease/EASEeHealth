# FHIR R4 Substrate (M1)

The v1 MVP replaces the CSV-shaped EHR surface with a FHIR R4 substrate served
by `provider-adapter-api` (port **3005**). Resources are generated
deterministically from the synthetic Synthea CSVs and demo fixtures; the
prior-auth entry point is a PAS-shaped `ServiceRequest` submission.

The legacy `/v1/ehr/*` endpoints remain live — WF-001..009 still depend on
them.

## Regenerating the store

```bash
make fhir-regen          # = node scripts/synthea-to-fhir.mjs
```

The script reads `data/synthea/*.csv` and writes **one JSON file per
resource** to `data/fhir/<ResourceType>/<id>.json`. Output is fully
deterministic — ids derive from the CSV ids (Condition/Procedure rows have no
CSV id, so theirs derive from `<code>-<patient uuid segment>` with a stable
collision counter), and no timestamps or random values are generated. The
output directory is wiped and rebuilt on each run.

Resource types emitted: `Patient`, `Coverage`, `Condition`, `Procedure`,
`ServiceRequest`, `DocumentReference`. Shapes borrow from US Core / Da Vinci
PAS (references + codings with `system`/`code`/`display`), not full
conformance (per `docs/MVP_BUILD_PLAN.md` § Standards conformance).

`provider-adapter-api` loads the store once at startup — restart the service
after a regen.

## Endpoints

### `GET /fhir/r4/{ResourceType}/{id}` — read

```bash
curl http://localhost:3005/fhir/r4/Patient/c1d2e3f4-0001-4000-8000-000000000001
curl http://localhost:3005/fhir/r4/Coverage/cov-e1f2a3b4-0001-4000-8000-000000000001
curl http://localhost:3005/fhir/r4/ServiceRequest/sr-knee-mri-0001
```

Missing resource or unsupported type → `404` with a FHIR `OperationOutcome`:

```json
{ "resourceType": "OperationOutcome",
  "issue": [{ "severity": "error", "code": "not-found", "diagnostics": "Patient/nope not found" }] }
```

### `GET /fhir/r4/{ResourceType}?patient={patientId}` — search

Returns a FHIR `searchset` Bundle. The `patient` param matches
`subject`/`beneficiary`/`patient` references (or the Patient's own id).
Omitting `patient` returns all resources of the type.

```bash
curl "http://localhost:3005/fhir/r4/Condition?patient=c1d2e3f4-0001-4000-8000-000000000001"
# → { "resourceType": "Bundle", "type": "searchset", "total": 2, "entry": [...] }
```

### `GET /fhir/r4/DocumentReference/{id}/$content` — letter content

Serves the raw medical-necessity letter (`text/markdown`) behind a
`DocumentReference`. The resource's `content[0].attachment.url` points here.
Resolution: the DocumentReference carries an `identifier` in system
`https://ease-ehealth.example/necessity-letter` whose value names the letter
file `data/necessity-letters/<value>.md` — the same letters-by-key convention
the attester-proof-adapter uses.

```bash
curl "http://localhost:3005/fhir/r4/DocumentReference/dr-knee-mri-0001/\$content"
# → contents of data/necessity-letters/PROC_KNEE_MRI.md
```

### `POST /v1/prior-auth/fhir-submit` — PAS-shaped submission

Body is either a pointer to a stored fixture:

```json
{ "serviceRequestId": "sr-knee-mri-0001", "correlation_id": "demo-0001" }
```

or a full FHIR **Bundle** containing a `ServiceRequest` (PAS shape; bundle
entries win over the store when resolving references). `correlation_id` is
optional — one is derived from the request when absent.

The endpoint resolves ServiceRequest → Patient, Coverage, provider org, CPT
code, requested amount, planHash (from `Coverage.class`), memberId
(`Coverage.subscriberId`), and the supporting DocumentReference, then returns
**202** with the flat *decision request* payload the CRE workflow consumes:

```json
{
  "correlation_id": "demo-0001",
  "service_request_id": "sr-knee-mri-0001",
  "patient_id": "c1d2e3f4-0001-4000-8000-000000000001",
  "member_id": "e1f2a3b4-0001-4000-8000-000000000001",
  "plan_hash": "0xa1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1",
  "payer_org_id": "a1b2c3d4-1001-4000-8000-000000000001",
  "provider_org_id": "b1a2c3d4-0002-4000-8000-000000000002",
  "procedure_code": "73721",
  "amount_usdc": 850000000,
  "service_date": "2026-07-15",
  "document_reference_id": "dr-knee-mri-0001",
  "letter_url": "/fhir/r4/DocumentReference/dr-knee-mri-0001/$content"
}
```

`amount_usdc` is an integer in USDC 6-decimal minor units (USD 850.00 →
`850000000`), taken from the ServiceRequest extension
`https://ease-ehealth.example/fhir/StructureDefinition/requested-amount`
(`valueMoney`, USD). `document_reference_id`/`letter_url` are `null` when the
request has no supporting letter.

### `GET /v1/prior-auth/submissions/{correlationId}`

Returns the stored decision-request payload for a prior `fhir-submit`
(in-memory, demo-scale). `404` if unknown.

## Coverage → on-chain plan bridge

Each `Coverage` built from `data/synthea/payer_transitions.csv` maps:
beneficiary → `Patient`, payor → payer `Organization`, `subscriberId` = the
CSV **Member ID**, `period` = `Start_Year-01-01`..`End_Year-12-31`, `status` =
`active`. Coverage id = `cov-<Member ID>`.

When the payer has an on-chain plan, the Coverage carries the **planHash** in
`class` (type code `plan`, system
`http://terminology.hl7.org/CodeSystem/coverage-class`), `value` = the hash:

| Payer org id | Payer | planHash |
|---|---|---|
| `a1b2c3d4-1001-4000-8000-000000000001` | BlueCross Preferred PPO | `0xa1a1…a1a1` (32× `a1`) |
| `a1b2c3d4-1002-4000-8000-000000000002` | Aetna Gold HMO | `0xb2b2…b2b2` (32× `b2`) |
| all others | Medicare / Medicaid / UnitedHealth | *(no `class` entry — no on-chain plan)* |

```json
"class": [{
  "type": { "coding": [{ "system": "http://terminology.hl7.org/CodeSystem/coverage-class", "code": "plan", "display": "Plan" }] },
  "value": "0xa1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1",
  "name": "BlueCross Preferred PPO"
}]
```

## memberId convention (on-chain)

The FHIR layer carries the plaintext member ID (`Coverage.subscriberId`, e.g.
`e1f2a3b4-0001-4000-8000-000000000001`). On-chain (CoverageRegistry), the
member is identified by its keccak-256 hash of that UTF-8 string:

```
memberId (bytes32) = keccak256("e1f2a3b4-0001-4000-8000-000000000001")
```

The workflow hashes `member_id` from the decision-request payload before any
EVM read/write — the plaintext never goes on-chain (no PHI on-chain).

## Demo fixtures (ServiceRequests)

All synthesized deterministically by the transform script, aligned to the
curated letter `data/necessity-letters/PROC_KNEE_MRI.md`. Demo patient: Maria
Garcia `c1d2e3f4-0001-4000-8000-000000000001` (member
`e1f2a3b4-0001-4000-8000-000000000001`, BlueCross) unless noted.

| ServiceRequest | CPT | Amount | Requester org | Insurance | Expected outcome |
|---|---|---|---|---|---|
| `sr-knee-mri-0001` | 73721 (+ SNOMED 241615005) | $850.00 | Pacific Orthopedic Associates `b1a2c3d4-0002…` | Maria's active BlueCross (`cov-e1f2a3b4-0001…`) | **APPROVE** — in-network, eligible, covered, within cap; necessity letter via `dr-knee-mri-0001` |
| `sr-acupuncture-0002` | 97810 | $120.00 | Pacific Orthopedic Associates | Maria's active BlueCross | **DENY — not covered** (acupuncture not in plan) |
| `sr-knee-mri-oon-0003` | 73721 | $850.00 | Mercy General Hospital `b1a2c3d4-0001…` | Maria's active BlueCross | **DENY — out-of-network** (org not in plan network) |
| `sr-knee-mri-inelig-0004` | 73721 | $850.00 | Pacific Orthopedic Associates | `cov-inelig-bluecross-0002` — a **cancelled** BlueCross coverage James Patterson `c1d2e3f4-0002…` (member `e1f2a3b4-0002…`) does not hold (still carries the `0xa1a1…` planHash) | **DENY — ineligible** (coverage not active on-chain) |

Supporting document: `DocumentReference/dr-knee-mri-0001` (subject Maria,
`content[0].attachment.url = /fhir/r4/DocumentReference/dr-knee-mri-0001/$content`,
letter key `PROC_KNEE_MRI`).
