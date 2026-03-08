"use client";

import { useQuery } from "@tanstack/react-query";
import { createPublicClient, http } from "viem";
import { foundry } from "viem/chains";
import { CONTRACTS, claimDecisionRegistryAbi, CLAIM_STATES } from "@/config/contracts";

const client = createPublicClient({
  chain: foundry,
  transport: http("http://127.0.0.1:8545"),
});

const NODES = [
  { state: "NONE", x: 50, y: 50, label: "NONE" },
  { state: "SUBMITTED", x: 200, y: 50, label: "SUBMITTED" },
  { state: "PROOF_PENDING", x: 370, y: 50, label: "PROOF_PENDING" },
  { state: "APPROVED", x: 540, y: 50, label: "APPROVED" },
  { state: "DENIED", x: 370, y: 150, label: "DENIED" },
  { state: "CHALLENGED", x: 540, y: 150, label: "CHALLENGED" },
  { state: "PAID", x: 700, y: 50, label: "PAID" },
] as const;

const EDGES = [
  { from: "NONE", to: "SUBMITTED" },
  { from: "SUBMITTED", to: "PROOF_PENDING" },
  { from: "PROOF_PENDING", to: "APPROVED" },
  { from: "PROOF_PENDING", to: "DENIED" },
  { from: "APPROVED", to: "PAID" },
  { from: "APPROVED", to: "CHALLENGED" },
  { from: "CHALLENGED", to: "APPROVED" },
  { from: "CHALLENGED", to: "DENIED" },
] as const;

export function getNodeColor(
  nodeState: string,
  activeState: string | null
): { fill: string; stroke: string; text: string } {
  if (activeState === nodeState) {
    if (nodeState === "PAID") return { fill: "#22c55e20", stroke: "#22c55e", text: "#22c55e" };
    if (nodeState === "DENIED") return { fill: "#ef444420", stroke: "#ef4444", text: "#ef4444" };
    if (nodeState === "CHALLENGED") return { fill: "#f59e0b20", stroke: "#f59e0b", text: "#f59e0b" };
    return { fill: "#6366f120", stroke: "#6366f1", text: "#6366f1" };
  }
  return { fill: "#12121a", stroke: "#2a2a3e", text: "#8888a0" };
}

interface StateMachineProps {
  claimId?: `0x${string}` | null;
}

export function StateMachine({ claimId }: StateMachineProps) {
  const { data: decision } = useQuery({
    queryKey: ["sm-decision", claimId],
    queryFn: async () => {
      if (!claimId) return null;
      return client.readContract({
        address: CONTRACTS.ClaimDecisionRegistry as `0x${string}`,
        abi: claimDecisionRegistryAbi,
        functionName: "getDecision",
        args: [claimId],
      });
    },
    enabled: !!claimId,
    refetchInterval: 2_000,
  });

  const stateIndex = decision ? Number(decision.state) : 0;
  const activeStateName = claimId ? (CLAIM_STATES[stateIndex] ?? null) : null;

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
        Claim State Machine
      </h3>
      <svg viewBox="0 0 780 200" className="w-full" style={{ maxHeight: 200 }}>
        <defs>
          <marker
            id="arrowhead"
            markerWidth="8"
            markerHeight="6"
            refX="8"
            refY="3"
            orient="auto"
          >
            <polygon points="0 0, 8 3, 0 6" fill="#2a2a3e" />
          </marker>
          <marker
            id="arrowhead-active"
            markerWidth="8"
            markerHeight="6"
            refX="8"
            refY="3"
            orient="auto"
          >
            <polygon points="0 0, 8 3, 0 6" fill="#6366f1" />
          </marker>
        </defs>

        {EDGES.map(({ from, to }) => {
          const fromNode = NODES.find((n) => n.state === from)!;
          const toNode = NODES.find((n) => n.state === to)!;
          const isActive =
            activeStateName === from || activeStateName === to;
          return (
            <line
              key={`${from}-${to}`}
              x1={fromNode.x + 50}
              y1={fromNode.y + 15}
              x2={toNode.x - 5}
              y2={toNode.y + 15}
              stroke={isActive ? "#6366f1" : "#2a2a3e"}
              strokeWidth={isActive ? 2 : 1}
              markerEnd={isActive ? "url(#arrowhead-active)" : "url(#arrowhead)"}
            />
          );
        })}

        {NODES.map((node) => {
          const colors = getNodeColor(node.state, activeStateName);
          return (
            <g key={node.state}>
              <rect
                x={node.x - 10}
                y={node.y}
                width={node.state === "PROOF_PENDING" ? 120 : 100}
                height={30}
                rx={6}
                fill={colors.fill}
                stroke={colors.stroke}
                strokeWidth={activeStateName === node.state ? 2 : 1}
              />
              <text
                x={node.x + (node.state === "PROOF_PENDING" ? 50 : 40)}
                y={node.y + 19}
                textAnchor="middle"
                fill={colors.text}
                fontSize={10}
                fontWeight={activeStateName === node.state ? 700 : 400}
                fontFamily="system-ui"
              >
                {node.label}
              </text>
            </g>
          );
        })}
      </svg>
      {activeStateName && (
        <div className="mt-2 text-center text-sm">
          Current: <span className="font-semibold text-[var(--accent)]">{activeStateName}</span>
        </div>
      )}
    </div>
  );
}
