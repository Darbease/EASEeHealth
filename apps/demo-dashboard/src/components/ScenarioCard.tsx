import Link from "next/link";
import type { TriggerType } from "@/lib/scenarios";

const TRIGGER_STYLES: Record<TriggerType, { label: string; icon: string; className: string }> = {
  cron: {
    label: "Cron",
    icon: "clock",
    className: "bg-[#217B71]/15 text-[#2ecfbe] border-[#217B71]/40",
  },
  log: {
    label: "Log",
    icon: "bolt",
    className: "bg-[#F7B808]/15 text-[#F7B808] border-[#F7B808]/40",
  },
  http: {
    label: "HTTP",
    icon: "arrow",
    className: "bg-[#0847F7]/15 text-[#8AA6F9] border-[#0847F7]/40",
  },
};

interface ScenarioCardProps {
  id: string;
  title: string;
  subtitle: string;
  description: string;
  triggerType: TriggerType;
  workflow: string;
  amount?: string;
  color: string;
}

export function ScenarioCard({
  id,
  title,
  subtitle,
  description,
  triggerType,
  workflow,
  amount,
  color,
}: ScenarioCardProps) {
  const trigger = TRIGGER_STYLES[triggerType];

  return (
    <Link
      href={`/scenarios/${id}`}
      className="group flex flex-col rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-5 transition-colors hover:bg-[var(--bg-card-hover)]"
    >
      <div className="mb-3 flex items-center justify-between">
        <span
          className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${trigger.className}`}
        >
          {trigger.label} Trigger
        </span>
        <span
          className="inline-block h-2.5 w-2.5 rounded-full"
          style={{ backgroundColor: color }}
        />
      </div>
      <h3 className="text-lg font-bold">{title}</h3>
      <p className="text-sm text-[var(--text-muted)]">{subtitle}</p>
      <p className="mt-3 flex-1 text-sm leading-relaxed text-[var(--text-muted)]">
        {description}
      </p>
      <div className="mt-4 flex items-center justify-between">
        <span className="rounded-md bg-[var(--accent)]/10 px-2.5 py-1 text-xs font-medium text-[var(--accent)]">
          {workflow}
        </span>
        {amount && (
          <span className="text-sm font-semibold text-[var(--text)]">{amount}</span>
        )}
      </div>
      <div className="mt-3 text-sm font-medium text-[var(--accent)] group-hover:text-[var(--accent-hover)]">
        Run Demo &rarr;
      </div>
    </Link>
  );
}
