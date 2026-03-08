"use client";

import { useRef } from "react";
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
      "Revokes consent on-chain and flags any pending claims for review.",
    trigger: "cron",
  },
  {
    id: "wf-003-challenge-resolution",
    name: "WF-003: Challenge Resolution",
    description:
      "Challenge lifecycle — poll challenges, verify claim state, challengeClaim, resolveChallenge, cancelPayout, encrypted callback.",
    trigger: "cron",
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
      "Event-driven transfer settlement — fires on ClaimSubmitted event via EVMClient.logTrigger(). No polling.",
    trigger: "log",
  },
  {
    id: "wf-008-http-prior-auth",
    name: "WF-008: HTTP Prior Auth",
    description:
      "On-demand prior auth via signed HTTP request — fires immediately with full payload. No EHR fetch needed.",
    trigger: "http",
  },
];

export default function SimulatePage() {
  const { logs, isRunning, activeWorkflow, startWorkflow, stop } =
    useWorkflowStream();
  const logEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll
  const prevCount = useRef(0);
  if (logs.length > prevCount.current) {
    prevCount.current = logs.length;
    setTimeout(
      () => logEndRef.current?.scrollIntoView({ behavior: "smooth" }),
      50
    );
  }

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
            <button
              onClick={() => startWorkflow(wf.id)}
              disabled={isRunning}
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
