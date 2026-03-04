# WF-002 ConsentRevocation

Trigger: HTTP revoke event from consent service.

Responsibilities:
- validate revocation event signature
- mark consent as revoked onchain
- block related pending claims
