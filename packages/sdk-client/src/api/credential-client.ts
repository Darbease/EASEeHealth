import { CORRELATION_HEADER } from "@proofpa/observability"

export interface CredentialVerifyResponse {
  valid: boolean
  provider_id_hash: string
}

export async function verifyCredential(
  baseUrl: string,
  providerIdHash: string,
  serviceDate: string,
  correlationId: string,
): Promise<CredentialVerifyResponse> {
  const res = await fetch(`${baseUrl}/v1/credentials/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json", [CORRELATION_HEADER]: correlationId },
    body: JSON.stringify({ provider_id_hash: providerIdHash, service_date: serviceDate }),
  })
  if (!res.ok) throw new Error(`Credential verify failed: ${res.status}`)
  return res.json() as Promise<CredentialVerifyResponse>
}
