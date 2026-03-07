import { CORRELATION_HEADER } from "@proofpa/observability"

export async function sendCallback(
  baseUrl: string,
  payload: Record<string, unknown>,
  correlationId: string,
): Promise<void> {
  const res = await fetch(`${baseUrl}/v1/callbacks/prior-auth-decision`, {
    method: "POST",
    headers: { "Content-Type": "application/json", [CORRELATION_HEADER]: correlationId },
    body: JSON.stringify({ ...payload, correlation_id: correlationId }),
  })
  if (!res.ok) throw new Error(`Callback failed: ${res.status}`)
}
