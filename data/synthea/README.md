# Synthea-Format Synthetic Healthcare Data

Synthetic patient/provider/payer data following the [Synthea CSV export format](https://github.com/synthetichealth/synthea/wiki/CSV-File-Data-Dictionary). All data is fictional — no real PHI.

## Files

| File | Records | Description |
|------|---------|-------------|
| `patients.csv` | 8 | Patient demographics, income, lifetime healthcare costs |
| `providers.csv` | 6 | Clinicians across 5 organizations (surgery, cardiology, radiology, family med) |
| `organizations.csv` | 5 | Hospitals, specialty clinics, imaging centers |
| `payers.csv` | 5 | BlueCross PPO, Aetna HMO, Medicare, Medicaid CA, UnitedHealth |
| `payer_transitions.csv` | 8 | Patient↔payer enrollment periods |
| `encounters.csv` | 12 | Office visits, inpatient admissions, pre-op evaluations |
| `conditions.csv` | 10 | Diagnoses (SNOMED-CT): cardiac, orthopedic, oncology, diabetes, etc. |
| `procedures.csv` | 13 | Procedures: CABG, stent, MRI, biopsy, CT, echo, stress test |
| `claims.csv` | 12 | Insurance claims with BILLED/CLOSED status and outstanding amounts |
| `claims_transactions.csv` | 15 | CHARGE, PAYMENT, TRANSFERIN/OUT transactions per claim line |

## Scenarios Covered

These records model realistic prior-auth scenarios that map directly to ProofPA workflows:

| Scenario | Patient | Procedure | Payer | ProofPA Mapping |
|----------|---------|-----------|-------|-----------------|
| **Happy path** — high-cost surgery approved and paid | Maria Garcia | Coronary stent ($38K) | BlueCross PPO | WF-001: SUBMITTED→APPROVED→PAID |
| **Happy path** — Medicare cardiac surgery | William O'Brien | CABG ($45K), PCI ($52K) | Medicare | WF-001: prior auth with govt payer |
| **Diagnostic workup** — imaging + biopsy | Aisha Johnson | Mammography + biopsy ($2.25K) | Aetna HMO | WF-001: multi-procedure encounter |
| **Consent revocation** — patient withdraws | Rosa Martinez | Diabetes management | Medicaid CA | WF-002: consent revoked mid-claim |
| **Challenge** — payer disputes amount | James Patterson | Knee MRI + injection ($3.45K) | UnitedHealth | WF-003: payer challenges, payout blocked |
| **Routine visit** — no prior auth needed | David Nakamura | Office visit ($650) | BlueCross PPO | Below threshold, no PA required |
| **Stuck claim** — pending reconciliation | Susan Thompson | Medication review ($450) | UnitedHealth | WF-004: reconciliation monitor catches |

## How This Demonstrates ProofPA Benefits

1. **Transparency**: Every claim transaction is auditable on-chain — no hidden denials or delayed payments
2. **Speed**: Traditional claims (BILLED status) sit for 30-90 days; ProofPA settles in <120s via smart contracts
3. **Cost reduction**: Eliminates manual prior auth phone calls, fax-based approvals, and duplicate submissions
4. **Patient control**: Consent is explicit and revocable (WF-002), not buried in paperwork
5. **Fraud prevention**: Deterministic claim IDs prevent duplicate billing; challenge workflow (WF-003) catches anomalies
6. **Interoperability**: Synthea-standard format means any EHR system can feed data into ProofPA

## Foreign Key Relationships

```
patients.Id ──→ encounters.Patient ──→ procedures.Patient
                encounters.Id ──→ procedures.Encounter
                encounters.Organization ──→ organizations.Id
                encounters.Provider ──→ providers.Id
                encounters.Payer ──→ payers.Id
                encounters.Id ──→ claims.Appointment ID
patients.Id ──→ claims.Patient ID
                claims.Id ──→ claims_transactions.Claim ID
patients.Id ──→ payer_transitions.Patient
                payer_transitions.Payer ──→ payers.Id
patients.Id ──→ conditions.Patient
                conditions.Encounter ──→ encounters.Id
```
