"use client";

import { useQuery } from "@tanstack/react-query";
import { SERVICES, ANVIL_RPC } from "@/config/services";

type Status = "up" | "down" | "loading";

function StatusDot({ status }: { status: Status }) {
  if (status === "loading")
    return (
      <span className="pulse-dot inline-block h-2.5 w-2.5 rounded-full bg-[var(--text-muted)]" />
    );
  return (
    <span
      className={`inline-block h-2.5 w-2.5 rounded-full ${
        status === "up" ? "bg-[var(--success)]" : "bg-[var(--error)]"
      }`}
    />
  );
}

async function checkService(url: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/services/healthz?target=${encodeURIComponent(url)}`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return false;
    const body = await res.json();
    return body?.status === "ok";
  } catch {
    return false;
  }
}

async function checkAnvil(): Promise<boolean> {
  try {
    const res = await fetch(ANVIL_RPC, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "eth_blockNumber", params: [], id: 1 }),
      signal: AbortSignal.timeout(3000),
    });
    const body = await res.json();
    return !!body?.result;
  } catch {
    return false;
  }
}

export function SystemHealth() {
  const { data, isLoading } = useQuery({
    queryKey: ["system-health"],
    queryFn: async () => {
      const services = await Promise.all(
        Object.entries(SERVICES).map(async ([key, svc]) => ({
          key,
          name: svc.name,
          port: svc.port,
          up: await checkService(svc.url),
        }))
      );
      const anvilUp = await checkAnvil();
      return { services, anvilUp };
    },
    refetchInterval: 10_000,
  });

  const services = data?.services ?? [];
  const anvilUp = data?.anvilUp ?? false;

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--text-muted)]">
          System Health
        </h2>
        <span className="text-xs text-[var(--text-muted)]">Auto-refresh 10s</span>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <div className="flex items-center gap-2 rounded-lg bg-[var(--bg)] px-3 py-2">
          <StatusDot status={isLoading ? "loading" : anvilUp ? "up" : "down"} />
          <span className="text-sm font-medium">Anvil</span>
          <span className="ml-auto text-xs text-[var(--text-muted)]">:8545</span>
        </div>
        {Object.entries(SERVICES).map(([key, svc]) => {
          const s = services.find((x) => x.key === key);
          return (
            <div key={key} className="flex items-center gap-2 rounded-lg bg-[var(--bg)] px-3 py-2">
              <StatusDot status={isLoading ? "loading" : s?.up ? "up" : "down"} />
              <span className="text-sm font-medium">{svc.name}</span>
              <span className="ml-auto text-xs text-[var(--text-muted)]">:{svc.port}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
