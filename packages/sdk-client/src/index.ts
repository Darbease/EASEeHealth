// Contract ABIs
export {
  mockUsdcAbi,
  consentRegistryAbi,
  policyRegistryAbi,
  claimDecisionRegistryAbi,
  claimEscrowAbi,
} from "./abis.js"

// Contract clients
export * as consentRegistry from "./clients/consent-registry.js"
export * as policyRegistry from "./clients/policy-registry.js"
export * as claimDecisionRegistry from "./clients/claim-decision-registry.js"
export * as claimEscrow from "./clients/claim-escrow.js"

// API clients
export { getPolicy, type PolicyLookupResponse } from "./api/policy-client.js"
export { verifyCredential, type CredentialVerifyResponse } from "./api/credential-client.js"
export { requestProof, type ProofResponse } from "./api/proof-client.js"
export { sendCallback } from "./api/callback-client.js"

// Config
export { loadConfigFromEnv, type ProofPAConfig } from "./config.js"
