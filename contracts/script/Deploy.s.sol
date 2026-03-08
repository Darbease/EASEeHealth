// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {HelperConfig} from "./HelperConfig.s.sol";
import {MockUSDC} from "../src/MockUSDC.sol";
import {ConsentRegistry} from "../src/ConsentRegistry.sol";
import {PolicyRegistry} from "../src/PolicyRegistry.sol";
import {ClaimDecisionRegistry} from "../src/ClaimDecisionRegistry.sol";
import {ClaimEscrow} from "../src/ClaimEscrow.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title Deploy — Deploys all ProofPA contracts, grants roles, seeds demo data
/// @notice Uses HelperConfig for network-aware configuration.
///         Anvil (31337): deterministic accounts, no env vars needed.
///         Sepolia / Tenderly fork (11155111): reads DEPLOYER_PRIVATE_KEY from env.
contract Deploy is Script {
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

        // 6. Grant roles
        // ConsentRegistry: WORKFLOW_ROLE to CRE signer and deployer (deployer needs it to seed consent)
        consent.grantRole(consent.WORKFLOW_ROLE(), creSigner);
        consent.grantRole(consent.WORKFLOW_ROLE(), deployer);

        // PolicyRegistry: POLICY_ADMIN_ROLE to deployer and ops
        policy.grantRole(policy.POLICY_ADMIN_ROLE(), deployer);
        policy.grantRole(policy.POLICY_ADMIN_ROLE(), opsAddress);

        // ClaimDecisionRegistry: WORKFLOW_ROLE to CRE signer, CHALLENGE_ROLE to ops
        claims.grantRole(claims.WORKFLOW_ROLE(), creSigner);
        claims.grantRole(claims.CHALLENGE_ROLE(), opsAddress);

        // ClaimEscrow: WORKFLOW_ROLE to CRE signer, CHALLENGE_ROLE to ops, TREASURY_ROLE to treasury
        escrow.grantRole(escrow.WORKFLOW_ROLE(), creSigner);
        escrow.grantRole(escrow.CHALLENGE_ROLE(), opsAddress);
        escrow.grantRole(escrow.TREASURY_ROLE(), treasuryAddress);
        escrow.grantRole(escrow.TREASURY_ROLE(), deployer); // deployer can also fund for demo

        // 7. Mint MockUSDC to deployer for initial pool funding
        uint256 initialFund = 1_000_000 * 1e6; // 1M USDC
        usdc.mint(deployer, initialFund);

        // 8. Fund escrow pool
        usdc.approve(address(escrow), initialFund);
        escrow.fundPool(initialFund);
        console.log("Escrow funded with 1,000,000 USDC");

        // 9. Seed a demo policy version (hash must match services + workflows)
        bytes32 demoPolicyHash = bytes32(0xa1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1);
        bytes32 demoVerifierKeyHash = keccak256("demo-verifier-key");
        policy.setPolicyVersion(
            demoPolicyHash,
            demoVerifierKeyHash,
            uint64(block.timestamp),
            uint64(block.timestamp + 365 days),
            true
        );
        console.log("Demo policy seeded (0xa1a1...)");

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
    }
}
