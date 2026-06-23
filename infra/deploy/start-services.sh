#!/usr/bin/env bash
set -euo pipefail

# Start all EASE eHealth backend services
# Usage: ./start-services.sh

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo "Starting EASE eHealth services..."

cd "$ROOT_DIR"

# Load local secrets (INFERENCE_API_KEY, etc.) so services that call external
# APIs can authenticate. Safe no-op if .env is absent.
set -a; [ -f "$ROOT_DIR/.env" ] && . "$ROOT_DIR/.env"; set +a

# Start services in background
PORT=3001 npx tsx services/policy-service/src/index.ts &
PORT=3002 npx tsx services/credential-service/src/index.ts &
PORT=3003 npx tsx services/proof-service-stub/src/index.ts &
PORT=3004 npx tsx services/consent-service/src/index.ts &
PORT=3005 npx tsx services/provider-adapter-api/src/index.ts &
PORT=3006 npx tsx services/decision-callback-service/src/index.ts &
# attester-proof-adapter — the Confidential AI Attester behind the WF proof seam
# (workflows' proofServiceUrl points here). Falls back to deterministic eval if
# INFERENCE_API_KEY is unset or the attester is unreachable.
ATTESTER_ADAPTER_PORT=3007 npx tsx services/attester-proof-adapter/src/index.ts &

echo "All services starting..."
echo "  policy-service:           http://localhost:3001"
echo "  credential-service:       http://localhost:3002"
echo "  proof-service-stub:       http://localhost:3003"
echo "  consent-service:          http://localhost:3004"
echo "  provider-adapter-api:     http://localhost:3005"
echo "  decision-callback-service: http://localhost:3006"
echo "  attester-proof-adapter:   http://localhost:3007  (proof seam → Confidential AI Attester)"
echo ""
echo "Press Ctrl+C to stop all services"

wait
