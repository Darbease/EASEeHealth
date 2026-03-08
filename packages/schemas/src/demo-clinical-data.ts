// ---------------------------------------------------------------------------
// Synthetic clinical data for demo purposes.
// Maps to existing hex hash constants used across services and workflows.
// All data is fictional — no real PHI. Off-chain use only.
// ---------------------------------------------------------------------------

export const CLINICAL = {
  patients: {
    /** Scenario A/B — maps to subject_id_hash "patient-demo-abc" */
    primary: {
      name: "Maria Garcia",
      dob: "1968-04-12",
      gender: "F",
      mrn: "MRG-2026-0847",
      memberId: "BCX-9284710",
      diagnosis: {
        code: "M17.11",
        display: "Primary osteoarthritis, right knee",
      },
    },
    /** Scenario C — cardiac CT challenge */
    secondary: {
      name: "James Patterson",
      dob: "1955-09-23",
      gender: "M",
      mrn: "JPT-2026-1102",
      memberId: "BCX-6391842",
      diagnosis: {
        code: "I25.10",
        display: "Atherosclerotic heart disease of native coronary artery",
      },
    },
  },

  providers: {
    /** Maps to provider_id_hash 0xb2b2...b2 */
    primary: {
      name: "Dr. Sarah Chen",
      npi: "1234567890",
      specialty: "Orthopedic Surgery",
      practice: "Summit Orthopedics & Sports Medicine",
      credentials: "MD, FAAOS",
      providerIdHash: ("0x" + "b2".repeat(32)) as `0x${string}`,
    },
    /** Maps to provider_id_hash 0xc3c3...c3 */
    secondary: {
      name: "Dr. Michael Torres",
      npi: "9876543210",
      specialty: "Cardiology",
      practice: "Cascade Heart Institute",
      credentials: "MD, FACC",
      providerIdHash: ("0x" + "c3".repeat(32)) as `0x${string}`,
    },
  },

  payer: {
    name: "BlueCross Preferred PPO",
    planType: "PPO",
    groupNumber: "GRP-DEMO-001",
    network: "Preferred Provider Network — California",
    payerId: "payer-demo-001",
  },

  procedures: {
    PROC_KNEE_MRI: {
      cpt: "73721",
      description: "MRI of knee without contrast, right",
      cap: 100000,
    },
    PROC_CARDIAC_CT: {
      cpt: "75574",
      description: "CT angiography of the heart with contrast",
      cap: 150000,
    },
    PROC_SPINE_XRAY: {
      cpt: "72100",
      description: "Radiologic exam, spine, lumbosacral (2-3 views)",
      cap: 50000,
    },
  } as Record<string, { cpt: string; description: string; cap: number }>,

  medications: {
    "309362": { rxnorm: "309362", description: "Clopidogrel 75 MG Oral Tablet", cap: 35000 },
    "314076": { rxnorm: "314076", description: "Lisinopril 10 MG Oral Tablet", cap: 6000 },
    "314231": { rxnorm: "314231", description: "Nitroglycerin 0.4 MG/ACTUAT Mucosal Spray", cap: 15000 },
    "205532": { rxnorm: "205532", description: "Celecoxib 200 MG Oral Capsule", cap: 45000 },
    "310261": { rxnorm: "310261", description: "Tamoxifen 20 MG Oral Tablet", cap: 100000 },
    "329528": { rxnorm: "329528", description: "Amlodipine 5 MG Oral Tablet", cap: 5000 },
    "259255": { rxnorm: "259255", description: "Atorvastatin 40 MG Oral Tablet", cap: 25000 },
    "860975": { rxnorm: "860975", description: "Metformin hydrochloride 500 MG Oral Tablet", cap: 5000 },
    "860999": { rxnorm: "860999", description: "Metformin hydrochloride 1000 MG Oral Tablet", cap: 8000 },
    "310534": { rxnorm: "310534", description: "Glipizide 5 MG Oral Tablet", cap: 8000 },
    "197805": { rxnorm: "197805", description: "Ibuprofen 800 MG Oral Tablet", cap: 4000 },
    "308182": { rxnorm: "308182", description: "Amoxicillin 500 MG Oral Capsule", cap: 5000 },
  } as Record<string, { rxnorm: string; description: string; cap: number }>,

  consent: {
    type: "HIPAA Authorization for Treatment, Payment, and Healthcare Operations",
    scope: "Prior Authorization Data Sharing",
    expiresDisplay: "2026-08-15",
  },

  formatAmount(minorUnits: number | string): string {
    const v = typeof minorUnits === "string" ? parseInt(minorUnits) : minorUnits;
    return `$${(v / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
  },

  decodeBitmap(bitmap: number): string[] {
    const labels = [
      "Provider credential invalid",
      "Procedure not covered",
      "Amount exceeds cap",
      "Consent invalid/revoked",
      "Duplicate/nullifier collision",
      "Stale attestation",
      "Medication not on formulary",
      "Medication amount exceeds cap",
    ];
    const reasons: string[] = [];
    for (let i = 0; i < 8; i++) {
      if (bitmap & (1 << i)) reasons.push(labels[i]);
    }
    return reasons;
  },

  /** Resolve patient by procedure code */
  scenarioPatient(procedureCode: string) {
    return procedureCode === "PROC_CARDIAC_CT"
      ? CLINICAL.patients.secondary
      : CLINICAL.patients.primary;
  },

  /** Resolve provider by procedure code */
  scenarioProvider(procedureCode: string) {
    return procedureCode === "PROC_CARDIAC_CT"
      ? CLINICAL.providers.secondary
      : CLINICAL.providers.primary;
  },

  /** Resolve provider by hash */
  providerByHash(hash: string) {
    if (hash === CLINICAL.providers.primary.providerIdHash) return CLINICAL.providers.primary;
    if (hash === CLINICAL.providers.secondary.providerIdHash) return CLINICAL.providers.secondary;
    return null;
  },
};
