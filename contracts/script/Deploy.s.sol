// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {HelperConfig} from "./HelperConfig.s.sol";
import {MockUSDC} from "../src/MockUSDC.sol";
import {ConsentRegistry} from "../src/ConsentRegistry.sol";
import {PolicyRegistry} from "../src/PolicyRegistry.sol";
import {ClaimDecisionRegistry} from "../src/ClaimDecisionRegistry.sol";
import {ClaimEscrow} from "../src/ClaimEscrow.sol";
import {OrganizationRegistry} from "../src/OrganizationRegistry.sol";
import {CoverageRegistry} from "../src/CoverageRegistry.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title Deploy — Deploys all EASE eHealth contracts, grants roles, seeds demo data
/// @notice Uses HelperConfig for network-aware configuration.
///         Anvil (31337): deterministic accounts, no env vars needed.
///         Sepolia / Tenderly fork (11155111): reads DEPLOYER_PRIVATE_KEY from env.
contract Deploy is Script {
    // ─── Demo fixture constants (must match data/fhir + docs/FHIR_SUBSTRATE.md) ───
    // Plans
    bytes32 constant PLAN_A_HASH = bytes32(0xa1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1); // BlueCross Preferred PPO
    bytes32 constant PLAN_B_HASH = bytes32(0xb2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2); // Aetna Gold HMO
    // keccak256 of the trimmed benefit-design JSON in services/policy-service/data/
    bytes32 constant BENEFIT_DESIGN_HASH_A = 0x016ef52c6f998c3cace0a5185cfcbb798e0414adcd0c349a5939a92e65dc923f;
    bytes32 constant BENEFIT_DESIGN_HASH_B = 0xd55da355b38a772676c5243206ad6e1b9bd2bab98db4ca14cccbbbfc14781c66;
    // Orgs (keccak256 of the Synthea org / payer ids)
    bytes32 constant PAYER_A_ORG = keccak256("a1b2c3d4-1001-4000-8000-000000000001"); // BlueCross Preferred PPO
    bytes32 constant PAYER_B_ORG = keccak256("a1b2c3d4-1002-4000-8000-000000000002"); // Aetna Gold HMO
    bytes32 constant PROVIDER_A_ORG = keccak256("b1a2c3d4-0002-4000-8000-000000000002"); // Pacific Orthopedic Associates
    bytes32 constant PROVIDER_B_ORG = keccak256("b1a2c3d4-0001-4000-8000-000000000001"); // Mercy General Hospital
    // Members (keccak256 of the Synthea member ids)
    bytes32 constant MEMBER_MARIA = keccak256("e1f2a3b4-0001-4000-8000-000000000001");
    bytes32 constant MEMBER_JAMES = keccak256("e1f2a3b4-0002-4000-8000-000000000002");
    // Procedures (keccak256("CPT:<code>"))
    bytes32 constant PROC_KNEE_MRI = keccak256("CPT:73721");
    bytes32 constant PROC_ACUPUNCTURE = keccak256("CPT:97810");
    bytes32 constant PROC_CT_HEAD = keccak256("CPT:70450");
    // Demo payer signing keys (publicly derivable — demo only, never real networks)
    uint256 constant PAYER_A_SIGNER_KEY = uint256(keccak256("ease-demo-payer-a-signer"));
    uint256 constant PAYER_B_SIGNER_KEY = uint256(keccak256("ease-demo-payer-b-signer"));
    // Coverage windows (fixed, matching data/synthea/payer_transitions.csv years)
    uint64 constant COVERAGE_FROM_2020 = 1577836800; // 2020-01-01T00:00:00Z
    uint64 constant COVERAGE_TO_2026 = 1798761599; // 2026-12-31T23:59:59Z
    uint64 constant COVERAGE_FROM_2019 = 1546300800; // 2019-01-01T00:00:00Z
    uint64 constant COVERAGE_TO_2021 = 1609459199; // 2020-12-31T23:59:59Z

    function run() external {
        HelperConfig helperConfig = new HelperConfig();
        (
            uint256 deployerKey,
            address deployer,
            address creSigner,
            address opsAddress,
            address treasuryAddress
        ) = helperConfig.activeConfig();

        console.log("--- Network Config ---");
        console.log("Chain ID:", block.chainid);
        console.log("Deployer:", deployer);
        console.log("CRE Signer:", creSigner);
        console.log("Ops:", opsAddress);
        console.log("Treasury:", treasuryAddress);

        vm.startBroadcast(deployerKey);

        // 1. Deploy MockUSDC
        MockUSDC usdc = new MockUSDC();
        console.log("MockUSDC deployed at:", address(usdc));

        // 2. Deploy ConsentRegistry
        ConsentRegistry consent = new ConsentRegistry(deployer);
        console.log("ConsentRegistry deployed at:", address(consent));

        // 3. Deploy PolicyRegistry
        PolicyRegistry policy = new PolicyRegistry(deployer);
        console.log("PolicyRegistry deployed at:", address(policy));

        // 4. Deploy ClaimDecisionRegistry
        ClaimDecisionRegistry claims = new ClaimDecisionRegistry(deployer);
        console.log("ClaimDecisionRegistry deployed at:", address(claims));

        // 5. Deploy ClaimEscrow
        ClaimEscrow escrow = new ClaimEscrow(deployer, IERC20(address(usdc)));
        console.log("ClaimEscrow deployed at:", address(escrow));

        // 5b. Deploy OrganizationRegistry + CoverageRegistry (v1 shared backbone)
        OrganizationRegistry orgs = new OrganizationRegistry(deployer);
        console.log("OrganizationRegistry deployed at:", address(orgs));
        CoverageRegistry coverage = new CoverageRegistry(deployer);
        console.log("CoverageRegistry deployed at:", address(coverage));

        // 6. Grant roles
        // ConsentRegistry: WORKFLOW_ROLE to CRE signer and deployer (deployer needs it to seed consent)
        consent.grantRole(consent.WORKFLOW_ROLE(), creSigner);
        consent.grantRole(consent.WORKFLOW_ROLE(), deployer);

        // PolicyRegistry: POLICY_ADMIN_ROLE to deployer and ops
        policy.grantRole(policy.POLICY_ADMIN_ROLE(), deployer);
        policy.grantRole(policy.POLICY_ADMIN_ROLE(), opsAddress);
        policy.setOrganizationRegistry(address(orgs));

        // OrganizationRegistry / CoverageRegistry: REGISTRAR_ROLE to deployer and ops
        orgs.grantRole(orgs.REGISTRAR_ROLE(), deployer);
        orgs.grantRole(orgs.REGISTRAR_ROLE(), opsAddress);
        coverage.grantRole(coverage.REGISTRAR_ROLE(), deployer);
        coverage.grantRole(coverage.REGISTRAR_ROLE(), opsAddress);

        // ClaimDecisionRegistry: WORKFLOW_ROLE to CRE signer, CHALLENGE_ROLE to ops
        claims.grantRole(claims.WORKFLOW_ROLE(), creSigner);
        claims.grantRole(claims.CHALLENGE_ROLE(), opsAddress);

        // ClaimEscrow: WORKFLOW_ROLE to CRE signer, CHALLENGE_ROLE to ops, TREASURY_ROLE to treasury
        escrow.grantRole(escrow.WORKFLOW_ROLE(), creSigner);
        escrow.grantRole(escrow.CHALLENGE_ROLE(), opsAddress);
        escrow.grantRole(escrow.TREASURY_ROLE(), treasuryAddress);
        escrow.grantRole(escrow.TREASURY_ROLE(), deployer); // deployer can also fund for demo

        // Phase 3 enforcement: gate escrow payouts on an attested APPROVED decision.
        escrow.setClaimDecisionRegistry(address(claims));

        // 7. Mint MockUSDC to deployer for initial pool funding
        uint256 initialFund = 1_000_000 * 1e6; // 1M USDC
        usdc.mint(deployer, initialFund);

        // 8. Fund escrow pool
        usdc.approve(address(escrow), initialFund);
        escrow.fundPool(initialFund);
        console.log("Escrow funded with 1,000,000 USDC");

        // 9. Seed policy versions (hashes must match services + workflows)
        bytes32 demoVerifierKeyHash = keccak256("demo-verifier-key");
        policy.setPolicyVersion(
            PLAN_A_HASH, demoVerifierKeyHash, uint64(block.timestamp), uint64(block.timestamp + 365 days), true
        );
        policy.setPolicyVersion(
            PLAN_B_HASH, demoVerifierKeyHash, uint64(block.timestamp), uint64(block.timestamp + 365 days), true
        );
        console.log("Demo plans seeded (0xa1a1..., 0xb2b2...)");

        // 9b. Seed the shared org backbone: 2 payers + 2 providers on ONE registry.
        //     BlueCross + Aetna both read/write the same network state — a membership fix
        //     written once propagates to every org (the anti-fragmentation thesis).
        orgs.registerOrg(PAYER_A_ORG, OrganizationRegistry.OrgKind.PAYER, vm.addr(PAYER_A_SIGNER_KEY), "BlueCross Preferred PPO");
        orgs.registerOrg(PAYER_B_ORG, OrganizationRegistry.OrgKind.PAYER, vm.addr(PAYER_B_SIGNER_KEY), "Aetna Gold HMO");
        orgs.registerOrg(PROVIDER_A_ORG, OrganizationRegistry.OrgKind.PROVIDER, address(0), "Pacific Orthopedic Associates");
        orgs.registerOrg(PROVIDER_B_ORG, OrganizationRegistry.OrgKind.PROVIDER, address(0), "Mercy General Hospital");

        // Network memberships (Plan-Net OrganizationAffiliation shape):
        // Pacific Orthopedic is in-network for BOTH plans; Mercy General only for plan B —
        // so Mercy + plan A is the out-of-network denial fixture.
        orgs.setNetworkMembership(PROVIDER_A_ORG, PLAN_A_HASH, COVERAGE_FROM_2020, COVERAGE_TO_2026, true);
        orgs.setNetworkMembership(PROVIDER_A_ORG, PLAN_B_HASH, COVERAGE_FROM_2020, COVERAGE_TO_2026, true);
        orgs.setNetworkMembership(PROVIDER_B_ORG, PLAN_B_HASH, COVERAGE_FROM_2020, COVERAGE_TO_2026, true);
        console.log("Orgs + network memberships seeded (2 payers, 2 providers)");

        // 9c. Plan gates (Da Vinci CRD covered / pa-needed / cap):
        // Plan A: knee MRI covered w/ auth, cap 1,500 USDC; acupuncture NOT covered; CT covered.
        policy.setPlanGate(PLAN_A_HASH, PROC_KNEE_MRI, true, true, 1_500 * 1e6);
        policy.setPlanGate(PLAN_A_HASH, PROC_ACUPUNCTURE, false, false, 0);
        policy.setPlanGate(PLAN_A_HASH, PROC_CT_HEAD, true, true, 1_200 * 1e6);
        // Plan B: knee MRI covered w/ auth (higher cap); acupuncture covered, no auth.
        policy.setPlanGate(PLAN_B_HASH, PROC_KNEE_MRI, true, true, 2_000 * 1e6);
        policy.setPlanGate(PLAN_B_HASH, PROC_ACUPUNCTURE, true, false, 150 * 1e6);
        console.log("Plan gates seeded");

        // 9d. Payer EIP-712 signatures binding each plan to its off-chain benefit design.
        _signPlan(policy, PLAN_A_HASH, PAYER_A_ORG, BENEFIT_DESIGN_HASH_A, PAYER_A_SIGNER_KEY);
        _signPlan(policy, PLAN_B_HASH, PAYER_B_ORG, BENEFIT_DESIGN_HASH_B, PAYER_B_SIGNER_KEY);
        console.log("Plans payer-signed");

        // 9e. Member eligibility: Maria active on plan A (2020-2026);
        //     James holds a lapsed plan-A coverage (the ineligible denial fixture).
        coverage.upsertCoverage(MEMBER_MARIA, PLAN_A_HASH, COVERAGE_FROM_2020, COVERAGE_TO_2026, true);
        coverage.upsertCoverage(MEMBER_JAMES, PLAN_A_HASH, COVERAGE_FROM_2019, COVERAGE_TO_2021, false);
        console.log("Member coverage seeded");

        // 10. Seed demo consents
        // Primary consent used by WF-001/002/005
        bytes32 demoConsentId = bytes32(0xc0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0);
        consent.upsertConsent(ConsentRegistry.ConsentRecordInput({
            consentId: demoConsentId,
            subjectIdHash: keccak256("patient-demo-abc"),
            consentScopeHash: keccak256("scope-prior-auth-payment"),
            expiresAt: uint64(block.timestamp + 180 days),
            version: 1
        }));
        console.log("Demo consent seeded (0xc0c0...)");

        // Secondary consent used by dashboard/demo-runner
        bytes32 dashboardConsentId = bytes32(0x7777777777777777777777777777777777777777777777777777777777777777);
        consent.upsertConsent(ConsentRegistry.ConsentRecordInput({
            consentId: dashboardConsentId,
            subjectIdHash: keccak256("patient-demo-xyz"),
            consentScopeHash: keccak256("scope-prior-auth-payment"),
            expiresAt: uint64(block.timestamp + 180 days),
            version: 1
        }));
        console.log("Dashboard consent seeded (0x7777...)");

        vm.stopBroadcast();

        // Log summary
        console.log("--- Deployment Summary ---");
        console.log("MockUSDC:", address(usdc));
        console.log("ConsentRegistry:", address(consent));
        console.log("PolicyRegistry:", address(policy));
        console.log("ClaimDecisionRegistry:", address(claims));
        console.log("ClaimEscrow:", address(escrow));
        console.log("OrganizationRegistry:", address(orgs));
        console.log("CoverageRegistry:", address(coverage));
    }

    function _signPlan(
        PolicyRegistry policy,
        bytes32 planHash,
        bytes32 payerOrgId,
        bytes32 benefitDesignHash,
        uint256 signerKey
    ) private {
        bytes32 digest = policy.planCommitmentDigest(planHash, benefitDesignHash);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerKey, digest);
        policy.attachPayerSignature(planHash, payerOrgId, benefitDesignHash, abi.encodePacked(r, s, v));
    }
}
