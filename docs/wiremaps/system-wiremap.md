# EASE eHealth System Wiremap

```mermaid
flowchart LR
  subgraph Clients
    A["Provider Portal"]
    B["Patient Consent App"]
    C["Payer Ops Console"]
  end

  subgraph Services
    D["Provider Adapter API"]
    E["Consent Service"]
    F["Policy Service"]
    G["Credential Service"]
    H["Decision Callback Service"]
    I["Proof Service Stub"]
  end

  subgraph CRE
    W1["WF-001 PriorAuthDecision"]
    W2["WF-002 ConsentRevocation"]
    W3["WF-003 ChallengeResolution"]
    W4["WF-004 ReconciliationMonitor"]
    CH["Confidential HTTP"]
  end

  subgraph Onchain
    J["ConsentRegistry"]
    K["PolicyRegistry"]
    L["ClaimDecisionRegistry"]
    M["ClaimEscrow"]
    N["Mock USDC"]
  end

  A --> D
  B --> E
  C --> W3

  D --> W1
  E --> W2

  W1 --> CH
  CH --> F
  CH --> G
  CH --> I

  W1 --> J
  W1 --> K
  W1 --> L
  W1 --> M
  M --> N
  W1 --> H

  W2 --> J
  W2 --> L

  W3 --> L
  W3 --> M

  W4 --> L
  W4 --> M
```

## Notes
- `WF-001` is the critical path for demo outcomes.
- Onchain writes contain only minimal state and hashes, not PHI.
- Confidential HTTP is used to reduce sensitive data exposure during offchain fetches.
