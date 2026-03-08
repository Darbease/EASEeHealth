# Proof Service Stub

Port: **3003**

MVP non-ZK decision artifact service. Evaluates up to 8 predicate checks against policy rules and returns a pass/fail result with a denial reason bitmap. Interface remains compatible with later ZK integration.

## Endpoints

| Method | Path | Description | Used By |
|--------|------|-------------|---------|
| `POST` | `/v1/proofs/medical-necessity` | Evaluate claim against policy predicates | WF-001, WF-003, WF-005, WF-006, WF-007, WF-008 |
| `GET` | `/healthz` | Health check | Demo runner |

## Request

```json
{
  "claim_id": "0x0101...01",
  "policy_hash": "0xa1a1...a1",
  "procedure_code": "PROC_KNEE_MRI",
  "requested_amount": "85000",
  "consent_active": true,
  "credential_valid": true,
  "is_duplicate": false,
  "attestation_age_seconds": 3600,
  "policy_predicates": { ... }
}
```

## Response

```json
{
  "result": "PASS",
  "reason_bitmap": "0",
  "proof_hash": "0xf3f5...5fb",
  "proof_id": "proof_f2c2a767..."
}
```

**Note**: Always returns HTTP 200. The `result` field (`"PASS"` or `"FAIL"`) and `reason_bitmap` are authoritative — workflows must parse the body, not rely on HTTP status.

## Denial Reason Bitmap

| Bit | Meaning |
|-----|---------|
| 0 | Provider credential invalid |
| 1 | Procedure not covered |
| 2 | Amount exceeds cap |
| 3 | Consent invalid/revoked |
| 4 | Duplicate/nullifier collision |
| 5 | Stale attestation |
| 6 | Medication not on formulary |
| 7 | Medication amount exceeds cap |
