# Credential Service

Port: **3002**

Validates provider credentials and serves Synthea-format provider/organization registry data.

## Endpoints

| Method | Path | Description | Used By |
|--------|------|-------------|---------|
| `POST` | `/v1/credentials/verify` | Validate provider credential (NPI) against allowlist | WF-001, WF-005 |
| `GET` | `/v1/registry/providers` | List providers (filterable by `?organization=` and `?specialty=`). Response includes embedded `OrganizationName`. | WF-005 |
| `GET` | `/v1/registry/providers/:id` | Provider detail with organization and encounter count | Dashboard |
| `GET` | `/v1/registry/organizations` | List all organizations | Dashboard |
| `GET` | `/v1/registry/organizations/:id` | Organization detail with associated providers | Dashboard |
| `GET` | `/healthz` | Health check | Demo runner |

## Credential Verify Request

```json
{
  "provider_id_hash": "0xb2b2...b2",
  "service_date": "2026-03-08"
}
```

Valid provider hashes (demo allowlist): `0xb2b2...b2` (Dr. Sarah Chen), `0xc3c3...c3` (Dr. Michael Torres).

## Data Source

Provider and organization data loaded from `data/synthea/providers.csv` and `data/synthea/organizations.csv` at startup via `@proofpa/schemas` `loadSyntheaData()`.
