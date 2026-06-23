# Synthetic Medical-Necessity Letters

Unstructured clinical documents for the **Confidential AI Attester** integration. The Attester reasons over a *document*; EASE eHealth's native data is all coded Synthea CSV (SNOMED/ICD-10/CPT/RxNorm), so these letters supply the unstructured artifact the TEE model evaluates.

**All content is fictional — no real PHI.** Letters are derived from the demo scenarios in `packages/schemas/src/demo-clinical-data.ts` (`CLINICAL`) and the rows in `data/synthea/{conditions,procedures,encounters}.csv`.

## Files

One curated letter per covered procedure, keyed by the `PROC_*` code used throughout the services and workflows:

| File | Procedure (CPT) | Scenario |
|------|-----------------|----------|
| `PROC_KNEE_MRI.md`   | 73721 — MRI knee, no contrast        | Maria Garcia · M17.11 right-knee OA · Dr. Chen |
| `PROC_CARDIAC_CT.md` | 75574 — Coronary CT angiography      | James Patterson · I25.10 · Dr. Torres |
| `PROC_SPINE_XRAY.md` | 72100 — Lumbosacral spine X-ray      | Low back pain with red-flag features |

## How they're consumed

`services/attester-proof-adapter` resolves the letter for a claim by its `procedure_code`, base64-encodes it into the Attester `/v1/inference` request as `resources[].content_base64`, and the TEE model renders the medical-necessity verdict over it.

## Regenerating baselines

`scripts/generate-necessity-letters.mjs` emits data-driven baseline letters into `generated/` from the Synthea rows (join procedures→conditions on patient + SNOMED→PROC/CPT mapping). The curated `.md` files above are the demo set; the generator is for reproducibility and for bootstrapping letters when new scenarios are added.

```bash
node scripts/generate-necessity-letters.mjs
```
