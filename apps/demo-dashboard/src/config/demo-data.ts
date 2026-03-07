// Pre-filled demo constants — mirrors tests/fixtures/demo-*.ts
export const DEMO = {
  payerId: "payer-demo-001",
  providerIdHash: ("0x" + "b2".repeat(32)) as `0x${string}`,
  encounterRefHash: ("0x" + "d4".repeat(32)) as `0x${string}`,
  procedureCode: "PROC_KNEE_MRI",
  requestedAmount: "85000",
  consentId: ("0x" + "77".repeat(32)) as `0x${string}`,
  policyHash: ("0x" + "a1".repeat(32)) as `0x${string}`,
  attestationJws: "eyJhbGciOiJFUzI1NiJ9.demo-attestation",
  serviceDate: "2026-03-03",
  // Scenario C uses a different encounter ref
  challengeEncounterRefHash: ("0x" + "e5".repeat(32)) as `0x${string}`,
  challengeProcedureCode: "PROC_CARDIAC_CT",
  challengeRequestedAmount: "120000",

  // Clinical display data for dashboard UI
  clinical: {
    // Scenario A/B
    providerName: "Dr. Sarah Chen, MD, FAAOS",
    providerPractice: "Summit Orthopedics & Sports Medicine",
    patientName: "Maria Garcia",
    patientMRN: "MRG-2026-0847",
    patientMemberId: "BCX-9284710",
    diagnosis: "M17.11 — Primary osteoarthritis, right knee",
    procedure: "MRI of knee without contrast, right (CPT 73721)",
    insurance: "BlueCross Preferred PPO",
    groupNumber: "GRP-DEMO-001",
    requestedAmountDisplay: "$850.00",
    // Scenario C
    challengeProviderName: "Dr. Michael Torres, MD, FACC",
    challengeProviderPractice: "Cascade Heart Institute",
    challengePatientName: "James Patterson",
    challengePatientMRN: "JPT-2026-1102",
    challengePatientMemberId: "BCX-6391842",
    challengeDiagnosis: "I25.10 — Atherosclerotic heart disease",
    challengeProcedure: "CT angiography of the heart with contrast (CPT 75574)",
    challengeAmountDisplay: "$1,200.00",
  },
} as const;
