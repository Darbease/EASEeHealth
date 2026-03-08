# Decision Callback Service

Port: **3006**

Receives decision, consent, and challenge resolution callbacks from CRE workflows. Logs structured events for downstream notification.

## Endpoints

| Method | Path | Description | Used By |
|--------|------|-------------|---------|
| `POST` | `/v1/callbacks/prior-auth-decision` | Receive claim decision callback | WF-001, WF-005, WF-006, WF-007, WF-008 |
| `POST` | `/v1/callbacks/consent-revoked` | Receive consent revocation callback | WF-002 |
| `POST` | `/v1/callbacks/challenge-resolved` | Receive challenge resolution callback | WF-003 |
| `GET` | `/healthz` | Health check | Demo runner |
