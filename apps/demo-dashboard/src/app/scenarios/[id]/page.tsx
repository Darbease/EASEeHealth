"use client";

import { useParams } from "next/navigation";
import { useState, useCallback, useRef } from "react";
import Link from "next/link";
import { scenarios, type CREScenario, type SetupStep } from "@/lib/scenarios";
import { useWorkflowStream, colorize } from "@/lib/useWorkflowStream";
import { StateMachine } from "@/components/StateMachine";
import { ContractState } from "@/components/ContractState";

const CAPABILITY_BADGES: Record<string, { label: string; className: string }> = {
  HTTP: { label: "HTTP", className: "bg-[#0847F7]/20 text-[#8AA6F9]" },
  EVM_READ: { label: "EVM Read", className: "bg-[#217B71]/20 text-[#2ecfbe]" },
  EVM_WRITE: { label: "EVM Write", className: "bg-[#4A21C2]/20 text-[#a78bfa]" },
  ENCRYPTED: { label: "Encrypted", className: "bg-[#F7B808]/20 text-[#F7B808]" },
  DECODE: { label: "Decode", className: "bg-[#8AA6F9]/20 text-[#8AA6F9]" },
};

const TRIGGER_BADGES: Record<string, { label: string; className: string }> = {
  cron: { label: "Cron Trigger", className: "bg-[#217B71]/15 text-[#2ecfbe] border-[#217B71]/40" },
  log: { label: "Log Trigger", className: "bg-[#F7B808]/15 text-[#F7B808] border-[#F7B808]/40" },
  http: { label: "HTTP Trigger", className: "bg-[#0847F7]/15 text-[#8AA6F9] border-[#0847F7]/40" },
};

function SetupStepCard({
  step,
  status,
}: {
  step: SetupStep;
  status: "pending" | "running" | "done" | "error";
}) {
  return (
    <div
      className={`rounded-lg border p-3 text-sm ${
        status === "done"
          ? "border-[var(--success)]/30 bg-[var(--success)]/5"
          : status === "running"
          ? "border-[var(--accent)] bg-[var(--accent)]/5"
          : status === "error"
          ? "border-[var(--error)]/30 bg-[var(--error)]/5"
          : "border-[var(--border)] bg-[var(--bg-card)]"
      }`}
    >
      <div className="flex items-center gap-2">
        {status === "done" && <span className="text-[var(--success)]">&#10003;</span>}
        {status === "running" && (
          <svg className="h-4 w-4 animate-spin text-[var(--accent)]" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
          </svg>
        )}
        {status === "error" && <span className="text-[var(--error)]">&#10007;</span>}
        <span className="font-medium">Setup: {step.title}</span>
      </div>
      <p className="mt-1 text-xs text-[var(--text-muted)]">{step.description}</p>
    </div>
  );
}

type ChainStatus = "idle" | "resetting" | "deploying" | "ready" | "error";

export default function ScenarioPage() {
  const params = useParams();
  const id = params.id as string;
  const scenario = scenarios[id];

  const { logs, isRunning, startWorkflow, stop, clearLogs } = useWorkflowStream();
  const [setupStatus, setSetupStatus] = useState<Record<string, "pending" | "running" | "done" | "error">>({});
  const [setupComplete, setSetupComplete] = useState(false);
  const [setupTxHash, setSetupTxHash] = useState<string | null>(null);
  const [workflowDone, setWorkflowDone] = useState(false);
  const [settlementStatus, setSettlementStatus] = useState<"idle" | "running" | "done" | "error">("idle");
  const [settlementError, setSettlementError] = useState<string | null>(null);
  const [chainStatus, setChainStatus] = useState<ChainStatus>("idle");
  const [chainError, setChainError] = useState<string | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll logs
  const prevLogCount = useRef(0);
  if (logs.length > prevLogCount.current) {
    prevLogCount.current = logs.length;
    setTimeout(() => logEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
  }

  // Detect workflow completion
  if (!workflowDone && logs.length > 0 && logs[logs.length - 1].type === "done") {
    setWorkflowDone(true);
  }

  const runSetupSteps = useCallback(
    async (steps: SetupStep[]): Promise<{ ok: boolean; txHash?: string }> => {
      let txHash: string | undefined;
      for (const step of steps) {
        setSetupStatus((prev) => ({ ...prev, [step.id]: "running" }));
        try {
          if (step.type === "cast" && step.cast) {
            // On-chain setup step — POST to /api/chain
            const res = await fetch("/api/chain", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(step.cast),
            });
            if (!res.ok) {
              setSetupStatus((prev) => ({ ...prev, [step.id]: "error" }));
              return { ok: false };
            }
            const data = await res.json();
            if (data.txHash) {
              txHash = data.txHash;
              setSetupTxHash(data.txHash);
            }
          } else if (step.request) {
            // HTTP setup step
            const res = await fetch(step.request.url, {
              method: step.request.method,
              headers: { "Content-Type": "application/json" },
              ...(step.request.body ? { body: JSON.stringify(step.request.body) } : {}),
            });
            if (!res.ok) {
              setSetupStatus((prev) => ({ ...prev, [step.id]: "error" }));
              return { ok: false };
            }
          }
          setSetupStatus((prev) => ({ ...prev, [step.id]: "done" }));
        } catch {
          setSetupStatus((prev) => ({ ...prev, [step.id]: "error" }));
          return { ok: false };
        }
      }
      return { ok: true, txHash };
    },
    []
  );

  const run = useCallback(async () => {
    if (!scenario || isRunning) return;
    setWorkflowDone(false);

    // Build workflow options
    const opts: import("@/lib/useWorkflowStream").WorkflowOptions = {
      broadcast: true,
    };

    // Run setup steps first (e.g., submitClaim for Log trigger)
    if (scenario.setupSteps?.length) {
      const result = await runSetupSteps(scenario.setupSteps);
      if (!result.ok) return;
      setSetupComplete(true);
      // Small delay for visual separation
      await new Promise((r) => setTimeout(r, 500));
      // Pass txHash from setup for Log trigger
      if (result.txHash) {
        opts.evmTxHash = result.txHash;
        opts.evmEventIndex = "0";
      }
    }

    // Pass HTTP payload for HTTP trigger
    if (scenario.httpPayload) {
      opts.httpPayload = scenario.httpPayload;
    }

    await startWorkflow(scenario.workflow, opts);
  }, [scenario, isRunning, runSetupSteps, startWorkflow]);

  const settleOnChain = useCallback(async () => {
    if (!scenario?.claimId || !scenario.settlementAmount) return;
    setSettlementStatus("running");
    setSettlementError(null);

    // If scenario has setup steps (Log trigger — claim already submitted), use settleAfterSubmit
    const action = scenario.setupSteps?.length ? "settleAfterSubmit" : "settle";

    try {
      const res = await fetch("/api/chain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          claimId: scenario.claimId,
          amount: scenario.settlementAmount,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        setSettlementError(data.error || "Settlement failed");
        setSettlementStatus("error");
        return;
      }
      setSettlementStatus("done");
    } catch (err) {
      setSettlementError((err as Error).message);
      setSettlementStatus("error");
    }
  }, [scenario]);

  const resetAndDeploy = useCallback(async () => {
    setChainStatus("resetting");
    setChainError(null);
    // Also clear any previous workflow state
    clearLogs();
    setSetupStatus({});
    setSetupComplete(false);
    setSetupTxHash(null);
    setWorkflowDone(false);
    setSettlementStatus("idle");
    setSettlementError(null);
    prevLogCount.current = 0;

    try {
      setChainStatus("deploying");
      const res = await fetch("/api/chain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "resetAndDeploy" }),
      });
      if (!res.ok) {
        const data = await res.json();
        setChainError(data.error || "Deploy failed");
        setChainStatus("error");
        return;
      }
      setChainStatus("ready");
    } catch (err) {
      setChainError((err as Error).message);
      setChainStatus("error");
    }
  }, [clearLogs]);

  const reset = useCallback(() => {
    clearLogs();
    setSetupStatus({});
    setSetupComplete(false);
    setSetupTxHash(null);
    setWorkflowDone(false);
    setSettlementStatus("idle");
    setSettlementError(null);
    setChainStatus("idle");
    setChainError(null);
    prevLogCount.current = 0;
  }, [clearLogs]);

  if (!scenario) {
    return (
      <div className="text-center">
        <h1 className="text-xl font-bold">Scenario not found</h1>
        <Link href="/" className="mt-4 text-[var(--accent)] hover:underline">
          Back to dashboard
        </Link>
      </div>
    );
  }

  // Derive actual outcome from CRE logs
  const actualOutcome = deriveOutcome(scenario, logs);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <Link
          href="/"
          className="text-sm text-[var(--text-muted)] hover:text-[var(--text)]"
        >
          &larr; Dashboard
        </Link>
        <div className="mt-1 flex items-center gap-3">
          <h1 className="text-xl font-bold">{scenario.title}</h1>
          {TRIGGER_BADGES[scenario.triggerType] && (
            <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${TRIGGER_BADGES[scenario.triggerType].className}`}>
              {TRIGGER_BADGES[scenario.triggerType].label}
            </span>
          )}
        </div>
        <p className="mt-0.5 text-sm text-[var(--text-muted)]">
          {scenario.subtitle} &mdash; <span className="font-medium text-[var(--accent)]">{scenario.workflowName}</span>
          {scenario.amount && <span className="ml-2 font-semibold text-[var(--text)]">{scenario.amount}</span>}
        </p>
        <p className="mt-1 text-sm text-[var(--text-muted)]">{scenario.description}</p>
        <div className="mt-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-xs text-[var(--text-muted)]">
          <span className="font-medium text-[var(--text)]">{scenario.triggerLabel}</span> &mdash; {scenario.triggerDescription}
        </div>
      </div>

      {/* User Stories */}
      <div className="space-y-2">
        {scenario.userStories.map((story, i) => (
          <blockquote
            key={i}
            className="border-l-2 border-[var(--accent)]/40 pl-3 text-sm italic text-[var(--text-muted)]"
          >
            &ldquo;{story}&rdquo;
          </blockquote>
        ))}
      </div>

      {/* Chain Setup + Controls */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4 space-y-4">
        {/* Step 1: Reset & Deploy */}
        <div className="flex items-center gap-3">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--bg)] text-xs font-bold text-[var(--text-muted)]">
            1
          </span>
          <div className="flex-1">
            <span className="text-sm font-medium">Reset Chain &amp; Deploy Contracts</span>
            <p className="text-xs text-[var(--text-muted)]">
              Resets Anvil, deploys 5 contracts, grants roles, seeds policy + consent, funds escrow.
            </p>
          </div>
          <button
            onClick={resetAndDeploy}
            disabled={chainStatus === "resetting" || chainStatus === "deploying" || isRunning}
            className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-medium transition-colors hover:bg-[var(--bg-card-hover)] disabled:opacity-50"
          >
            {chainStatus === "resetting" || chainStatus === "deploying" ? (
              <span className="flex items-center gap-2">
                <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                </svg>
                {chainStatus === "resetting" ? "Resetting..." : "Deploying..."}
              </span>
            ) : chainStatus === "ready" ? (
              <span className="text-[var(--success)]">&#10003; Ready</span>
            ) : (
              "Reset & Deploy"
            )}
          </button>
        </div>

        {chainError && (
          <div className="rounded-lg border border-[var(--error)]/30 bg-[var(--error)]/5 px-3 py-2 text-xs text-[var(--error)]">
            {chainError}
          </div>
        )}

        {/* Step 2: Run Workflow */}
        <div className="flex items-center gap-3">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--bg)] text-xs font-bold text-[var(--text-muted)]">
            2
          </span>
          <div className="flex-1">
            <span className="text-sm font-medium">Run {scenario.workflowName}</span>
            <p className="text-xs text-[var(--text-muted)]">
              {scenario.setupSteps?.length
                ? "Executes setup steps (on-chain), then runs the CRE workflow with broadcast."
                : "Runs the CRE workflow with broadcast (on-chain writes)."}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={run}
              disabled={isRunning || chainStatus !== "ready" || workflowDone}
              className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[var(--accent-hover)] disabled:opacity-50"
            >
              {isRunning ? (
                <span className="flex items-center gap-2">
                  <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                  </svg>
                  Running...
                </span>
              ) : workflowDone ? (
                <span className="text-[var(--success)]">&#10003; Done</span>
              ) : (
                `Run ${scenario.workflowName.split(" ")[0]}`
              )}
            </button>
            {isRunning && (
              <button
                onClick={stop}
                className="rounded-lg border border-[var(--error)] px-3 py-2 text-sm font-medium text-[var(--error)] hover:bg-[var(--error)]/10"
              >
                Stop
              </button>
            )}
          </div>
        </div>

        {/* Step 3: Settle On-Chain */}
        <div className="flex items-center gap-3">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--bg)] text-xs font-bold text-[var(--text-muted)]">
            3
          </span>
          <div className="flex-1">
            <span className="text-sm font-medium">Settle On-Chain</span>
            <p className="text-xs text-[var(--text-muted)]">
              Executes the settlement pipeline via cast: setProofResult &rarr; schedulePayout &rarr; releasePayout &rarr; markPaid.
            </p>
          </div>
          <button
            onClick={settleOnChain}
            disabled={!workflowDone || settlementStatus === "running" || settlementStatus === "done"}
            className="rounded-lg bg-[var(--success)] px-4 py-2 text-sm font-medium text-white transition-colors hover:brightness-110 disabled:opacity-50"
          >
            {settlementStatus === "running" ? (
              <span className="flex items-center gap-2">
                <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                </svg>
                Settling...
              </span>
            ) : settlementStatus === "done" ? (
              <span>&#10003; Settled</span>
            ) : (
              "Settle"
            )}
          </button>
        </div>

        {settlementError && (
          <div className="rounded-lg border border-[var(--error)]/30 bg-[var(--error)]/5 px-3 py-2 text-xs text-[var(--error)]">
            {settlementError}
          </div>
        )}

        {/* Reset */}
        {(workflowDone || settlementStatus === "done") && (
          <div className="flex justify-end">
            <button
              onClick={reset}
              className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-medium transition-colors hover:bg-[var(--bg-card-hover)]"
            >
              Reset All
            </button>
          </div>
        )}
      </div>

      {/* Setup Steps (Scenario B) */}
      {scenario.setupSteps && scenario.setupSteps.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
            Setup Steps
          </h3>
          {scenario.setupSteps.map((step) => (
            <SetupStepCard
              key={step.id}
              step={step}
              status={setupStatus[step.id] ?? "pending"}
            />
          ))}
        </div>
      )}

      {/* Main Grid: Expected Steps + State Machine + Contract State */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Expected Steps */}
        <div className="lg:col-span-2">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
            Expected Steps ({scenario.expectedSteps.length})
          </h3>
          <div className="space-y-2">
            {scenario.expectedSteps.map((step) => {
              const badge = CAPABILITY_BADGES[step.capability] ?? { label: step.capability, className: "bg-gray-500/20 text-gray-400" };
              return (
                <div
                  key={step.step}
                  className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-3"
                >
                  <div className="flex items-center gap-2">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--bg)] text-xs font-semibold text-[var(--text-muted)]">
                      {step.step}
                    </span>
                    <span className="font-medium text-sm">{step.title}</span>
                    <span className={`ml-auto rounded-full px-2 py-0.5 text-[10px] font-medium ${badge.className}`}>
                      {badge.label}
                    </span>
                  </div>
                  <p className="mt-1.5 text-xs text-[var(--text-muted)]">{step.description}</p>
                  {step.onchainEffect && (
                    <div className="mt-1 text-xs font-mono text-[var(--accent)]">
                      {step.contract}.{step.functionName}() &rarr; {step.onchainEffect}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Sidebar: State Machine + Contract State */}
        <div className="space-y-4">
          <StateMachine claimId={scenario.claimId ?? null} />
          <ContractState
            claimId={scenario.claimId ?? null}
            consentId={scenario.consentId ?? null}
            policyHash={("0x" + "a1".repeat(32)) as `0x${string}`}
          />
        </div>
      </div>

      {/* Outcome Verification Banner */}
      {workflowDone && (
        <OutcomeBanner scenario={scenario} actual={actualOutcome} />
      )}

      {/* CRE Workflow Output */}
      {(logs.length > 0 || isRunning) && (
        <div className="rounded-xl border border-[var(--border)] bg-[#0d0d14] p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-[var(--text-muted)]">
              CRE Workflow Output &mdash; {scenario.workflowName}
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

function deriveOutcome(
  scenario: CREScenario,
  logs: { type: string; text: string }[]
): Record<string, string> {
  const result: Record<string, string> = {};
  // Simple heuristic: look for known state keywords in CRE logs
  const allText = logs.map((l) => l.text).join(" ");
  if (scenario.expectedOutcome.claimState) {
    if (allText.includes("PAID")) result.claimState = "PAID";
    else if (allText.includes("DENIED")) result.claimState = "DENIED";
    else if (allText.includes("CHALLENGED")) result.claimState = "CHALLENGED";
    else if (allText.includes("APPROVED")) result.claimState = "APPROVED";
    else if (allText.includes("SUBMITTED")) result.claimState = "SUBMITTED";
  }
  if (scenario.expectedOutcome.payoutStatus) {
    if (allText.includes("RELEASED")) result.payoutStatus = "RELEASED";
    else if (allText.includes("SCHEDULED")) result.payoutStatus = "SCHEDULED";
    else if (allText.includes("CANCEL")) result.payoutStatus = "CANCELLED";
  }
  if (scenario.expectedOutcome.consentStatus) {
    if (allText.includes("REVOKED")) result.consentStatus = "REVOKED";
    else if (allText.includes("EXPIRED")) result.consentStatus = "EXPIRED";
    else if (allText.includes("ACTIVE")) result.consentStatus = "ACTIVE";
  }
  return result;
}

function OutcomeBanner({
  scenario,
  actual,
}: {
  scenario: CREScenario;
  actual: Record<string, string>;
}) {
  const checks: { label: string; expected: string; got: string | undefined }[] = [];
  const exp = scenario.expectedOutcome;

  if (exp.claimState)
    checks.push({ label: "Claim State", expected: exp.claimState, got: actual.claimState });
  if (exp.payoutStatus)
    checks.push({ label: "Payout", expected: exp.payoutStatus, got: actual.payoutStatus });
  if (exp.consentStatus)
    checks.push({ label: "Consent", expected: exp.consentStatus, got: actual.consentStatus });

  const allPass = checks.every((c) => c.got === c.expected);

  return (
    <div
      className={`rounded-xl border p-4 ${
        allPass
          ? "border-[var(--success)]/30 bg-[var(--success)]/5"
          : "border-[var(--warning)]/30 bg-[var(--warning)]/5"
      }`}
    >
      <h3 className="mb-2 text-sm font-semibold">
        {allPass ? "Outcome Verified" : "Outcome Pending Verification"}
      </h3>
      <div className="flex flex-wrap gap-4">
        {checks.map((c) => (
          <div key={c.label} className="text-sm">
            <span className="text-[var(--text-muted)]">{c.label}: </span>
            <span className="font-medium">Expected {c.expected}</span>
            {c.got && (
              <span
                className={`ml-1 font-medium ${
                  c.got === c.expected ? "text-[var(--success)]" : "text-[var(--warning)]"
                }`}
              >
                / Actual {c.got}
              </span>
            )}
            {!c.got && (
              <span className="ml-1 text-[var(--text-muted)]">/ Check contract state below</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
