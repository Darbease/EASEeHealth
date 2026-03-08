// Pre-filled demo constants — mirrors tests/fixtures/demo-*.ts
export const DEMO = {
  payerId: "payer-demo-001",
  providerIdHash: ("0x" + "b2".repeat(32)) as `0x${string}`,
  encounterRefHash: ("0x" + "d4".repeat(32)) as `0x${string}`,
  procedureCode: "PROC_KNEE_MRI",
  requestedAmount: "85000",
  consentId: ("0x" + "c0".repeat(32)) as `0x${string}`,
  policyHash: ("0x" + "a1".repeat(32)) as `0x${string}`,
  attestationJws: "eyJhbGciOiJFUzI1NiJ9.demo-attestation",
  serviceDate: "2026-03-03",

  // Scenario A — WF-001 (Cron trigger)
  cronClaimId: ("0x" + "01".repeat(32)) as `0x${string}`,

  // Scenario B — WF-007 (Log trigger)
  logClaimId: ("0x" + "07".repeat(32)) as `0x${string}`,
  logTransferAmount: "3800000", // $38,000 total claim
  logPayerCoverage: "3230000",  // $32,300 payer coverage
  logProcedureCode: "PROC_CARDIAC_CT",

  // Scenario C — WF-008 (HTTP trigger)
  httpClaimId: ("0x" + "08".repeat(32)) as `0x${string}`,
  httpProcedureCode: "PROC_CARDIAC_CT",
  httpRequestedAmount: "38000",

  // Clinical display data for dashboard UI
  clinical: {
    // Scenario A (Cron — WF-001)
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

    // Scenario B (Log — WF-007)
    transferProviderName: "Dr. Sarah Chen, MD",
    transferPatientName: "Maria Garcia",
    transferDiagnosis: "I25.10 — Atherosclerotic heart disease",
    transferProcedure: "Coronary artery stent placement (SNOMED 36969009)",
    transferAmountDisplay: "$38,000.00",
    transferPayerCoverageDisplay: "$32,300.00",

    // Scenario C (HTTP — WF-008)
    httpProviderName: "Dr. Sarah Chen, MD",
    httpPatientName: "Maria Garcia",
    httpDiagnosis: "I25.10 — Atherosclerotic heart disease",
    httpProcedure: "CT angiography of heart with contrast (CPT 75574)",
    httpAmountDisplay: "$38,000.00",
  },
} as const;
