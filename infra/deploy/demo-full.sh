#!/usr/bin/env bash
set -euo pipefail

# EASE eHealth Full Demo Orchestrator
# Starts Anvil, deploys contracts, launches services, runs demo scenarios.
# Usage: ./infra/deploy/demo-full.sh  OR  make demo-full

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$ROOT_DIR"

ANVIL_RPC="http://127.0.0.1:8545"
PIDS=()

cleanup() {
  echo ""
  echo "Shutting down..."
  for pid in "${PIDS[@]}"; do
    kill "$pid" 2>/dev/null || true
  done
  pkill -f "anvil --host 127.0.0.1 --port 8545" 2>/dev/null || true
  pkill -f "tsx services/" 2>/dev/null || true
  echo "Done."
}
trap cleanup EXIT

# ─── 1. Start Anvil ──────────────────────────────────────────────────
echo "╔══════════════════════════════════════════╗"
echo "║     EASE eHealth Full Demo                    ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# Kill any existing Anvil
pkill -f "anvil --host" 2>/dev/null || true
sleep 1

echo "[1/6] Starting Anvil..."
anvil --host 127.0.0.1 --port 8545 --chain-id 31337 --silent &
PIDS+=($!)

# Wait for Anvil to be ready
for i in $(seq 1 30); do
  if cast chain-id --rpc-url "$ANVIL_RPC" &>/dev/null; then
    echo "  Anvil ready on :8545"
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "  ERROR: Anvil failed to start"
    exit 1
  fi
  sleep 0.5
done

# ─── 2. Deploy Contracts ─────────────────────────────────────────────
echo ""
echo "[2/6] Deploying contracts..."
make deploy-local 2>&1 | tail -20
echo "  Contracts deployed"

# ─── 3. Verify Deployment ────────────────────────────────────────────
echo ""
echo "[3/6] Verifying deployment..."
make deploy-verify 2>&1 || true

# ─── 4. Start Services ───────────────────────────────────────────────
echo ""
echo "[4/6] Starting services..."
pkill -f "tsx services/" 2>/dev/null || true
sleep 1
bash infra/deploy/start-services.sh &
PIDS+=($!)

# Wait for services to be healthy
echo "  Waiting for services..."
for i in $(seq 1 30); do
  if curl -sf http://localhost:3005/healthz &>/dev/null && \
     curl -sf http://localhost:3003/healthz &>/dev/null; then
    echo "  All services ready"
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "  WARNING: Some services may not be ready"
    break
  fi
  sleep 1
done

# ─── 5. Run Demo Scenarios ───────────────────────────────────────────
echo ""
echo "[5/6] Running demo scenarios..."
npx tsx infra/deploy/demo-runner.ts

# ─── 6. Run CRE Workflow Simulation (if CRE CLI available) ──────────
echo ""
echo "[6/6] CRE workflow broadcast (on-chain writes)..."
if command -v "$HOME/.cre/bin/cre" &>/dev/null; then
  make broadcast-wf001 2>&1 || echo "  WF-001 broadcast failed (non-blocking)"
else
  echo "  CRE CLI not found — skipping workflow broadcast"
  echo "  Install: https://docs.chain.link/cre/getting-started"
fi

# ─── Summary ──────────────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════╗"
echo "║     Demo Complete                        ║"
echo "╠══════════════════════════════════════════╣"
echo "║  Anvil:     http://127.0.0.1:8545       ║"
echo "║  Services:  http://localhost:3001-3006   ║"
echo "║  Dashboard: make dashboard               ║"
echo "╠══════════════════════════════════════════╣"
echo "║  Press Ctrl+C to stop everything         ║"
echo "╚══════════════════════════════════════════╝"

# Keep running so services stay alive
wait
