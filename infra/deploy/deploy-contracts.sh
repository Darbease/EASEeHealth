#!/usr/bin/env bash
set -euo pipefail

# Deploy EASE eHealth contracts to Base Sepolia (or local Anvil)
# Usage: ./deploy-contracts.sh [--local]

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

if [[ "${1:-}" == "--local" ]]; then
  echo "Deploying to local Anvil..."
  RPC_URL="http://127.0.0.1:8545"
  export DEPLOYER_PRIVATE_KEY="0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
  export DEPLOYER_ADDRESS="0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"
  export CRE_SIGNER_ADDRESS="0x70997970C51812dc3A010C7d01b50e0d17dc79C8"
  export OPS_ADDRESS="0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC"
  export TREASURY_ADDRESS="0x90F79bf6EB2c4f870365E785982E1f101E93b906"
else
  echo "Deploying to Base Sepolia..."
  source "$ROOT_DIR/infra/env/.env" 2>/dev/null || { echo "Error: .env not found"; exit 1; }
  RPC_URL="${BASE_SEPOLIA_RPC_URL}"
fi

cd "$ROOT_DIR/contracts"

forge script script/Deploy.s.sol:Deploy \
  --rpc-url "$RPC_URL" \
  --broadcast \
  -vvv

echo "Deployment complete!"
