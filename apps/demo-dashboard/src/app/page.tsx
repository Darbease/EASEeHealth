import { SystemHealth } from "@/components/SystemHealth";
import { ScenarioCard } from "@/components/ScenarioCard";
import Link from "next/link";

const scenarios = [
  {
    id: "a",
    title: "Cron Trigger",
    subtitle: "Time-Driven Batch Prior Auth",
    description:
      "CronCapability polls every 30s. WF-001 fetches EHR data, evaluates predicates, settles on-chain. The classic batch pattern.",
    triggerType: "cron" as const,
    workflow: "WF-001",
    amount: "$850.00",
    color: "#217B71",
  },
  {
    id: "b",
    title: "Log Trigger",
    subtitle: "Event-Driven Transfer Settlement",
    description:
      "EVMClient.logTrigger() fires on ClaimSubmitted events. WF-007 reacts instantly — zero polling, zero delay.",
    triggerType: "log" as const,
    workflow: "WF-007",
    amount: "$32,300.00",
    color: "#F7B808",
  },
  {
    id: "c",
    title: "HTTP Trigger",
    subtitle: "On-Demand Prior Auth",
    description:
      "HTTPCapability fires on signed request. WF-008 processes immediately with full payload — no EHR fetch needed.",
    triggerType: "http" as const,
    workflow: "WF-008",
    amount: "$38,000.00",
    color: "#0847F7",
  },
];

const STATS = [
  { value: "8", label: "CRE Workflows" },
  { value: "5", label: "Smart Contracts" },
  { value: "3", label: "Trigger Types" },
  { value: "52", label: "Foundry Tests" },
  { value: "6", label: "Backend Services" },
  { value: "0", label: "PHI On-Chain" },
];

const COMPARISON = [
  {
    traditional: "Fax/portal submission",
    proofpa: "On-chain submitClaim()",
    improvement: "Atomic, timestamped — no lost faxes",
  },
  {
    traditional: "Paper consent form",
    proofpa: "ConsentRegistry on-chain",
    improvement: "Real-time verification, instant revocation",
  },
  {
    traditional: "PDF policy manual",
    proofpa: "PolicyRegistry + versioned hashes",
    improvement: "Deterministic code, not human interpretation",
  },
  {
    traditional: "Nurse clinical review",
    proofpa: "6-8 predicate evaluation",
    improvement: "Reproducible — same inputs, same output",
  },
  {
    traditional: "Paper check (30 days)",
    proofpa: "ERC-20 instant transfer",
    improvement: "Settlement in seconds, not weeks",
  },
  {
    traditional: "Appeal process (months)",
    proofpa: "challengeClaim() state machine",
    improvement: "Structured disputes, automatic payout freeze",
  },
];

export default function DashboardPage() {
  return (
    <div className="space-y-10">
      {/* Hero */}
      <div className="flex items-start justify-between gap-8">
        <div className="space-y-4">
          <h1 className="text-3xl font-extrabold tracking-tight">
            EASE eHealth{" "}
            <span className="text-[#0847F7]">CRE</span> Demo
          </h1>
          <p className="max-w-3xl text-sm leading-relaxed text-[var(--text-muted)]">
            Prior authorization is the most hated process in American healthcare.
            72% of physicians report that delays lead to adverse patient outcomes.
            The average practice spends 14 hours per week on phone calls and fax
            follow-ups. Payers spend billions staffing review queues. And despite
            all this friction, fraud still costs the system $100B+ annually.
          </p>
          <p className="max-w-3xl text-sm leading-relaxed text-[var(--text)]">
            EASE eHealth replaces trust assumptions with cryptographic verification.
            Every consent check, policy lookup, clinical evaluation, and payout
            settlement runs on a Chainlink CRE Decentralized Oracle Network —
            where no single party controls the outcome and every decision is
            auditable on-chain.
          </p>
        </div>
        {/* Chainlink Hexagon */}
        <div className="hidden shrink-0 md:block" style={{ marginRight: "8rem", marginTop: "1.5rem" }}>
          <svg width="180" height="207" viewBox="0 0 180 207" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M90 0L173.827 48.375V145.125L90 193.5L6.17212 145.125V48.375L90 0Z" fill="#0847F7" fillOpacity="0.08" stroke="#0847F7" strokeWidth="1.5" strokeOpacity="0.3"/>
            <path d="M90 24L155.885 61.875V137.625L90 175.5L24.1148 137.625V61.875L90 24Z" fill="#0847F7" fillOpacity="0.04" stroke="#0847F7" strokeWidth="0.75" strokeOpacity="0.15"/>
            {/* Chainlink logo mark */}
            <path d="M90 57L121.177 75V111L90 129L58.823 111V75L90 57Z" fill="none" stroke="#0847F7" strokeWidth="2.5"/>
            <path d="M90 72L105.588 81V99L90 108L74.412 99V81L90 72Z" fill="#0847F7" fillOpacity="0.25" stroke="#8AA6F9" strokeWidth="1.5"/>
            {/* Powered by text */}
            <text x="90" y="156" textAnchor="middle" fill="#7B8BA8" fontSize="11" fontFamily="Inter, system-ui, sans-serif" fontWeight="500">Powered by</text>
            <text x="90" y="171" textAnchor="middle" fill="#8AA6F9" fontSize="13" fontFamily="Inter, system-ui, sans-serif" fontWeight="700">Chainlink CRE</text>
          </svg>
        </div>
      </div>

      {/* By the Numbers */}
      <div className="grid grid-cols-3 gap-3 md:grid-cols-6">
        {STATS.map((s) => (
          <div
            key={s.label}
            className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4 text-center"
          >
            <div className="text-2xl font-extrabold text-[#0847F7]">
              {s.value}
            </div>
            <div className="mt-1 text-xs text-[var(--text-muted)]">
              {s.label}
            </div>
          </div>
        ))}
      </div>

      {/* Traditional vs EASE eHealth */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-6">
        <h2 className="mb-1 text-sm font-bold uppercase tracking-wider text-[var(--text-muted)]">
          Traditional vs EASE eHealth
        </h2>
        <p className="mb-4 text-xs text-[var(--text-muted)]">
          Every step in the old system mapped to a cryptographic equivalent
        </p>
        <div className="space-y-2">
          {COMPARISON.map((row) => (
            <div
              key={row.traditional}
              className="grid grid-cols-3 gap-3 rounded-lg bg-[var(--bg)] p-3 text-xs"
            >
              <div>
                <span className="text-[#E54918] line-through opacity-60">
                  {row.traditional}
                </span>
              </div>
              <div className="font-medium text-[#2ecfbe]">
                {row.proofpa}
              </div>
              <div className="text-[var(--text-muted)]">{row.improvement}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Three-Trigger Architecture */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-6">
        <h2 className="mb-1 text-sm font-bold uppercase tracking-wider text-[var(--text-muted)]">
          Three-Trigger Architecture
        </h2>
        <p className="mb-4 text-xs text-[var(--text-muted)]">
          Each trigger type maps to a different clinical urgency level — a
          production system needs all three
        </p>
        <div className="grid gap-4 md:grid-cols-3">
          {/* Cron */}
          <div className="rounded-lg border border-[#217B71]/20 bg-[var(--bg)] p-4">
            <div className="mb-2 flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#217B71]/15 text-sm font-bold text-[#2ecfbe]">
                30s
              </span>
              <div>
                <div className="text-sm font-semibold">Cron</div>
                <div className="text-xs text-[var(--text-muted)]">
                  Batch processing
                </div>
              </div>
            </div>
            <p className="text-xs leading-relaxed text-[var(--text-muted)]">
              DON fires on a schedule. Mirrors how payers process batches today —
              but every 30 seconds instead of once a week. Catches anything the
              fast-path workflows missed.
            </p>
            <div className="mt-2 text-xs font-medium text-[#2ecfbe]">
              WF-001, WF-004, WF-005, WF-006
            </div>
          </div>

          {/* Log */}
          <div className="rounded-lg border border-[#F7B808]/20 bg-[var(--bg)] p-4">
            <div className="mb-2 flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#F7B808]/15 text-sm font-bold text-[#F7B808]">
                0s
              </span>
              <div>
                <div className="text-sm font-semibold">Log</div>
                <div className="text-xs text-[var(--text-muted)]">
                  Event-driven
                </div>
              </div>
            </div>
            <p className="text-xs leading-relaxed text-[var(--text-muted)]">
              DON monitors on-chain events. The moment a claim is submitted,
              the workflow fires — no queue, no batch window, no human
              pulling the next ticket.
            </p>
            <div className="mt-2 text-xs font-medium text-[#F7B808]">
              WF-003, WF-007
            </div>
          </div>

          {/* HTTP */}
          <div className="rounded-lg border border-[#0847F7]/20 bg-[var(--bg)] p-4">
            <div className="mb-2 flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#0847F7]/15 text-sm font-bold text-[#8AA6F9]">
                0s
              </span>
              <div>
                <div className="text-sm font-semibold">HTTP</div>
                <div className="text-xs text-[var(--text-muted)]">
                  Request-driven
                </div>
              </div>
            </div>
            <p className="text-xs leading-relaxed text-[var(--text-muted)]">
              Provider signs a request and sends it directly to the CRE
              gateway. Workflow fires instantly with full payload — zero
              delay, zero external fetch. The lowest-latency path.
            </p>
            <div className="mt-2 text-xs font-medium text-[#8AA6F9]">
              WF-002, WF-008
            </div>
          </div>
        </div>
      </div>

      {/* Why CRE */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-6">
        <h2 className="mb-1 text-sm font-bold uppercase tracking-wider text-[var(--text-muted)]">
          Why Chainlink CRE
        </h2>
        <p className="mb-4 text-xs text-[var(--text-muted)]">
          If the payer runs the logic, providers don&apos;t trust it. If the
          provider runs it, payers don&apos;t trust it. CRE runs it on a DON —
          nobody has to trust anyone.
        </p>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg)] p-4">
            <div className="text-xs font-bold text-[#8AA6F9]">
              HTTPClient + DON Consensus
            </div>
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              Every DON node makes the same API call independently and compares
              responses. If anyone tampers with the policy API, the workflow
              halts. Every API call is cross-verified by multiple independent
              parties.
            </p>
          </div>
          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg)] p-4">
            <div className="text-xs font-bold text-[#8AA6F9]">
              ConfidentialHTTP + AES-GCM
            </div>
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              DON node operators cannot read encrypted payloads. Clinical data
              stays encrypted end-to-end through the network. More
              HIPAA-compliant than the fax machines it replaces.
            </p>
          </div>
          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg)] p-4">
            <div className="text-xs font-bold text-[#8AA6F9]">
              EVMClient + DON-Signed Writes
            </div>
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              Contracts verify DON signatures via WORKFLOW_ROLE — no single
              entity can forge a claim decision. On-chain reads use
              LATEST_BLOCK_NUMBER for real-time state.
            </p>
          </div>
          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg)] p-4">
            <div className="text-xs font-bold text-[#8AA6F9]">
              HTTPCapability Trigger
            </div>
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              Cryptographic access control via ECDSA signatures — not API keys,
              not OAuth tokens. The DON verifies the provider&apos;s signature
              before executing any logic.
            </p>
          </div>
        </div>
      </div>

      <SystemHealth />

      {/* Scenario Cards */}
      <div>
        <h2 className="mb-1 text-lg font-bold">Demo Scenarios</h2>
        <p className="mb-4 text-sm text-[var(--text-muted)]">
          Each scenario showcases a different CRE trigger type with a real
          settlement pipeline. Reset the chain, run the workflow, settle
          on-chain, and watch the state machine advance in real time.
        </p>
        <div className="grid gap-4 md:grid-cols-3">
          {scenarios.map((s) => (
            <ScenarioCard key={s.id} {...s} />
          ))}
        </div>
      </div>

      {/* Tools */}
      <div className="grid gap-4 md:grid-cols-2">
        <Link
          href="/contracts"
          className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-5 transition-colors hover:border-[#0847F7]/40 hover:bg-[var(--bg-card-hover)]"
        >
          <h3 className="font-bold">Contract Explorer</h3>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            Query claim decisions, payout status, consent, and policy state
            directly from Anvil. Type any claim ID and see the full on-chain
            audit trail.
          </p>
        </Link>
        <Link
          href="/simulate"
          className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-5 transition-colors hover:border-[#0847F7]/40 hover:bg-[var(--bg-card-hover)]"
        >
          <h3 className="font-bold">CRE Simulator</h3>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            Run any of the 8 CRE workflows in simulate or broadcast mode.
            Stream execution output in real time via SSE.
          </p>
        </Link>
      </div>

      {/* Bottom line */}
      <div className="rounded-xl border border-[#0847F7]/20 bg-[#0847F7]/5 p-6 text-center">
        <p className="text-sm leading-relaxed text-[var(--text-muted)]">
          The $528 billion question isn&apos;t whether healthcare administration
          can be automated. It&apos;s whether automation can be{" "}
          <span className="font-bold text-[var(--text)]">
            trusted by all parties simultaneously
          </span>
          . CRE makes that possible. EASE eHealth proves it works.
        </p>
      </div>
    </div>
  );
}
