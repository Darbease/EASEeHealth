.PHONY: install install-contracts install-services install-cre \
       build build-contracts \
       test test-contracts test-services test-dashboard \
       anvil anvil-stop deploy-local fund-tenderly deploy-tenderly deploy-sepolia deploy-verify \
       services services-stop \
       simulate simulate-wf001 simulate-wf002 simulate-wf004 simulate-wf005 simulate-wf006 simulate-wf008 simulate-wf009 \
       broadcast broadcast-wf001 broadcast-wf002 broadcast-wf004 broadcast-wf005 broadcast-wf006 broadcast-wf008 broadcast-wf009 \
       submit-wf003-claim simulate-wf003 broadcast-wf003 \
       submit-wf007-claim simulate-wf007 broadcast-wf007 \
       simulate-wf010 broadcast-wf010 demo-v1 \
       fhir-regen demo demo-full dashboard dashboard-install clean help

CRE := $(HOME)/.cre/bin/cre
CRE_DIR := ProofPACRE
CRE_TARGET := staging-settings

# Anvil defaults (account 0 = deployer, 1 = CRE signer, 2 = ops, 3 = treasury)
ANVIL_RPC := http://127.0.0.1:8545
DEPLOYER_ADDRESS := 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
DEPLOYER_PRIVATE_KEY := 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
CRE_SIGNER_ADDRESS := 0x70997970C51812dc3A010C7d01b50e0d17dc79C8
CRE_SIGNER_KEY := 0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d
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
	cd $(CRE_DIR)/wf-006-medication-payment-verification && bun install
	cd $(CRE_DIR)/wf-007-claim-transfer-settlement && bun install
	cd $(CRE_DIR)/wf-008-http-prior-auth && bun install
	cd $(CRE_DIR)/wf-009-attester-callback && bun install
	cd $(CRE_DIR)/wf-010-prior-auth && bun install

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

fund-tenderly: ## Fund deployer on Tenderly Virtual TestNet (100 ETH)
	@echo "Funding deployer on Tenderly..."
	@cd contracts && source .env && \
	curl -s "$$TENDERLY_RPC_URL" \
		-X POST \
		-H "Content-Type: application/json" \
		-d '{"jsonrpc":"2.0","method":"tenderly_setBalance","params":[["'"$$DEPLOYER_ADDRESS"'"],"0x56BC75E2D63100000"],"id":1}' \
		| python3 -c "import sys,json; r=json.load(sys.stdin); print('Funded ✓' if 'result' in r else 'Error: '+str(r))"

deploy-tenderly: build-contracts fund-tenderly ## Deploy all contracts to Tenderly Virtual TestNet (Sepolia fork)
	@echo "Deploying to Tenderly Virtual TestNet..."
	cd contracts && \
	source .env && \
	VERIFY_FLAGS=""; \
	if [ -n "$$TENDERLY_ACCESS_KEY" ]; then \
		VERIFY_FLAGS="--verify --etherscan-api-key $$TENDERLY_ACCESS_KEY --verifier-url $$TENDERLY_RPC_URL/verify/etherscan"; \
	fi; \
	DEPLOYER_PRIVATE_KEY=$$DEPLOYER_PRIVATE_KEY \
	forge script script/Deploy.s.sol:Deploy \
		--rpc-url $$TENDERLY_RPC_URL \
		--broadcast \
		$$VERIFY_FLAGS \
		-vvv

deploy-sepolia: build-contracts ## Deploy all contracts to Eth Sepolia testnet
	@echo "Deploying to Eth Sepolia..."
	cd contracts && \
	source .env && \
	VERIFY_FLAGS=""; \
	if [ -n "$$ETHERSCAN_API_KEY" ]; then \
		VERIFY_FLAGS="--verify --etherscan-api-key $$ETHERSCAN_API_KEY"; \
	fi; \
	DEPLOYER_PRIVATE_KEY=$$DEPLOYER_PRIVATE_KEY \
	forge script script/Deploy.s.sol:Deploy \
		--rpc-url $$SEPOLIA_RPC_URL \
		--broadcast \
		$$VERIFY_FLAGS \
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
	@echo "Starting EASE eHealth services on ports 3001-3006..."
	bash infra/deploy/start-services.sh

services-stop: ## Stop all background services
	@pkill -f "tsx services/" 2>/dev/null || true
	@echo "Services stopped"

# ─── CRE Workflow Simulation ─────────────────────────────────────────
simulate: simulate-wf001 simulate-wf002 simulate-wf004 simulate-wf005 simulate-wf006 simulate-wf008 simulate-wf009 ## Simulate CRE workflows (services must be running; WF-003/007 need TX_HASH)

simulate-wf001: ## Simulate WF-001: Prior Auth Decision
	cd $(CRE_DIR) && $(CRE) workflow simulate ./wf-001-prior-auth-decision --target=$(CRE_TARGET)

simulate-wf002: ## Simulate WF-002: Consent Revocation (HTTP trigger — consent cascade)
	cd $(CRE_DIR) && $(CRE) workflow simulate ./wf-002-consent-revocation --target=$(CRE_TARGET) --non-interactive --trigger-index=0 --http-payload='{"consent_id":"0xc0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0","reason_code":1,"affected_claim_id":"0x0101010101010101010101010101010101010101010101010101010101010101"}'

simulate-wf004: ## Simulate WF-004: Reconciliation Monitor (no services needed)
	cd $(CRE_DIR) && $(CRE) workflow simulate ./wf-004-reconciliation-monitor --target=$(CRE_TARGET)

simulate-wf005: ## Simulate WF-005: Encrypted Credential Audit (AES-GCM showcase)
	cd $(CRE_DIR) && $(CRE) workflow simulate ./wf-005-encrypted-credential-audit --target=$(CRE_TARGET)

simulate-wf006: ## Simulate WF-006: Medication Payment Verification
	cd $(CRE_DIR) && $(CRE) workflow simulate ./wf-006-medication-payment-verification --target=$(CRE_TARGET)

simulate-wf008: ## Simulate WF-008: HTTP Prior Auth (on-demand via HTTP trigger)
	cd $(CRE_DIR) && $(CRE) workflow simulate ./wf-008-http-prior-auth --target=$(CRE_TARGET) --non-interactive --trigger-index=0 --http-payload='{"claim_id":"0x0808080808080808080808080808080808080808080808080808080808080808","payer_id":"payer-demo-001","procedure_code":"PROC_CARDIAC_CT","requested_amount":"38000","consent_id":"0xc0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0","policy_hash":"0xa1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1","service_date":"2026-03-08"}'

simulate-wf009: ## Simulate WF-009: Attester Callback (native callback verdict → on-chain)
	cd $(CRE_DIR) && $(CRE) workflow simulate ./wf-009-attester-callback --target=$(CRE_TARGET) --non-interactive --trigger-index=0 --http-payload='{"claim_id":"0x0909090909090909090909090909090909090909090909090909090909090909","policy_hash":"0xa1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1","consent_id":"0xc0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0","procedure_code":"PROC_KNEE_MRI","requested_amount":"85000","result":"PASS","reason_bitmap":"0","proof_hash":"0xd9d9d9d9d9d9d9d9d9d9d9d9d9d9d9d9d9d9d9d9d9d9d9d9d9d9d9d9d9d9d9d9d9"}'

# ─── CRE Workflow Broadcast (writes to chain) ───────────────────────
broadcast: broadcast-wf001 broadcast-wf002 broadcast-wf004 broadcast-wf005 broadcast-wf006 broadcast-wf008 broadcast-wf009 ## Broadcast CRE workflows (anvil + services; WF-003/007 need TX_HASH)

broadcast-wf001: ## Broadcast WF-001: Prior Auth Decision (on-chain writes)
	cd $(CRE_DIR) && $(CRE) workflow simulate ./wf-001-prior-auth-decision --target=$(CRE_TARGET) --broadcast

broadcast-wf002: ## Broadcast WF-002: Consent Revocation (HTTP trigger — on-chain cascade)
	cd $(CRE_DIR) && $(CRE) workflow simulate ./wf-002-consent-revocation --target=$(CRE_TARGET) --non-interactive --trigger-index=0 --broadcast --http-payload='{"consent_id":"0xc0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0","reason_code":1,"affected_claim_id":"0x0101010101010101010101010101010101010101010101010101010101010101"}'

broadcast-wf004: ## Broadcast WF-004: Reconciliation Monitor (on-chain writes)
	cd $(CRE_DIR) && $(CRE) workflow simulate ./wf-004-reconciliation-monitor --target=$(CRE_TARGET) --broadcast

broadcast-wf005: ## Broadcast WF-005: Encrypted Credential Audit (on-chain writes)
	cd $(CRE_DIR) && $(CRE) workflow simulate ./wf-005-encrypted-credential-audit --target=$(CRE_TARGET) --broadcast

broadcast-wf006: ## Broadcast WF-006: Medication Payment Verification (on-chain writes)
	cd $(CRE_DIR) && $(CRE) workflow simulate ./wf-006-medication-payment-verification --target=$(CRE_TARGET) --broadcast

broadcast-wf008: ## Broadcast WF-008: HTTP Prior Auth (on-chain writes via HTTP trigger)
	cd $(CRE_DIR) && $(CRE) workflow simulate ./wf-008-http-prior-auth --target=$(CRE_TARGET) --non-interactive --trigger-index=0 --broadcast --http-payload='{"claim_id":"0x0808080808080808080808080808080808080808080808080808080808080808","payer_id":"payer-demo-001","procedure_code":"PROC_CARDIAC_CT","requested_amount":"38000","consent_id":"0xc0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0","policy_hash":"0xa1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1","service_date":"2026-03-08"}'

broadcast-wf009: ## Broadcast WF-009: Attester Callback (on-chain writes from relayed verdict)
	cd $(CRE_DIR) && $(CRE) workflow simulate ./wf-009-attester-callback --target=$(CRE_TARGET) --non-interactive --trigger-index=0 --broadcast --http-payload='{"claim_id":"0x0909090909090909090909090909090909090909090909090909090909090909","policy_hash":"0xa1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1","consent_id":"0xc0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0","procedure_code":"PROC_KNEE_MRI","requested_amount":"85000","result":"PASS","reason_bitmap":"0","proof_hash":"0xd9d9d9d9d9d9d9d9d9d9d9d9d9d9d9d9d9d9d9d9d9d9d9d9d9d9d9d9d9d9d9d9d9"}'

# ─── WF-010: v1 consolidated prior auth (FHIR intake → on-chain rules → necessity → settle) ───
# The intake payload comes from provider-adapter-api's fhir-submit endpoint (FHIR
# ServiceRequest → flat decision request). Override the fixture with SR=sr-...
# Fixtures: sr-knee-mri-0001 (APPROVED→PAID), sr-acupuncture-0002 (not covered),
#           sr-knee-mri-oon-0003 (out-of-network), sr-knee-mri-inelig-0004 (ineligible)
SR ?= sr-knee-mri-0001

simulate-wf010: ## Simulate WF-010: v1 Prior Auth (services must be running; SR=<fixture>)
	cd $(CRE_DIR) && $(CRE) workflow simulate ./wf-010-prior-auth --target=$(CRE_TARGET) --non-interactive --trigger-index=0 --http-payload="$$(curl -sf -X POST http://localhost:3005/v1/prior-auth/fhir-submit -H 'Content-Type: application/json' -d '{"serviceRequestId":"$(SR)","correlation_id":"make-wf010-$(SR)"}')"

broadcast-wf010: ## Broadcast WF-010: v1 Prior Auth (anvil + services; SR=<fixture>)
	cd $(CRE_DIR) && $(CRE) workflow simulate ./wf-010-prior-auth --target=$(CRE_TARGET) --non-interactive --trigger-index=0 --broadcast --http-payload="$$(curl -sf -X POST http://localhost:3005/v1/prior-auth/fhir-submit -H 'Content-Type: application/json' -d '{"serviceRequestId":"$(SR)","correlation_id":"make-wf010-$(SR)"}')"

demo-v1: ## v1 MVP demo: all four WF-010 scenarios + before/after contrast (anvil + services running)
	bash scripts/demo-v1.sh

# ─── WF-003 Log Trigger (requires TX_HASH from setProofResult) ──────
submit-wf003-claim: ## Submit + approve a claim to emit ProofEvaluated for WF-003
	cast send 0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9 \
		"submitClaim(bytes32,bytes32)" \
		0xe5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5 \
		0xa1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1 \
		--rpc-url $(ANVIL_RPC) \
		--private-key $(CRE_SIGNER_KEY)
	@echo "--- Now calling setProofResult (emits ProofEvaluated — capture this TX_HASH) ---"
	cast send 0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9 \
		"setProofResult(bytes32,bytes32,uint256,bool)" \
		0xe5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5 \
		0xb2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2 \
		0 \
		true \
		--rpc-url $(ANVIL_RPC) \
		--private-key $(CRE_SIGNER_KEY)

simulate-wf003: ## Simulate WF-003: Compliance Gate (requires TX_HASH=0x... from setProofResult)
	cd $(CRE_DIR) && $(CRE) workflow simulate ./wf-003-challenge-resolution --target=$(CRE_TARGET) --non-interactive --trigger-index=0 --evm-tx-hash=$(TX_HASH) --evm-event-index=0

broadcast-wf003: ## Broadcast WF-003: Compliance Gate (requires TX_HASH=0x... from setProofResult)
	cd $(CRE_DIR) && $(CRE) workflow simulate ./wf-003-challenge-resolution --target=$(CRE_TARGET) --non-interactive --trigger-index=0 --broadcast --evm-tx-hash=$(TX_HASH) --evm-event-index=0

# ─── WF-007 Log Trigger (requires TX_HASH from submitClaim) ────────
submit-wf007-claim: ## Submit a claim on-chain for WF-007 log trigger demo
	cast send 0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9 \
		"submitClaim(bytes32,bytes32)" \
		0x0707070707070707070707070707070707070707070707070707070707070707 \
		0xa1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1 \
		--rpc-url $(ANVIL_RPC) \
		--private-key $(CRE_SIGNER_KEY)

simulate-wf007: ## Simulate WF-007: Claim Transfer Settlement (requires TX_HASH=0x...)
	cd $(CRE_DIR) && $(CRE) workflow simulate ./wf-007-claim-transfer-settlement --target=$(CRE_TARGET) --non-interactive --trigger-index=0 --evm-tx-hash=$(TX_HASH) --evm-event-index=0

broadcast-wf007: ## Broadcast WF-007: Claim Transfer Settlement (requires TX_HASH=0x...)
	cd $(CRE_DIR) && $(CRE) workflow simulate ./wf-007-claim-transfer-settlement --target=$(CRE_TARGET) --non-interactive --trigger-index=0 --broadcast --evm-tx-hash=$(TX_HASH) --evm-event-index=0

# ─── Data ────────────────────────────────────────────────────────────
fhir-regen: ## Regenerate FHIR R4 resources (data/fhir/) from data/synthea CSVs
	node scripts/synthea-to-fhir.mjs

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
