#!/usr/bin/env bash
set -euo pipefail

# Start all EASE eHealth backend services
# Usage: ./start-services.sh

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo "Starting EASE eHealth services..."

cd "$ROOT_DIR"

# Start services in background
PORT=3001 npx tsx services/policy-service/src/index.ts &
PORT=3002 npx tsx services/credential-service/src/index.ts &
PORT=3003 npx tsx services/proof-service-stub/src/index.ts &
PORT=3004 npx tsx services/consent-service/src/index.ts &
PORT=3005 npx tsx services/provider-adapter-api/src/index.ts &
PORT=3006 npx tsx services/decision-callback-service/src/index.ts &

echo "All services starting..."
echo "  policy-service:           http://localhost:3001"
echo "  credential-service:       http://localhost:3002"
echo "  proof-service-stub:       http://localhost:3003"
echo "  consent-service:          http://localhost:3004"
echo "  provider-adapter-api:     http://localhost:3005"
echo "  decision-callback-service: http://localhost:3006"
echo ""
echo "Press Ctrl+C to stop all services"

wait
