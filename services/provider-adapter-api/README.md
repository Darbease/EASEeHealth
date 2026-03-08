# Provider Adapter API

Port: **3005**

Accepts prior-auth submissions and serves Synthea-format EHR data (patients, encounters, procedures, conditions, claims).

## Endpoints

| Method | Path | Description | Used By |
|--------|------|-------------|---------|
| `POST` | `/v1/prior-auth/submit` | Submit a prior authorization request (triggers WF-001) | Provider Portal |
| `GET` | `/v1/ehr/patients` | List patients | Dashboard |
| `GET` | `/v1/ehr/patients/:id` | Patient detail with conditions and encounters | Dashboard |
| `GET` | `/v1/ehr/encounters` | List encounters (filterable by `?patient=`) | Dashboard |
| `GET` | `/v1/ehr/encounters/:id` | Encounter detail with procedures and conditions | Dashboard |
| `GET` | `/v1/ehr/procedures` | List procedures (filterable by `?patient=`, `?encounter=`) | Dashboard |
| `GET` | `/v1/ehr/conditions` | List conditions (filterable by `?patient=`) | Dashboard |
| `GET` | `/v1/ehr/claims` | List claims (filterable by `?patient=`, `?status=`) | WF-004 |
| `GET` | `/v1/ehr/claims/outstanding` | Outstanding BILLED claims with enriched patient/procedure data | WF-001, WF-004 |
| `GET` | `/v1/ehr/medications` | List medications (filterable by `?patient=`) | Dashboard |
| `GET` | `/v1/ehr/medications/pending-auth` | Medications pending prior authorization | WF-006 |
| `GET` | `/v1/ehr/claims/transfers/pending` | Pending transfer claims (TRANSFERIN type) | WF-007 |
| `GET` | `/v1/ehr/claims/:id` | Claim detail with transactions, patient, provider, encounter | Dashboard |
| `GET` | `/healthz` | Health check | Demo runner |

## Data Source

EHR data loaded from `data/synthea/*.csv` at startup via `@proofpa/schemas` `loadSyntheaData()`.
