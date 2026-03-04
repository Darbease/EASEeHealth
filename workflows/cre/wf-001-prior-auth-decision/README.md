# WF-001 PriorAuthDecision

Trigger: HTTP submit from provider adapter.

Responsibilities:
- validate request signature and idempotency
- pull consent/policy/credential data
- compute decision package
- write claim state onchain
- schedule and release payout
