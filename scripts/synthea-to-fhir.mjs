#!/usr/bin/env node
// ---------------------------------------------------------------------------
// synthea-to-fhir.mjs
//
// Transforms the synthetic Synthea CSVs (data/synthea/) into FHIR R4 JSON
// resources under data/fhir/<ResourceType>/<id>.json — one file per resource.
// provider-adapter-api serves these via GET /fhir/r4/{ResourceType}/{id}.
//
// Resource types emitted: Patient, Coverage, Condition, Procedure,
// ServiceRequest, DocumentReference. Shapes borrow from US Core / Da Vinci
// PAS (sensible references + codings with system/code/display), not full
// conformance.
//
// Everything is deterministic: ids derive from the CSV ids (Condition and
// Procedure rows have no CSV id, so their ids derive from patient segment +
// code + a stable collision counter). No Math.random / Date.now anywhere.
//
// The Coverage→on-chain bridge: coverages whose payer has an on-chain plan
// carry the planHash in `class` (type code "plan", value = planHash hex).
//
// Usage:  node scripts/synthea-to-fhir.mjs   (or `make fhir-regen`)
// ---------------------------------------------------------------------------
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SYNTHEA = join(ROOT, "data", "synthea");
const OUT = join(ROOT, "data", "fhir");

// Coding systems
const SNOMED = "http://snomed.info/sct";
const CPT = "http://www.ama-assn.org/go/cpt";
const COVERAGE_CLASS = "http://terminology.hl7.org/CodeSystem/coverage-class";
const SUBSCRIBER_REL = "http://terminology.hl7.org/CodeSystem/subscriber-relationship";
const CONDITION_CLINICAL = "http://terminology.hl7.org/CodeSystem/condition-clinical";
const CONDITION_VER = "http://terminology.hl7.org/CodeSystem/condition-ver-status";
const LOINC = "http://loinc.org";

// Local systems / extension URLs (documented in docs/FHIR_SUBSTRATE.md)
const MEMBER_ID_SYSTEM = "https://ease-ehealth.example/member-id";
const NECESSITY_LETTER_SYSTEM = "https://ease-ehealth.example/necessity-letter";
const EXT_REQUESTED_AMOUNT = "https://ease-ehealth.example/fhir/StructureDefinition/requested-amount";

// On-chain plan bridge: payer org id -> planHash (mirrors contracts/ seed data).
// Payers absent from this map have no on-chain plan and no `class` entry.
const PLAN_HASH_BY_PAYER = {
  "a1b2c3d4-1001-4000-8000-000000000001": "0x" + "a1".repeat(32), // BlueCross Preferred PPO
  "a1b2c3d4-1002-4000-8000-000000000002": "0x" + "b2".repeat(32), // Aetna Gold HMO
};

// ─── CSV plumbing ────────────────────────────────────────────────────
function parseCsv(text) {
  const [header, ...lines] = text.trim().split(/\r?\n/);
  const cols = header.split(",");
  return lines.map((line) => {
    const cells = line.split(",");
    return Object.fromEntries(cols.map((c, i) => [c, cells[i] ?? ""]));
  });
}
const csv = (name) => parseCsv(readFileSync(join(SYNTHEA, `${name}.csv`), "utf8"));

const patients = csv("patients");
const payers = csv("payers");
const payerTransitions = csv("payer_transitions");
const organizations = csv("organizations");
const conditions = csv("conditions");
const procedures = csv("procedures");

const payerName = (id) => payers.find((p) => p.Id === id)?.Name ?? id;
const orgName = (id) => organizations.find((o) => o.Id === id)?.Name ?? id;
const patientName = (id) => {
  const p = patients.find((x) => x.Id === id);
  return p ? `${p.First} ${p.Last}` : id;
};
// Second UUID segment ("0001") — stable short handle for derived ids.
const seg = (uuid) => uuid.split("-")[1] ?? uuid;

// ─── Emit helpers ────────────────────────────────────────────────────
const counts = {};
function emit(resource) {
  const dir = join(OUT, resource.resourceType);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${resource.id}.json`), JSON.stringify(resource, null, 2) + "\n");
  counts[resource.resourceType] = (counts[resource.resourceType] ?? 0) + 1;
}

// Start clean so removed CSV rows do not leave stale resources behind.
rmSync(OUT, { recursive: true, force: true });

// ─── Patient ─────────────────────────────────────────────────────────
for (const p of patients) {
  emit({
    resourceType: "Patient",
    id: p.Id,
    identifier: [
      { system: "https://ease-ehealth.example/mrn", value: p.Id },
      { system: "http://hl7.org/fhir/sid/us-ssn", value: p.SSN },
    ],
    name: [
      {
        family: p.Last,
        given: [p.First, p.Middle].filter(Boolean),
        ...(p.Prefix ? { prefix: [p.Prefix] } : {}),
      },
    ],
    gender: p.Gender === "F" ? "female" : "male",
    birthDate: p.BirthDate,
    address: [
      { line: [p.Address], city: p.City, state: p.State, postalCode: p.Zip },
    ],
  });
}

// ─── Coverage (from payer_transitions) ───────────────────────────────
// id = cov-<Member ID>; subscriberId = Member ID; planHash rides in class.
function coverageResource({ id, status, patientId, memberId, payerId, periodStart, periodEnd, ownership }) {
  const planHash = PLAN_HASH_BY_PAYER[payerId];
  return {
    resourceType: "Coverage",
    id,
    identifier: [{ system: MEMBER_ID_SYSTEM, value: memberId }],
    status,
    subscriberId: memberId,
    beneficiary: { reference: `Patient/${patientId}`, display: patientName(patientId) },
    relationship: {
      coding: [
        {
          system: SUBSCRIBER_REL,
          code: ownership === "Self" ? "self" : "other",
          display: ownership === "Self" ? "Self" : "Other",
        },
      ],
    },
    payor: [{ reference: `Organization/${payerId}`, display: payerName(payerId) }],
    period: { start: periodStart, end: periodEnd },
    ...(planHash
      ? {
          class: [
            {
              type: { coding: [{ system: COVERAGE_CLASS, code: "plan", display: "Plan" }] },
              value: planHash,
              name: payerName(payerId),
            },
          ],
        }
      : {}),
  };
}

for (const t of payerTransitions) {
  emit(
    coverageResource({
      id: `cov-${t["Member ID"]}`,
      status: "active",
      patientId: t.Patient,
      memberId: t["Member ID"],
      payerId: t.Payer,
      periodStart: `${t.Start_Year}-01-01`,
      periodEnd: `${t.End_Year}-12-31`,
      ownership: t.Ownership,
    }),
  );
}

// Demo fixture: a lapsed BlueCross coverage James Patterson does NOT hold —
// status "cancelled", still carrying the plan-A planHash. Referenced by
// ServiceRequest sr-knee-mri-inelig-0004 (the DENY-ineligible path).
const JAMES = "c1d2e3f4-0002-4000-8000-000000000002";
const JAMES_MEMBER = "e1f2a3b4-0002-4000-8000-000000000002";
const BLUECROSS = "a1b2c3d4-1001-4000-8000-000000000001";
emit(
  coverageResource({
    id: "cov-inelig-bluecross-0002",
    status: "cancelled",
    patientId: JAMES,
    memberId: JAMES_MEMBER,
    payerId: BLUECROSS,
    periodStart: "2018-01-01",
    periodEnd: "2018-12-31",
    ownership: "Self",
  }),
);

// ─── Condition ───────────────────────────────────────────────────────
// No CSV id — derive: cond-<code>-<patient segment>[-n on collision].
const usedIds = new Set();
function derivedId(prefix, code, patientId) {
  const base = `${prefix}-${code}-${seg(patientId)}`;
  let id = base;
  for (let n = 2; usedIds.has(id); n++) id = `${base}-${n}`;
  usedIds.add(id);
  return id;
}

for (const c of conditions) {
  emit({
    resourceType: "Condition",
    id: derivedId("cond", c.Code, c.Patient),
    clinicalStatus: {
      coding: [
        {
          system: CONDITION_CLINICAL,
          code: c.Stop ? "resolved" : "active",
          display: c.Stop ? "Resolved" : "Active",
        },
      ],
    },
    verificationStatus: {
      coding: [{ system: CONDITION_VER, code: "confirmed", display: "Confirmed" }],
    },
    code: {
      coding: [{ system: SNOMED, code: c.Code, display: c.Description }],
      text: c.Description,
    },
    subject: { reference: `Patient/${c.Patient}`, display: patientName(c.Patient) },
    encounter: { reference: `Encounter/${c.Encounter}` },
    onsetDateTime: c.Start,
    ...(c.Stop ? { abatementDateTime: c.Stop } : {}),
  });
}

// ─── Procedure ───────────────────────────────────────────────────────
for (const p of procedures) {
  emit({
    resourceType: "Procedure",
    id: derivedId("proc", p.Code, p.Patient),
    status: "completed",
    code: {
      coding: [{ system: SNOMED, code: p.Code, display: p.Description }],
      text: p.Description,
    },
    subject: { reference: `Patient/${p.Patient}`, display: patientName(p.Patient) },
    encounter: { reference: `Encounter/${p.Encounter}` },
    performedPeriod: { start: p.Start, ...(p.Stop ? { end: p.Stop } : {}) },
    ...(p.ReasonCode
      ? {
          reasonCode: [
            { coding: [{ system: SNOMED, code: p.ReasonCode, display: p.ReasonDescription }] },
          ],
        }
      : {}),
  });
}

// ─── Demo ServiceRequest + DocumentReference fixtures ────────────────
// Aligned to the curated necessity letter data/necessity-letters/PROC_KNEE_MRI.md.
const MARIA = "c1d2e3f4-0001-4000-8000-000000000001";
const MARIA_COVERAGE = "cov-e1f2a3b4-0001-4000-8000-000000000001";
const PACIFIC_ORTHO = "b1a2c3d4-0002-4000-8000-000000000002";
const MERCY_GENERAL = "b1a2c3d4-0001-4000-8000-000000000001";

const KNEE_MRI_CODE = {
  coding: [
    { system: CPT, code: "73721", display: "MRI lower extremity joint w/o contrast" },
    { system: SNOMED, code: "241615005", display: "MRI of knee" },
  ],
  text: "MRI of the right knee, without contrast",
};
const OA_KNEE_REASON = [
  { coding: [{ system: SNOMED, code: "239872002", display: "Osteoarthritis of knee" }] },
];

function serviceRequest({ id, patientId, code, reasonCode, orgId, coverageId, amountUsd, occurrence, documentReferenceId }) {
  return {
    resourceType: "ServiceRequest",
    id,
    status: "active",
    intent: "order",
    code,
    subject: { reference: `Patient/${patientId}`, display: patientName(patientId) },
    requester: { reference: `Organization/${orgId}`, display: orgName(orgId) },
    performer: [{ reference: `Organization/${orgId}`, display: orgName(orgId) }],
    insurance: [{ reference: `Coverage/${coverageId}` }],
    reasonCode,
    occurrenceDateTime: occurrence,
    extension: [
      { url: EXT_REQUESTED_AMOUNT, valueMoney: { value: amountUsd, currency: "USD" } },
    ],
    ...(documentReferenceId
      ? { supportingInfo: [{ reference: `DocumentReference/${documentReferenceId}` }] }
      : {}),
  };
}

// APPROVE path — in-network org, active BlueCross coverage, covered CPT, within cap.
emit(
  serviceRequest({
    id: "sr-knee-mri-0001",
    patientId: MARIA,
    code: KNEE_MRI_CODE,
    reasonCode: OA_KNEE_REASON,
    orgId: PACIFIC_ORTHO,
    coverageId: MARIA_COVERAGE,
    amountUsd: 850.0,
    occurrence: "2026-07-15",
    documentReferenceId: "dr-knee-mri-0001",
  }),
);

// DENY — procedure not covered by the plan (acupuncture).
emit(
  serviceRequest({
    id: "sr-acupuncture-0002",
    patientId: MARIA,
    code: {
      coding: [
        { system: CPT, code: "97810", display: "Acupuncture w/o electrical stimulation, initial 15 min" },
        { system: SNOMED, code: "44868003", display: "Acupuncture" },
      ],
      text: "Acupuncture, initial visit",
    },
    reasonCode: OA_KNEE_REASON,
    orgId: PACIFIC_ORTHO,
    coverageId: MARIA_COVERAGE,
    amountUsd: 120.0,
    occurrence: "2026-07-15",
  }),
);

// DENY — out-of-network: same request as 0001 but from Mercy General Hospital.
emit(
  serviceRequest({
    id: "sr-knee-mri-oon-0003",
    patientId: MARIA,
    code: KNEE_MRI_CODE,
    reasonCode: OA_KNEE_REASON,
    orgId: MERCY_GENERAL,
    coverageId: MARIA_COVERAGE,
    amountUsd: 850.0,
    occurrence: "2026-07-15",
    documentReferenceId: "dr-knee-mri-0001",
  }),
);

// DENY — ineligible: James Patterson pointing at a cancelled BlueCross
// coverage he does not actually hold (his active payer is UnitedHealth).
emit(
  serviceRequest({
    id: "sr-knee-mri-inelig-0004",
    patientId: JAMES,
    code: KNEE_MRI_CODE,
    reasonCode: OA_KNEE_REASON,
    orgId: PACIFIC_ORTHO,
    coverageId: "cov-inelig-bluecross-0002",
    amountUsd: 850.0,
    occurrence: "2026-07-15",
  }),
);

// DocumentReference — the necessity letter behind sr-knee-mri-0001. The
// identifier value (PROC_KNEE_MRI) maps to data/necessity-letters/<value>.md;
// provider-adapter-api serves the raw markdown at content.attachment.url.
emit({
  resourceType: "DocumentReference",
  id: "dr-knee-mri-0001",
  identifier: [{ system: NECESSITY_LETTER_SYSTEM, value: "PROC_KNEE_MRI" }],
  status: "current",
  type: {
    coding: [{ system: LOINC, code: "34109-9", display: "Note" }],
    text: "Letter of medical necessity",
  },
  subject: { reference: `Patient/${MARIA}`, display: patientName(MARIA) },
  date: "2026-02-15T00:00:00Z",
  author: [{ reference: `Organization/${PACIFIC_ORTHO}`, display: orgName(PACIFIC_ORTHO) }],
  description: "Letter of medical necessity — MRI right knee (CPT 73721)",
  content: [
    {
      attachment: {
        contentType: "text/markdown",
        url: "/fhir/r4/DocumentReference/dr-knee-mri-0001/$content",
        title: "PROC_KNEE_MRI.md",
      },
    },
  ],
});

const total = Object.values(counts).reduce((a, b) => a + b, 0);
console.log(`Wrote ${total} FHIR resources to ${OUT}:`);
for (const [type, n] of Object.entries(counts)) console.log(`  ${type}: ${n}`);
