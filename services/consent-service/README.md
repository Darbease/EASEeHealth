# Consent Service

Port: **3004**

Manages patient consent grants and revocations. Publishes consent events for CRE workflows.

## Endpoints

| Method | Path | Description | Used By |
|--------|------|-------------|---------|
| `POST` | `/v1/consents/grant` | Grant a new consent | Patient Consent App |
| `POST` | `/v1/consents/revoke` | Revoke an existing consent (triggers WF-002) | Patient Consent App |
| `GET` | `/v1/consents/revocations` | Poll revocations since timestamp (`?since=` seconds ago) | WF-002 |
| `GET` | `/healthz` | Health check | Demo runner |
