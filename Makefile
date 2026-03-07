.PHONY: install install-contracts install-services install-cre \
       build build-contracts \
       test test-contracts test-services test-dashboard \
       anvil anvil-stop deploy-local deploy-verify \
       services services-stop \
       simulate simulate-wf001 simulate-wf002 simulate-wf003 simulate-wf004 simulate-wf005 \
       broadcast broadcast-wf001 broadcast-wf002 broadcast-wf003 broadcast-wf004 broadcast-wf005 \
       demo demo-full dashboard dashboard-install clean help

CRE := $(HOME)/.cre/bin/cre
CRE_DIR := ProofPACRE
CRE_TARGET := staging-settings

# Anvil defaults (account 0 = deployer, 1 = CRE signer, 2 = ops, 3 = treasury)
ANVIL_RPC := http://127.0.0.1:8545
DEPLOYER_ADDRESS := 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
DEPLOYER_PRIVATE_KEY := 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
CRE_SIGNER_ADDRESS := 0x70997970C51812dc3A010C7d01b50e0d17dc79C8
OPS_ADDRESS := 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC
TREASURY_ADDRESS := 0x90F79bf6EB2c4f870365E785982E1f101E93b906

# ─── Install ─────────────────────────────────────────────────────────
install: install-contracts install-services install-cre ## Install all dependencies

install-contracts: ## Install Foundry contract dependencies
	cd contracts && forge install

install-services: ## Install npm workspace dependencies (packages + services)
	npm install

install-cre: ## Install CRE workflow dependencies (bun)
	cd $(CRE_DIR)/wf-001-prior-auth-decision && bun install
	cd $(CRE_DIR)/wf-002-consent-revocation && bun install
	cd $(CRE_DIR)/wf-003-challenge-resolution && bun install
	cd $(CRE_DIR)/wf-004-reconciliation-monitor && bun install
	cd $(CRE_DIR)/wf-005-encrypted-credential-audit && bun install

# ─── Build ───────────────────────────────────────────────────────────
build: build-contracts ## Build all components

build-contracts: ## Compile Solidity contracts
	cd contracts && forge build

# ─── Test ────────────────────────────────────────────────────────────
test: test-contracts test-services test-dashboard ## Run all tests

test-contracts: ## Run Foundry contract tests (unit + fuzz + invariant)
	cd contracts && forge test -vvv

test-services: ## Run Vitest service/integration tests
	npx vitest run

test-dashboard: ## Run demo dashboard Vitest tests
	cd apps/demo-dashboard && npx vitest run

# ─── Anvil & Deploy ──────────────────────────────────────────────────
anvil: ## Start local Anvil chain (foreground, Ctrl+C to stop)
	anvil --host 127.0.0.1 --port 8545 --chain-id 31337

anvil-stop: ## Stop background Anvil process
	@pkill -f "anvil --host" 2>/dev/null || true
	@echo "Anvil stopped"

deploy-local: build-contracts ## Deploy all contracts to local Anvil
	@echo "Deploying to Anvil at $(ANVIL_RPC)..."
	cd contracts && \
	DEPLOYER_ADDRESS=$(DEPLOYER_ADDRESS) \
	DEPLOYER_PRIVATE_KEY=$(DEPLOYER_PRIVATE_KEY) \
	CRE_SIGNER_ADDRESS=$(CRE_SIGNER_ADDRESS) \
	OPS_ADDRESS=$(OPS_ADDRESS) \
	TREASURY_ADDRESS=$(TREASURY_ADDRESS) \
	forge script script/Deploy.s.sol:Deploy \
		--rpc-url $(ANVIL_RPC) \
		--broadcast \
		-vvv

deploy-verify: ## Verify deployment — check escrow balance and CRE signer role
	@echo "--- Escrow USDC balance ---"
	@cast call 0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9 "poolBalance()(uint256)" --rpc-url $(ANVIL_RPC) 2>/dev/null || \
		cast call 0x5FbDB2315678afecb367f032d93F642f64180aa3 "balanceOf(address)(uint256)" 0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9 --rpc-url $(ANVIL_RPC)
	@echo "--- CRE signer has WORKFLOW_ROLE on ClaimDecisionRegistry ---"
	@cast call 0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9 "hasRole(bytes32,address)(bool)" $$(cast keccak "WORKFLOW_ROLE") $(CRE_SIGNER_ADDRESS) --rpc-url $(ANVIL_RPC)
	@echo "--- CRE signer has WORKFLOW_ROLE on ClaimEscrow ---"
	@cast call 0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9 "hasRole(bytes32,address)(bool)" $$(cast keccak "WORKFLOW_ROLE") $(CRE_SIGNER_ADDRESS) --rpc-url $(ANVIL_RPC)

# ─── Services ────────────────────────────────────────────────────────
services: ## Start all 6 backend services (foreground, Ctrl+C to stop)
	@echo "Starting ProofPA services on ports 3001-3006..."
	bash infra/deploy/start-services.sh

services-stop: ## Stop all background services
	@pkill -f "tsx services/" 2>/dev/null || true
	@echo "Services stopped"

# ─── CRE Workflow Simulation ─────────────────────────────────────────
simulate: simulate-wf001 simulate-wf002 simulate-wf003 simulate-wf004 simulate-wf005 ## Simulate all 5 CRE workflows (services must be running)

simulate-wf001: ## Simulate WF-001: Prior Auth Decision
	cd $(CRE_DIR) && $(CRE) workflow simulate ./wf-001-prior-auth-decision --target=$(CRE_TARGET)

simulate-wf002: ## Simulate WF-002: Consent Revocation
	cd $(CRE_DIR) && $(CRE) workflow simulate ./wf-002-consent-revocation --target=$(CRE_TARGET)

simulate-wf003: ## Simulate WF-003: Challenge Resolution
	cd $(CRE_DIR) && $(CRE) workflow simulate ./wf-003-challenge-resolution --target=$(CRE_TARGET)

simulate-wf004: ## Simulate WF-004: Reconciliation Monitor (no services needed)
	cd $(CRE_DIR) && $(CRE) workflow simulate ./wf-004-reconciliation-monitor --target=$(CRE_TARGET)

simulate-wf005: ## Simulate WF-005: Encrypted Credential Audit (AES-GCM showcase)
	cd $(CRE_DIR) && $(CRE) workflow simulate ./wf-005-encrypted-credential-audit --target=$(CRE_TARGET)

# ─── CRE Workflow Broadcast (writes to chain) ───────────────────────
broadcast: broadcast-wf001 broadcast-wf002 broadcast-wf003 broadcast-wf004 broadcast-wf005 ## Broadcast all 5 CRE workflows (anvil + services must be running)

broadcast-wf001: ## Broadcast WF-001: Prior Auth Decision (on-chain writes)
	cd $(CRE_DIR) && $(CRE) workflow simulate ./wf-001-prior-auth-decision --target=$(CRE_TARGET) --broadcast

broadcast-wf002: ## Broadcast WF-002: Consent Revocation (on-chain writes)
	cd $(CRE_DIR) && $(CRE) workflow simulate ./wf-002-consent-revocation --target=$(CRE_TARGET) --broadcast

broadcast-wf003: ## Broadcast WF-003: Challenge Resolution (on-chain writes)
	cd $(CRE_DIR) && $(CRE) workflow simulate ./wf-003-challenge-resolution --target=$(CRE_TARGET) --broadcast

broadcast-wf004: ## Broadcast WF-004: Reconciliation Monitor (on-chain writes)
	cd $(CRE_DIR) && $(CRE) workflow simulate ./wf-004-reconciliation-monitor --target=$(CRE_TARGET) --broadcast

broadcast-wf005: ## Broadcast WF-005: Encrypted Credential Audit (on-chain writes)
	cd $(CRE_DIR) && $(CRE) workflow simulate ./wf-005-encrypted-credential-audit --target=$(CRE_TARGET) --broadcast

# ─── Demo ────────────────────────────────────────────────────────────
demo: ## Run the E2E demo runner (all 3 scenarios)
	npx tsx infra/deploy/demo-runner.ts

demo-full: ## Full E2E: anvil → deploy → services → demo → CRE simulate
	bash infra/deploy/demo-full.sh

# ─── Dashboard ──────────────────────────────────────────────────────
dashboard: ## Start the demo dashboard (Next.js on :3000)
	cd apps/demo-dashboard && npm run dev

dashboard-install: ## Install dashboard dependencies
	cd apps/demo-dashboard && npm install

# ─── Clean ───────────────────────────────────────────────────────────
clean: ## Remove build artifacts and caches
	rm -rf contracts/out contracts/cache
	rm -rf $(CRE_DIR)/*/.cre_build_tmp*
	rm -rf node_modules/.cache
	@echo "Cleaned"

# ─── Help ────────────────────────────────────────────────────────────
help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'
