#!/usr/bin/env bash
# =============================================================================
# EASE eHealth — v1 MVP demo: one real prior-auth decision, end-to-end,
# on the shared on-chain backbone — with the before/after contrast.
#
# Prereqs: anvil running (make anvil), contracts deployed (make deploy-local),
#          services running (make services), CRE CLI installed, .env populated.
# Usage:   bash scripts/demo-v1.sh          (or: make demo-v1)
# =============================================================================
set -euo pipefail
cd "$(dirname "$0")/.."

# Load workflow secrets for the CRE simulator
if [ -f .env ]; then set -a; . ./.env; set +a; fi

bold() { printf "\033[1m%s\033[0m\n" "$1"; }
line() { printf '%.0s─' {1..78}; echo; }

FIXTURES=(
  'sr-knee-mri-0001|Knee MRI, in-network, eligible, covered, $850 (letter on file)'
  'sr-acupuncture-0002|Acupuncture — plan does not cover it'
  'sr-knee-mri-oon-0003|Knee MRI ordered by an out-of-network provider'
  'sr-knee-mri-inelig-0004|Knee MRI for a member whose coverage lapsed'
)

echo
bold "EASE eHealth v1 — prior authorization on a shared, verifiable backbone"
line
echo "Two payers (BlueCross, Aetna) and two providers (Pacific Orthopedic,"
echo "Mercy General) share ONE OrganizationRegistry / CoverageRegistry /"
echo "PolicyRegistry. Plans are payer-signed (EIP-712); the off-chain benefit"
echo "design is pinned on-chain by hash; escrow is gated on APPROVED."
echo

RESULTS=()
for entry in "${FIXTURES[@]}"; do
  sr="${entry%%|*}"; desc="${entry#*|}"
  bold "▶ $sr — $desc"
  out=$(make -s simulate-wf010 SR="$sr" 2>&1 | grep -A1 "Workflow Simulation Result" | tail -1 || true)
  summary=$(printf '%s' "$out" | python3 -c '
import json, sys
raw = sys.stdin.read().strip()
try:
    d = json.loads(json.loads(raw))
    checks = d["checks"]
    informational = {"necessity_established", "auth_required"}
    flags = ", ".join(k for k, v in checks.items() if v is False and k not in informational)
    print("|".join([d["decision_state"], str(d["reason_bitmap"]), str(d["decision_latency_ms"]), flags or "-"]))
except Exception as e:
    print("PARSE-ERROR|" + str(e) + "|-|-")
')
  IFS='|' read -r decision bitmap latency flags <<< "$summary"
  echo "   decision: $decision   reason_bitmap: $bitmap   latency: ${latency}ms"
  [ "$flags" != "-" ] && echo "   failed checks: $flags"
  RESULTS+=("$sr|$decision|$bitmap|$latency")
  echo
done

line
bold "Results"
printf "  %-28s %-10s %-14s %s\n" "fixture" "decision" "reason_bitmap" "latency"
for r in "${RESULTS[@]}"; do
  IFS='|' read -r sr d b l <<< "$r"
  printf "  %-28s %-10s %-14s %sms\n" "$sr" "$d" "$b" "$l"
done
echo

line
bold "The contrast — today's prior-auth backbone vs. this one"
cat <<'EOF'
                        TODAY (X12 278 via intermediary)     EASE eHealth v1
  Submission            fax/phone/portal — 37% fully         FHIR ServiceRequest,
                        manual, 31% fully electronic         signed HTTP trigger
  Plan rules            siloed per payer, opaque             payer-signed plan, gates
                                                             readable on shared chain
  Eligibility           270/271 round-trip per payer         one CoverageRegistry read
  Network status        >80% of directory listings           OrganizationRegistry —
                        inaccurate ("ghost networks")        a fix propagates to all
  Decision              72 hours (urgent) to 7 days;         seconds, measured above;
                        ~$6 and ~11 minutes per e-PA         reasons on-chain, auditable
  Who runs the rails    one intermediary (~50% of all        no owner — verifiable
                        claims; one missing MFA control      shared state, no single
                        froze the nation's claims)           point of failure
  Payment               837 claim → 835 remit cycle          escrow releases at
                                                             decision time, gated
                                                             on APPROVED on-chain
EOF
echo
echo "  (Figures: CAQH Index 2023, AMA 2025 survey, Senate Finance 2023,"
echo "   US v. UnitedHealth/Change 2022 — see docs/REALITY_MAP.md)"
echo
bold "Done. Assert on-chain state with cast (see docs/FHIR_SUBSTRATE.md):"
echo "  cast call \$ClaimDecisionRegistry 'getDecision(bytes32)' <claim_id>"
