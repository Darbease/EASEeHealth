import Link from "next/link";

interface ScenarioCardProps {
  id: string;
  title: string;
  description: string;
  workflow?: string;
  services: string[];
  contracts: string[];
  color: string;
}

export function ScenarioCard({
  id,
  title,
  description,
  workflow,
  services,
  contracts,
  color,
}: ScenarioCardProps) {
  return (
    <Link
      href={`/scenarios/${id}`}
      className="group rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-5 transition-colors hover:bg-[var(--bg-card-hover)]"
    >
      <div className="mb-2 flex items-center gap-2">
        <span
          className="inline-block h-3 w-3 rounded-full"
          style={{ backgroundColor: color }}
        />
        <h3 className="font-semibold">{title}</h3>
      </div>
      <p className="mb-3 text-sm leading-relaxed text-[var(--text-muted)]">
        {description}
      </p>
      {workflow && (
        <div className="mb-3 rounded-md bg-[var(--accent)]/10 px-2.5 py-1 text-xs font-medium text-[var(--accent)]">
          CRE: {workflow}
        </div>
      )}
      <div className="space-y-2 text-xs text-[var(--text-muted)]">
        <div>
          <span className="font-medium text-[var(--text)]">Services: </span>
          {services.join(", ")}
        </div>
        <div>
          <span className="font-medium text-[var(--text)]">Contracts: </span>
          {contracts.join(", ")}
        </div>
      </div>
      <div className="mt-4 text-sm font-medium text-[var(--accent)] group-hover:text-[var(--accent-hover)]">
        Run Scenario &rarr;
      </div>
    </Link>
  );
}
