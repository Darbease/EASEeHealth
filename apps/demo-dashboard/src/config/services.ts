export const SERVICES = {
  policy: { name: "Policy Service", port: 3001, url: "http://localhost:3001" },
  credential: { name: "Credential Service", port: 3002, url: "http://localhost:3002" },
  proof: { name: "Proof Service Stub", port: 3003, url: "http://localhost:3003" },
  consent: { name: "Consent Service", port: 3004, url: "http://localhost:3004" },
  providerAdapter: { name: "Provider Adapter API", port: 3005, url: "http://localhost:3005" },
  callback: { name: "Decision Callback", port: 3006, url: "http://localhost:3006" },
} as const;

export const ANVIL_RPC = "http://127.0.0.1:8545";
