import { SystemHealth } from "@/components/SystemHealth";
import { ScenarioCard } from "@/components/ScenarioCard";
import Link from "next/link";

const scenarios = [
  {
    id: "a",
    title: "Scenario A — Happy Path",
    description:
      "Valid attestation + proof → APPROVED → PAID. Runs WF-001 (10 steps, 5 on-chain writes).",
    workflow: "WF-001 Prior Auth Decision",
    services: ["Provider Adapter", "Proof Service", "Callback Service"],
    contracts: ["ClaimDecisionRegistry", "ClaimEscrow"],
    color: "var(--success)",
  },
  {
    id: "b",
    title: "Scenario B — Revoked Consent",
    description:
      "Patient revokes consent → on-chain sync via CRE. Runs WF-002 (4 steps, consent sync).",
    workflow: "WF-002 Consent Revocation",
    services: ["Consent Service"],
    contracts: ["ConsentRegistry"],
    color: "var(--error)",
  },
  {
    id: "c",
    title: "Scenario C — Challenge",
    description:
      "Approved claim challenged → payout blocked → resolved. Runs WF-003 (6 steps, 3 on-chain writes).",
    workflow: "WF-003 Challenge Resolution",
    services: ["Provider Adapter", "Callback Service"],
    contracts: ["ClaimDecisionRegistry", "ClaimEscrow"],
    color: "var(--warning)",
  },
];

export default function DashboardPage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Demo Dashboard</h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          Interactive walkthrough of ProofPA scenarios — click through each step,
          view API responses, and inspect on-chain state.
        </p>
      </div>

      <SystemHealth />

      <div>
        <h2 className="mb-4 text-lg font-semibold">Scenarios</h2>
        <div className="grid gap-4 md:grid-cols-3">
          {scenarios.map((s) => (
            <ScenarioCard key={s.id} {...s} />
          ))}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Link
          href="/contracts"
          className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-5 transition-colors hover:bg-[var(--bg-card-hover)]"
        >
          <h3 className="font-semibold">Contract Explorer</h3>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            Look up claim decisions, payout status, consent, and policy state
            directly from Anvil.
          </p>
        </Link>
        <Link
          href="/simulate"
          className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-5 transition-colors hover:bg-[var(--bg-card-hover)]"
        >
          <h3 className="font-semibold">CRE Simulator</h3>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            Trigger Chainlink CRE workflow simulations and stream real-time
            output from the DON.
          </p>
        </Link>
      </div>
    </div>
  );
}
