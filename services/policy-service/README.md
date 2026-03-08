# Policy Service

Port: **3001**

Returns deterministic policy rules and serves Synthea-format payer enrollment data.

## Endpoints

| Method | Path | Description | Used By |
|--------|------|-------------|---------|
| `GET` | `/v1/policies/:payerId/:version` | Get policy with predicates (covered procedures, amount caps, attestation max age) | WF-001, WF-003, WF-005, WF-006, WF-007, WF-008 |
| `GET` | `/v1/payers` | List all payers | WF-002, Dashboard |
| `GET` | `/v1/payers/:id` | Payer detail with enrolled members | Dashboard |
| `GET` | `/v1/payers/:id/members` | Payer members enriched with patient names | Dashboard |
| `GET` | `/v1/payer-transitions` | Payer enrollment transitions (filterable by `?patient=`) | WF-002 |
| `GET` | `/healthz` | Health check | Demo runner |

## Data Source

Payer and enrollment data loaded from `data/synthea/payers.csv` and `data/synthea/payer_transitions.csv` at startup via `@proofpa/schemas` `loadSyntheaData()`.
