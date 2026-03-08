// ---------------------------------------------------------------------------
// Synthea CSV loader — loads Synthea-format CSVs from data/synthea/ at startup.
// Returns typed in-memory arrays for use by Express services.
// ---------------------------------------------------------------------------
import { readFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = join(__dirname, "..", "..", "..", "data", "synthea")

function parseCSV<T extends Record<string, string>>(filename: string): T[] {
  const raw = readFileSync(join(DATA_DIR, filename), "utf-8")
  const lines = raw.trim().split("\n")
  if (lines.length < 2) return []
  const headers = lines[0].split(",")
  return lines.slice(1).map((line) => {
    const values = line.split(",")
    const row: Record<string, string> = {}
    headers.forEach((h, i) => {
      row[h.trim()] = (values[i] ?? "").trim()
    })
    return row as T
  })
}

export interface SyntheaPatient {
  Id: string; BirthDate: string; DeathDate: string; SSN: string
  Drivers: string; Passport: string; Prefix: string; First: string
  Middle: string; Last: string; Suffix: string; Maiden: string
  Marital: string; Race: string; Ethnicity: string; Gender: string
  BirthPlace: string; Address: string; City: string; State: string
  County: string; "FIPS County Code": string; Zip: string
  Lat: string; Lon: string; Healthcare_Expenses: string
  Healthcare_Coverage: string; Income: string
}

export interface SyntheaEncounter {
  Id: string; Start: string; Stop: string; Patient: string
  Organization: string; Provider: string; Payer: string
  EncounterClass: string; Code: string; Description: string
  Base_Encounter_Cost: string; Total_Claim_Cost: string
  Payer_Coverage: string; ReasonCode: string; ReasonDescription: string
}

export interface SyntheaProcedure {
  Start: string; Stop: string; Patient: string; Encounter: string
  System: string; Code: string; Description: string; Base_Cost: string
  ReasonCode: string; ReasonDescription: string
}

export interface SyntheaCondition {
  Start: string; Stop: string; Patient: string; Encounter: string
  System: string; Code: string; Description: string
}

export interface SyntheaClaim {
  Id: string; "Patient ID": string; "Provider ID": string
  "Primary Patient Insurance ID": string; "Secondary Patient Insurance ID": string
  "Department ID": string; "Patient Department ID": string
  Diagnosis1: string; Diagnosis2: string; Diagnosis3: string
  Diagnosis4: string; Diagnosis5: string; Diagnosis6: string
  Diagnosis7: string; Diagnosis8: string; "Referring Provider ID": string
  "Appointment ID": string; "Current Illness Date": string
  "Service Date": string; "Supervising Provider ID": string
  Status1: string; Status2: string; StatusP: string
  Outstanding1: string; Outstanding2: string; OutstandingP: string
  LastBilledDate1: string; LastBilledDate2: string; LastBilledDateP: string
  HealthcareClaimTypeID1: string; HealthcareClaimTypeID2: string
}

export interface SyntheaClaimTransaction {
  Id: string; "Claim ID": string; "Charge ID": string; "Patient ID": string
  Type: string; Amount: string; Method: string; "From Date": string
  "To Date": string; "Place of Service": string; "Procedure Code": string
  Notes: string; "Unit Amount": string; Payments: string
  Adjustments: string; Transfers: string; Outstanding: string
  "Appointment ID": string; "Provider ID": string
}

export interface SyntheaPayer {
  Id: string; Name: string; Ownership: string; Address: string
  City: string; State_Headquartered: string; Zip: string; Phone: string
  Amount_Covered: string; Amount_Uncovered: string; Revenue: string
  Covered_Encounters: string; Uncovered_Encounters: string
  Covered_Procedures: string; Uncovered_Procedures: string
  Unique_Customers: string; QOLS_Avg: string; Member_Months: string
}

export interface SyntheaPayerTransition {
  Patient: string; "Member ID": string; Start_Year: string
  End_Year: string; Payer: string; "Secondary Payer": string
  Ownership: string; "Owner Name": string
}

export interface SyntheaProvider {
  Id: string; Organization: string; Name: string; Gender: string
  Speciality: string; Address: string; City: string; State: string
  Zip: string; Lat: string; Lon: string; Encounters: string; Procedures: string
}

export interface SyntheaOrganization {
  Id: string; Name: string; Address: string; City: string; State: string
  Zip: string; Lat: string; Lon: string; Phone: string; Revenue: string
  Utilization: string
}

export interface SyntheaMedication {
  START: string; STOP: string; PATIENT: string; PAYER: string
  ENCOUNTER: string; CODE: string; DESCRIPTION: string
  BASE_COST: string; PAYER_COVERAGE: string; DISPENSES: string
  TOTALCOST: string; REASONCODE: string; REASONDESCRIPTION: string
}

export interface SyntheaData {
  patients: SyntheaPatient[]
  encounters: SyntheaEncounter[]
  procedures: SyntheaProcedure[]
  conditions: SyntheaCondition[]
  claims: SyntheaClaim[]
  claimTransactions: SyntheaClaimTransaction[]
  payers: SyntheaPayer[]
  payerTransitions: SyntheaPayerTransition[]
  providers: SyntheaProvider[]
  organizations: SyntheaOrganization[]
  medications: SyntheaMedication[]
}

let _cache: SyntheaData | null = null

export function loadSyntheaData(): SyntheaData {
  if (_cache) return _cache
  _cache = {
    patients: parseCSV<SyntheaPatient>("patients.csv"),
    encounters: parseCSV<SyntheaEncounter>("encounters.csv"),
    procedures: parseCSV<SyntheaProcedure>("procedures.csv"),
    conditions: parseCSV<SyntheaCondition>("conditions.csv"),
    claims: parseCSV<SyntheaClaim>("claims.csv"),
    claimTransactions: parseCSV<SyntheaClaimTransaction>("claims_transactions.csv"),
    payers: parseCSV<SyntheaPayer>("payers.csv"),
    payerTransitions: parseCSV<SyntheaPayerTransition>("payer_transitions.csv"),
    providers: parseCSV<SyntheaProvider>("providers.csv"),
    organizations: parseCSV<SyntheaOrganization>("organizations.csv"),
    medications: parseCSV<SyntheaMedication>("medications.csv"),
  }
  return _cache
}
