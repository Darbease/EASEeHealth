import { NextRequest } from "next/server";

// Proxy requests to backend services running on ports 3001-3006.
// This avoids CORS issues without modifying any service code.
//
// URL patterns:
//   /api/services/healthz?target=http://localhost:3001  → health check
//   /api/services/3005/v1/prior-auth/submit             → service proxy

export function parseTarget(
  pathSegments: string[],
  searchParams: URLSearchParams
): { url: string } | null {
  // Health check mode: /api/services/healthz?target=<url>
  if (pathSegments[0] === "healthz") {
    const target = searchParams.get("target");
    if (!target) return null;
    return { url: `${target}/healthz` };
  }

  // Proxy mode: /api/services/<port>/<rest of path>
  const port = parseInt(pathSegments[0], 10);
  if (isNaN(port) || port < 3001 || port > 3006) return null;
  const rest = pathSegments.slice(1).join("/");
  return { url: `http://localhost:${port}/${rest}` };
}

async function proxyRequest(req: NextRequest, method: string) {
  const pathSegments = req.nextUrl.pathname
    .replace(/^\/api\/services\//, "")
    .split("/")
    .filter(Boolean);

  const target = parseTarget(pathSegments, req.nextUrl.searchParams);
  if (!target) {
    return new Response(JSON.stringify({ error: "Invalid proxy target" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    // Propagate correlation ID if present
    const correlationId = req.headers.get("x-correlation-id");
    if (correlationId) headers["x-correlation-id"] = correlationId;

    const fetchOptions: RequestInit = {
      method,
      headers,
      signal: AbortSignal.timeout(10_000),
    };

    if (method !== "GET" && method !== "HEAD") {
      try {
        const body = await req.text();
        if (body) fetchOptions.body = body;
      } catch {
        // no body
      }
    }

    const res = await fetch(target.url, fetchOptions);
    const data = await res.text();

    return new Response(data, {
      status: res.status,
      headers: {
        "Content-Type": res.headers.get("Content-Type") || "application/json",
      },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({
        error: "Service unavailable",
        details: err instanceof Error ? err.message : "Unknown error",
      }),
      {
        status: 502,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}

export async function GET(req: NextRequest) {
  return proxyRequest(req, "GET");
}

export async function POST(req: NextRequest) {
  return proxyRequest(req, "POST");
}

export async function PUT(req: NextRequest) {
  return proxyRequest(req, "PUT");
}

export async function DELETE(req: NextRequest) {
  return proxyRequest(req, "DELETE");
}
