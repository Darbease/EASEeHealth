// ---------------------------------------------------------------------------
// Adapter configuration — all from env, with demo-safe defaults.
// ---------------------------------------------------------------------------
export interface AdapterConfig {
  port: number;
  inferenceApiKey: string | undefined;
  inferenceBaseUrl: string;
  model: string;
  /** Status-poll path template; `{id}` is replaced with the inference id. */
  statusPathTemplate: string;
  lettersDir: string | undefined;
  requestTimeoutMs: number;
  pollIntervalMs: number;
  pollTimeoutMs: number;
  /** Expected EIP-712 signer of the attester attestation (optional). */
  attesterSignerAddress: string | undefined;
  /** Chain id for the EIP-712 domain used to verify attester signatures. */
  chainId: number;
}

export function loadConfig(): AdapterConfig {
  return {
    port: parseInt(process.env.ATTESTER_ADAPTER_PORT ?? process.env.PORT ?? "3007"),
    inferenceApiKey: process.env.INFERENCE_API_KEY || undefined,
    inferenceBaseUrl: (process.env.INFERENCE_BASE_URL ?? "https://confidential-ai-dev-preview.cldev.cloud").replace(/\/$/, ""),
    model: process.env.INFERENCE_MODEL ?? "gemma4",
    statusPathTemplate: process.env.INFERENCE_STATUS_PATH ?? "/v1/inference/{id}",
    lettersDir: process.env.NECESSITY_LETTERS_DIR || undefined,
    requestTimeoutMs: parseInt(process.env.INFERENCE_TIMEOUT_MS ?? "30000"),
    pollIntervalMs: parseInt(process.env.INFERENCE_POLL_INTERVAL_MS ?? "2000"),
    pollTimeoutMs: parseInt(process.env.INFERENCE_POLL_TIMEOUT_MS ?? "60000"),
    attesterSignerAddress: process.env.INFERENCE_ATTESTER_ADDRESS || undefined,
    chainId: Number(process.env.PROOFPA_CHAIN_ID ?? process.env.CHAIN_ID ?? 31337),
  };
}
