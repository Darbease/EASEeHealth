// ---------------------------------------------------------------------------
// Attester client — calls the Confidential AI Attester /v1/inference, awaits a
// completed verdict (handling both a synchronous response and the async
// queued→poll flow), and parses the fenced-JSON verdict + provenance digests.
//
// The Attester's exact sync/async contract is an OPEN ITEM (the team will
// confirm). This client is defensive: it treats an inline completed result as
// sync, otherwise polls a status endpoint, and returns `null` on ANY failure so
// the caller can fall back to deterministic evaluation — the demo never breaks.
// ---------------------------------------------------------------------------
import type { AdapterConfig } from "./config.js";

export interface AttesterPredicates {
  procedure_covered?: boolean;
  amount_within_cap?: boolean;
  necessity_established?: boolean;
}

export interface AttesterVerdict {
  source: "attester";
  approved: boolean;
  reason: string;
  predicates: AttesterPredicates;
  confidence?: string;
  risk_level?: string;
  inferenceId?: string;
  model?: string;
  requestDigest?: string;
  responseDigest?: string;
  documentDigest?: string;
  signature?: string; // Phase 3: EIP-712 over digests, if the Attester provides one
  attesterKeyHash?: string; // Phase 3: TEE/model identity, if provided
}

export interface InferenceInput {
  procedureCode: string;
  requestedAmount: number;
  coveredProcedures: string[];
  amountCap: number | undefined;
  document: { content: string; filename: string };
}

const SYSTEM_PROMPT =
  "You are a strict medical-necessity reviewer for prior authorization. " +
  "Decide ONLY from the attached clinical document and the supplied policy. " +
  "Do not invent facts. Respond with ONLY a single JSON object — no prose, no markdown fences.";

function buildPrompt(input: InferenceInput): string {
  const capStr = input.amountCap === undefined ? "not specified" : String(input.amountCap);
  return [
    "Review the attached clinical document for prior-authorization medical necessity.",
    "",
    `Requested procedure code: ${input.procedureCode}`,
    `Requested amount (USD minor units): ${input.requestedAmount}`,
    `Plan covered procedures: ${JSON.stringify(input.coveredProcedures)}`,
    `Plan amount cap for this procedure (USD minor units): ${capStr}`,
    "",
    "Decide, using ONLY the attached document and this policy:",
    "1. Is the requested procedure medically necessary for the documented diagnosis?",
    "2. Is the procedure covered under the plan (present in the covered list)?",
    "3. Is the requested amount within the plan cap?",
    "",
    "Respond with ONLY this JSON object and nothing else:",
    `{"approved": true, "reason": "<one sentence citing the document>", "predicates": {"procedure_covered": true, "amount_within_cap": true, "necessity_established": true}, "confidence": "high", "risk_level": "low"}`,
  ].join("\n");
}

interface ParsedVerdict {
  approved: boolean;
  reason: string;
  predicates: AttesterPredicates;
  confidence?: string;
  risk_level?: string;
}

/** Strip optional ```json fences and parse the first {...} block from the model output. */
export function parseVerdictJson(output: string): ParsedVerdict | null {
  if (!output) return null;
  let text = output.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return null;
  try {
    const obj = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
    const predicates = (typeof obj.predicates === "object" && obj.predicates ? obj.predicates : {}) as AttesterPredicates;
    return {
      approved: obj.approved === true,
      reason: typeof obj.reason === "string" ? obj.reason : "",
      predicates,
      confidence: typeof obj.confidence === "string" ? obj.confidence : undefined,
      risk_level: typeof obj.risk_level === "string" ? obj.risk_level : undefined,
    };
  } catch {
    return null;
  }
}

interface FetchResult {
  ok: boolean;
  status: number;
  body: any;
}

async function fetchJson(url: string, options: RequestInit, timeoutMs: number): Promise<FetchResult> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: ctrl.signal });
    const raw = await res.text();
    let body: any = undefined;
    try {
      body = raw ? JSON.parse(raw) : undefined;
    } catch {
      body = raw;
    }
    return { ok: res.ok, status: res.status, body };
  } finally {
    clearTimeout(timer);
  }
}

function isCompleted(body: any): boolean {
  if (!body || typeof body !== "object") return false;
  if (body.status === "completed") return true;
  if (body.status === "failed" || body.status === "queued" || body.status === "pending" || body.status === "processing") return false;
  // No explicit status but the result fields are present → treat as a sync completion.
  return typeof body.output === "string" && Array.isArray(body.resources);
}

function extractVerdict(body: any): AttesterVerdict | null {
  const parsed = parseVerdictJson(typeof body?.output === "string" ? body.output : "");
  if (!parsed) return null;
  const resources = Array.isArray(body?.resources) ? body.resources : [];
  const r0 = (resources[0] ?? {}) as Record<string, any>;
  return {
    source: "attester",
    approved: parsed.approved,
    reason: parsed.reason,
    predicates: parsed.predicates,
    confidence: parsed.confidence,
    risk_level: parsed.risk_level,
    inferenceId: typeof body?.id === "string" ? body.id : undefined,
    model: typeof body?.model === "string" ? body.model : undefined,
    requestDigest: r0.request_digest,
    responseDigest: r0.response_digest,
    documentDigest: r0.digest,
    signature: r0.signature ?? body?.signature,
    attesterKeyHash: body?.attester_key_hash ?? body?.enclave_key_hash ?? r0.attester_key_hash,
  };
}

export interface InferenceResult {
  verdict: AttesterVerdict | null;
  /** Human-readable reason for the outcome — logged so live-endpoint issues are debuggable. */
  diagnostic: string;
}

/** Returns a verdict, or null (+ a diagnostic) if the attester is unconfigured/unreachable/slow → caller falls back. */
export async function runInference(input: InferenceInput, config: AdapterConfig): Promise<InferenceResult> {
  if (!config.inferenceApiKey) return { verdict: null, diagnostic: "no INFERENCE_API_KEY (fallback-only)" };

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${config.inferenceApiKey}`,
  };
  const requestBody = {
    model: config.model,
    system_prompt: SYSTEM_PROMPT,
    prompt: buildPrompt(input),
    resources: [
      {
        filename: input.document.filename,
        content_type: "text/markdown",
        content_base64: Buffer.from(input.document.content, "utf8").toString("base64"),
      },
    ],
  };

  try {
    const post = await fetchJson(
      `${config.inferenceBaseUrl}/v1/inference`,
      { method: "POST", headers, body: JSON.stringify(requestBody) },
      config.requestTimeoutMs,
    );
    if (!post.ok) return { verdict: null, diagnostic: `POST /v1/inference returned HTTP ${post.status}` };
    if (isCompleted(post.body)) {
      const v = extractVerdict(post.body);
      return v
        ? { verdict: v, diagnostic: "completed (sync)" }
        : { verdict: null, diagnostic: "sync completion but verdict JSON unparseable" };
    }
    if (post.body?.status === "failed") return { verdict: null, diagnostic: "inference failed" };

    const id: string | undefined = typeof post.body?.id === "string" ? post.body.id : undefined;
    if (!id) return { verdict: null, diagnostic: `unexpected response (status=${post.body?.status ?? "?"}, no id)` };

    const statusUrl = `${config.inferenceBaseUrl}${config.statusPathTemplate.replace("{id}", encodeURIComponent(id))}`;
    const deadline = Date.now() + config.pollTimeoutMs;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, config.pollIntervalMs));
      const poll = await fetchJson(statusUrl, { method: "GET", headers }, config.requestTimeoutMs);
      if (!poll.ok) continue;
      if (poll.body?.status === "failed") return { verdict: null, diagnostic: "inference failed (poll)" };
      if (isCompleted(poll.body)) {
        const v = extractVerdict(poll.body);
        return v
          ? { verdict: v, diagnostic: "completed (async)" }
          : { verdict: null, diagnostic: "async completion but verdict JSON unparseable" };
      }
    }
    return { verdict: null, diagnostic: `polling timed out after ${config.pollTimeoutMs}ms` };
  } catch (err) {
    return { verdict: null, diagnostic: `network/abort error: ${String((err as Error)?.message ?? err)}` };
  }
}
