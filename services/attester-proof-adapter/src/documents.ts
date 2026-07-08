// ---------------------------------------------------------------------------
// Document resolution — maps a claim's procedure_code to its synthetic clinical
// necessity letter (data/necessity-letters/<PROC>.md). This is the unstructured
// artifact the TEE model reasons over.
// ---------------------------------------------------------------------------
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

// services/attester-proof-adapter/src -> repo root /data/necessity-letters
const DEFAULT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "data", "necessity-letters");

export function resolveLettersDir(override: string | undefined): string {
  if (!override) return DEFAULT_DIR;
  return isAbsolute(override) ? override : join(process.cwd(), override);
}

export interface ResolvedDocument {
  content: string;
  filename: string;
  source: "letter" | "synthesized";
}

export function loadNecessityLetter(procedureCode: string, dir: string): ResolvedDocument {
  const path = join(dir, `${procedureCode}.md`);
  if (existsSync(path)) {
    return { content: readFileSync(path, "utf8"), filename: `${procedureCode}.md`, source: "letter" };
  }
  // No curated letter — synthesize a minimal stand-in so the model still has
  // a document to evaluate (keeps the demo robust for unseen procedures).
  return {
    content:
      `# Medical-Necessity Request (synthesized)\n\n` +
      `No detailed clinical letter is on file for procedure ${procedureCode}. ` +
      `Treat the structured policy inputs as the available evidence.\n`,
    filename: `${procedureCode}.synthesized.md`,
    source: "synthesized",
  };
}
