"use client";

import { JsonViewer } from "./JsonViewer";

export type StepStatus = "pending" | "running" | "success" | "error";

export interface StepEntry {
  id: string;
  title: string;
  method?: string;
  url?: string;
  status: StepStatus;
  request?: unknown;
  response?: unknown;
  error?: string;
  timestamp?: string;
}

function StatusIcon({ status }: { status: StepStatus }) {
  switch (status) {
    case "pending":
      return (
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--bg)] text-[var(--text-muted)]">
          <span className="h-2 w-2 rounded-full bg-[var(--border)]" />
        </span>
      );
    case "running":
      return (
        <span className="flex h-6 w-6 items-center justify-center">
          <svg className="h-5 w-5 animate-spin text-[var(--accent)]" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
          </svg>
        </span>
      );
    case "success":
      return (
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--success)]/20 text-[var(--success)]">
          <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
          </svg>
        </span>
      );
    case "error":
      return (
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--error)]/20 text-[var(--error)]">
          <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
          </svg>
        </span>
      );
  }
}

export function StepLog({ steps }: { steps: StepEntry[] }) {
  return (
    <div className="space-y-3">
      {steps.map((step, i) => (
        <div
          key={step.id}
          className={`step-enter rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4 ${
            step.status === "running" ? "ring-1 ring-[var(--accent)]" : ""
          }`}
        >
          <div className="flex items-start gap-3">
            <StatusIcon status={step.status} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-[var(--text-muted)]">
                  Step {i + 1}
                </span>
                {step.timestamp && (
                  <span className="text-xs text-[var(--text-muted)]">
                    {step.timestamp}
                  </span>
                )}
              </div>
              <h4 className="mt-0.5 font-medium">{step.title}</h4>
              {step.method && step.url && (
                <code className="mt-1 block text-xs text-[var(--text-muted)]">
                  <span className="font-semibold text-[var(--accent)]">
                    {step.method}
                  </span>{" "}
                  {step.url}
                </code>
              )}
              {step.error && (
                <div className="mt-2 rounded-lg bg-[var(--error)]/10 p-3 text-sm text-[var(--error)]">
                  {step.error}
                </div>
              )}
              {step.response !== undefined && step.response !== null && step.status !== "pending" && (
                <div className="mt-3">
                  <details open={step.status === "success" || step.status === "error"}>
                    <summary className="cursor-pointer text-xs font-medium text-[var(--text-muted)] hover:text-[var(--text)]">
                      Response
                    </summary>
                    <div className="mt-2">
                      <JsonViewer data={step.response} />
                    </div>
                  </details>
                </div>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
