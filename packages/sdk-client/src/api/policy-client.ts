import { CORRELATION_HEADER } from "@proofpa/observability"

export interface PolicyLookupResponse {
  payer_id: string
  policy_version: string
  policy_hash: string
  active: boolean
  predicates: Record<string, unknown>
}

export async function getPolicy(
  baseUrl: string,
  payerId: string,
  policyVersion: string,
  correlationId: string,
): Promise<PolicyLookupResponse> {
  const res = await fetch(`${baseUrl}/v1/policies/${payerId}/${policyVersion}`, {
    headers: { [CORRELATION_HEADER]: correlationId },
  })
  if (!res.ok) throw new Error(`Policy lookup failed: ${res.status}`)
  return res.json() as Promise<PolicyLookupResponse>
}
