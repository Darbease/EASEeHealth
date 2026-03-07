// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {PolicyRegistry} from "../src/PolicyRegistry.sol";

contract PolicyRegistryTest is Test {
    PolicyRegistry public registry;

    address public admin = address(this);
    address public policyAdmin = address(0xAD01);
    address public unauthorized = address(0xBAD);

    bytes32 constant POLICY_HASH = keccak256("policy-v1");
    bytes32 constant VERIFIER_KEY_HASH = keccak256("verifier-key-v1");

    function setUp() public {
        registry = new PolicyRegistry(admin);
        registry.grantRole(registry.POLICY_ADMIN_ROLE(), policyAdmin);
    }

    // ─── setPolicyVersion ────────────────────────────────────────────

    function test_setPolicyVersion() public {
        uint64 from = uint64(block.timestamp);
        uint64 to = uint64(block.timestamp + 365 days);

        vm.prank(policyAdmin);
        registry.setPolicyVersion(POLICY_HASH, VERIFIER_KEY_HASH, from, to, true);

        PolicyRegistry.PolicyVersion memory pv = registry.getPolicyVersion(POLICY_HASH);
        assertEq(pv.policyHash, POLICY_HASH);
        assertEq(pv.verifierKeyHash, VERIFIER_KEY_HASH);
        assertEq(pv.effectiveFrom, from);
        assertEq(pv.effectiveTo, to);
        assertTrue(pv.active);
    }

    // ─── isPolicyActive ──────────────────────────────────────────────

    function test_isPolicyActive_valid() public {
        uint64 from = uint64(block.timestamp);
        uint64 to = uint64(block.timestamp + 365 days);

        vm.prank(policyAdmin);
        registry.setPolicyVersion(POLICY_HASH, VERIFIER_KEY_HASH, from, to, true);

        // Check at a timestamp within the effective range
        bool active = registry.isPolicyActive(POLICY_HASH, uint64(block.timestamp + 30 days));
        assertTrue(active);
    }

    function test_isPolicyActive_notYetEffective() public {
        uint64 from = uint64(block.timestamp + 30 days);
        uint64 to = uint64(block.timestamp + 365 days);

        vm.prank(policyAdmin);
        registry.setPolicyVersion(POLICY_HASH, VERIFIER_KEY_HASH, from, to, true);

        // Check at current timestamp, before effectiveFrom
        bool active = registry.isPolicyActive(POLICY_HASH, uint64(block.timestamp));
        assertFalse(active);
    }

    function test_isPolicyActive_expired() public {
        uint64 from = uint64(block.timestamp);
        uint64 to = uint64(block.timestamp + 30 days);

        vm.prank(policyAdmin);
        registry.setPolicyVersion(POLICY_HASH, VERIFIER_KEY_HASH, from, to, true);

        // Warp past the effectiveTo date
        bool active = registry.isPolicyActive(POLICY_HASH, uint64(block.timestamp + 60 days));
        assertFalse(active);
    }

    function test_isPolicyActive_inactive() public {
        uint64 from = uint64(block.timestamp);
        uint64 to = uint64(block.timestamp + 365 days);

        // Set active = false
        vm.prank(policyAdmin);
        registry.setPolicyVersion(POLICY_HASH, VERIFIER_KEY_HASH, from, to, false);

        bool active = registry.isPolicyActive(POLICY_HASH, uint64(block.timestamp + 30 days));
        assertFalse(active);
    }

    // ─── Authorization ───────────────────────────────────────────────

    function test_unauthorized_set() public {
        vm.prank(unauthorized);
        vm.expectRevert();
        registry.setPolicyVersion(
            POLICY_HASH,
            VERIFIER_KEY_HASH,
            uint64(block.timestamp),
            uint64(block.timestamp + 365 days),
            true
        );
    }
}
