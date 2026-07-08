#!/usr/bin/env node
// ---------------------------------------------------------------------------
// generate-necessity-letters.mjs
//
// Emits data-driven baseline medical-necessity letters from the Synthea rows,
// one per covered procedure, into data/necessity-letters/generated/.
//
// The curated letters in data/necessity-letters/*.md are the demo set; this
// generator is for reproducibility and for bootstrapping a letter when a new
// scenario is added. All output is synthetic — no real PHI.
//
// Usage:  node scripts/generate-necessity-letters.mjs
// ---------------------------------------------------------------------------
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SYNTHEA = join(ROOT, "data", "synthea");
const OUT = join(ROOT, "data", "necessity-letters", "generated");

// SNOMED procedure code -> { proc, cpt, label } (mirrors WF-001 SNOMED_TO_PROC + CLINICAL.procedures)
const SNOMED_TO_PROC = {
  "241615005": { proc: "PROC_KNEE_MRI", cpt: "73721", label: "MRI of the knee, without contrast" },
  "36969009":  { proc: "PROC_CARDIAC_CT", cpt: "75574", label: "CT angiography of the heart, with contrast" },
  "175066001": { proc: "PROC_CARDIAC_CT", cpt: "75574", label: "CT angiography of the heart, with contrast" },
  "232717009": { proc: "PROC_CARDIAC_CT", cpt: "75574", label: "CT angiography of the heart, with contrast" },
  "40701008":  { proc: "PROC_CARDIAC_CT", cpt: "75574", label: "CT angiography of the heart, with contrast" },
  "418766005": { proc: "PROC_CARDIAC_CT", cpt: "75574", label: "CT angiography of the heart, with contrast" },
  "399208008": { proc: "PROC_SPINE_XRAY", cpt: "72100", label: "Radiologic examination, lumbosacral spine" },
};

function parseCsv(text) {
  const [header, ...lines] = text.trim().split(/\r?\n/);
  const cols = header.split(",");
  return lines.map((line) => {
    const cells = line.split(",");
    return Object.fromEntries(cols.map((c, i) => [c, cells[i]]));
  });
}

const procedures = parseCsv(readFileSync(join(SYNTHEA, "procedures.csv"), "utf8"));
const conditions = parseCsv(readFileSync(join(SYNTHEA, "conditions.csv"), "utf8"));

// First diagnosis per patient, for clinical context.
const dxByPatient = {};
for (const c of conditions) {
  if (!dxByPatient[c.Patient]) dxByPatient[c.Patient] = c.Description;
}

mkdirSync(OUT, { recursive: true });
const seen = new Set();
let written = 0;

for (const p of procedures) {
  const map = SNOMED_TO_PROC[p.Code];
  if (!map || seen.has(map.proc)) continue;
  seen.add(map.proc);

  const dx = dxByPatient[p.Patient] ?? p.ReasonDescription ?? "clinical indication";
  const charge = Number(p.Base_Cost ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2 });

  const letter = `# Letter of Medical Necessity (generated baseline)

**Requested Procedure:** CPT ${map.cpt} — ${map.label}
**Primary Diagnosis:** ${dx}
**Documented Indication:** ${p.ReasonDescription ?? dx}
**Estimated Charge:** $${charge}

## Clinical Summary

The ordering provider documents ${String(dx).toLowerCase()} as the working diagnosis, with ${String(
    p.ReasonDescription ?? dx,
  ).toLowerCase()} as the indication for the requested study. Conservative and first-line measures have been pursued without adequate resolution, and the requested ${map.label.toLowerCase()} is the appropriate next diagnostic step to direct further management.

## Rationale

The request meets standard payer criteria for ${map.label.toLowerCase()} given the documented diagnosis and indication, is consistent with the member's plan coverage for CPT ${map.cpt}, and falls within the applicable imaging cap. Approval is requested.

*Generated baseline — replace with a curated letter for demo use.*
`;

  writeFileSync(join(OUT, `${map.proc}.md`), letter);
  written++;
  console.log(`generated ${map.proc}.md  (CPT ${map.cpt}, dx: ${dx})`);
}

console.log(`\nDone — ${written} baseline letter(s) written to data/necessity-letters/generated/`);
