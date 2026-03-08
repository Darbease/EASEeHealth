"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useWorkflowStream, colorize } from "@/lib/useWorkflowStream";

const TRIGGER_STYLES: Record<string, { label: string; className: string }> = {
  cron: { label: "Cron", className: "bg-[#217B71]/15 text-[#2ecfbe]" },
  log: { label: "Log", className: "bg-[#F7B808]/15 text-[#F7B808]" },
  http: { label: "HTTP", className: "bg-[#0847F7]/15 text-[#8AA6F9]" },
};

const WORKFLOWS = [
  {
    id: "wf-001-prior-auth-decision",
    name: "WF-001: Prior Auth Decision",
    description:
      "Full prior auth flow — 10 steps: EHR fetch, consent/policy checks, encrypted proof evaluation, 5 EVM writes (submit, proof, schedule, release, markPaid), encrypted callback.",
    trigger: "cron",
  },
  {
    id: "wf-002-consent-revocation",
    name: "WF-002: Consent Revocation",
    description:
      "HTTP trigger — revokes consent on-chain, cascade-challenges affected claims, cancels pending payouts.",
    trigger: "http",
    defaultPayload: JSON.stringify({
      consent_id: "0xc0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0",
      reason_code: 1,
      affected_claim_id: "0x0101010101010101010101010101010101010101010101010101010101010101",
    }),
  },
  {
    id: "wf-003-challenge-resolution",
    name: "WF-003: Challenge Resolution",
    description:
      "Log trigger (ProofEvaluated) — automated compliance gate, auto-challenges risky claims. Requires a TX hash from setProofResult.",
    trigger: "log",
    requiresTxHash: true,
  },
  {
    id: "wf-004-reconciliation-monitor",
    name: "WF-004: Reconciliation Monitor",
    description:
      "Scheduled every 15 min — detects stuck PROOF_PENDING states and state mismatches.",
    trigger: "cron",
  },
  {
    id: "wf-005-encrypted-credential-audit",
    name: "WF-005: Encrypted Credential Audit",
    description:
      "AES-GCM encryption showcase — 5 encrypted HTTP calls + 1 on-chain consent check.",
    trigger: "cron",
  },
  {
    id: "wf-006-medication-payment-verification",
    name: "WF-006: Medication Payment Verification",
    description:
      "Pharmaceutical benefit check — formulary coverage + medication amount cap (8 predicates).",
    trigger: "cron",
  },
  {
    id: "wf-007-claim-transfer-settlement",
    name: "WF-007: Claim Transfer Settlement",
    description:
      "Log trigger (ClaimSubmitted) — reactive settlement of transfer claims. Requires a TX hash from submitClaim.",
    trigger: "log",
    requiresTxHash: true,
  },
  {
    id: "wf-008-http-prior-auth",
    name: "WF-008: HTTP Prior Auth",
    description:
      "On-demand prior auth via signed HTTP request — fires immediately with full payload. No EHR fetch needed.",
    trigger: "http",
    defaultPayload: JSON.stringify({
      claim_id: "0x0808080808080808080808080808080808080808080808080808080808080808",
      payer_id: "payer-demo-001",
      procedure_code: "PROC_CARDIAC_CT",
      requested_amount: "38000",
      consent_id: "0xc0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0",
      policy_hash: "0xa1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1",
      service_date: "2026-03-08",
    }),
  },
];

export default function SimulatePage() {
  const { logs, isRunning, activeWorkflow, startWorkflow, stop } =
    useWorkflowStream();
  const logEndRef = useRef<HTMLDivElement>(null);
  const [txHashInputs, setTxHashInputs] = useState<Record<string, string>>({});

  // Auto-scroll
  const prevCount = useRef(0);
  if (logs.length > prevCount.current) {
    prevCount.current = logs.length;
    setTimeout(
      () => logEndRef.current?.scrollIntoView({ behavior: "smooth" }),
      50
    );
  }

  const handleSimulate = (wf: typeof WORKFLOWS[number]) => {
    if (wf.trigger === "http" && wf.defaultPayload) {
      startWorkflow(wf.id, { httpPayload: wf.defaultPayload });
    } else if (wf.trigger === "log" && wf.requiresTxHash) {
      const txHash = txHashInputs[wf.id];
      if (!txHash || !txHash.startsWith("0x")) return;
      startWorkflow(wf.id, { evmTxHash: txHash, evmEventIndex: "0" });
    } else {
      startWorkflow(wf.id);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/"
          className="text-sm text-[var(--text-muted)] hover:text-[var(--text)]"
        >
          &larr; Dashboard
        </Link>
        <h1 className="mt-1 text-xl font-bold">CRE Workflow Simulator</h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          Trigger Chainlink CRE workflow simulations and stream real-time
          output.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {WORKFLOWS.map((wf) => (
          <div
            key={wf.id}
            className={`rounded-xl border p-5 transition-colors ${
              activeWorkflow === wf.id
                ? "border-[var(--accent)] bg-[var(--bg-card)]"
                : "border-[var(--border)] bg-[var(--bg-card)] hover:bg-[var(--bg-card-hover)]"
            }`}
          >
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">{wf.name}</h3>
              <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${TRIGGER_STYLES[wf.trigger]?.className ?? ""}`}>
                {TRIGGER_STYLES[wf.trigger]?.label ?? wf.trigger}
              </span>
            </div>
            <p className="mt-2 text-sm text-[var(--text-muted)]">
              {wf.description}
            </p>
            {wf.requiresTxHash && (
              <input
                type="text"
                placeholder="TX hash (0x...)"
                value={txHashInputs[wf.id] ?? ""}
                onChange={(e) =>
                  setTxHashInputs((prev) => ({ ...prev, [wf.id]: e.target.value }))
                }
                className="mt-3 w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-1.5 text-sm font-mono text-[var(--text)] placeholder:text-[var(--text-muted)]"
              />
            )}
            <button
              onClick={() => handleSimulate(wf)}
              disabled={isRunning || (wf.requiresTxHash && !txHashInputs[wf.id]?.startsWith("0x"))}
              className="mt-3 rounded-lg bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-[var(--accent-hover)] disabled:opacity-50"
            >
              {isRunning && activeWorkflow === wf.id ? (
                <span className="flex items-center gap-2">
                  <svg
                    className="h-3.5 w-3.5 animate-spin"
                    viewBox="0 0 24 24"
                    fill="none"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
                    />
                  </svg>
                  Simulating...
                </span>
              ) : (
                "Simulate"
              )}
            </button>
          </div>
        ))}
      </div>

      {(logs.length > 0 || isRunning) && (
        <div className="rounded-xl border border-[var(--border)] bg-[#0d0d14] p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-[var(--text-muted)]">
              Simulation Output &mdash; {activeWorkflow}
            </h3>
            {isRunning && (
              <button
                onClick={stop}
                className="rounded-md border border-[var(--error)] px-2 py-1 text-xs text-[var(--error)] hover:bg-[var(--error)]/10"
              >
                Stop
              </button>
            )}
          </div>
          <div className="terminal max-h-96 overflow-y-auto rounded-lg bg-[var(--bg)] p-3">
            {logs.length === 0 && isRunning && (
              <div className="pulse-dot text-[var(--text-muted)]">
                Waiting for output...
              </div>
            )}
            {logs.map((line, i) => (
              <div key={i} className={colorize(line)}>
                <span className="mr-2 text-[var(--text-muted)]">
                  [{line.timestamp}]
                </span>
                {line.text}
              </div>
            ))}
            <div ref={logEndRef} />
          </div>
        </div>
      )}
    </div>
  );
}
