"use client";

import { useState, useRef, useCallback } from "react";

export interface LogLine {
  type: "log" | "error" | "done";
  text: string;
  timestamp: string;
}

export function colorize(line: LogLine): string {
  if (line.type === "error") return "text-[var(--error)]";
  if (line.type === "done") return "text-[var(--success)] font-semibold";
  if (line.text.includes("[ENCRYPTED]")) return "text-[var(--accent)] font-semibold";
  if (line.text.includes("[USER LOG]")) return "text-[var(--success)]";
  if (line.text.includes("[SIMULATION]")) return "text-[var(--info)]";
  if (line.text.includes("Error") || line.text.includes("error"))
    return "text-[var(--error)]";
  if (line.text.includes("Compiling") || line.text.includes("compiled"))
    return "text-[var(--warning)]";
  return "text-[var(--text)]";
}

export function useWorkflowStream() {
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [activeWorkflow, setActiveWorkflow] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const startWorkflow = useCallback(
    async (workflowId: string, broadcast = false) => {
      if (isRunning) return;
      setActiveWorkflow(workflowId);
      setLogs([]);
      setIsRunning(true);

      const abort = new AbortController();
      abortRef.current = abort;

      try {
        const params = new URLSearchParams({ workflow: workflowId });
        if (broadcast) params.set("broadcast", "true");

        const res = await fetch(`/api/simulate?${params}`, {
          signal: abort.signal,
        });

        if (!res.ok || !res.body) {
          setLogs([
            {
              type: "error",
              text: `Failed to start simulation: ${res.statusText}`,
              timestamp: new Date().toLocaleTimeString(),
            },
          ]);
          setIsRunning(false);
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            try {
              const parsed = JSON.parse(line.slice(6));
              const logLine: LogLine = {
                type: parsed.type,
                text:
                  parsed.type === "done"
                    ? `Process exited with code ${parsed.code}`
                    : parsed.text,
                timestamp: new Date().toLocaleTimeString(),
              };
              setLogs((prev) => [...prev, logLine]);
            } catch {
              // skip malformed lines
            }
          }
        }
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          setLogs((prev) => [
            ...prev,
            {
              type: "error",
              text: `Connection error: ${(err as Error).message}`,
              timestamp: new Date().toLocaleTimeString(),
            },
          ]);
        }
      }

      setIsRunning(false);
    },
    [isRunning]
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
    setIsRunning(false);
  }, []);

  const clearLogs = useCallback(() => {
    setLogs([]);
    setActiveWorkflow(null);
  }, []);

  return { logs, isRunning, activeWorkflow, startWorkflow, stop, clearLogs };
}
