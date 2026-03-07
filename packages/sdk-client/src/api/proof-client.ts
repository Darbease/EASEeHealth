import { CORRELATION_HEADER } from "@proofpa/observability"

export interface ProofResponse {
  proof_id: string
  proof_hash: string
  public_inputs_hash: string
  result: "PASS" | "FAIL"
  reason_bitmap: string
}

export async function requestProof(
  baseUrl: string,
  request: Record<string, unknown>,
  correlationId: string,
): Promise<ProofResponse> {
  const res = await fetch(`${baseUrl}/v1/proofs/medical-necessity`, {
    method: "POST",
    headers: { "Content-Type": "application/json", [CORRELATION_HEADER]: correlationId },
    body: JSON.stringify(request),
  })
  if (!res.ok) throw new Error(`Proof request failed: ${res.status}`)
  return res.json() as Promise<ProofResponse>
}
