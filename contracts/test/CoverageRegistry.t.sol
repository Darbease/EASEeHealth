// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {CoverageRegistry} from "../src/CoverageRegistry.sol";

contract CoverageRegistryTest is Test {
    CoverageRegistry public registry;

    address public admin = address(this);
    address public registrar = address(0xAD01);
    address public unauthorized = address(0xBAD);

    bytes32 constant MEMBER = keccak256("member-maria");
    bytes32 constant PLAN_HASH = keccak256("plan-a");

    uint64 constant FROM = 1_577_836_800; // 2020-01-01
    uint64 constant TO = 1_798_761_599; // 2026-12-31

    function setUp() public {
        registry = new CoverageRegistry(admin);
        registry.grantRole(registry.REGISTRAR_ROLE(), registrar);
    }

    // ─── upsertCoverage ──────────────────────────────────────────────

    function test_upsertCoverage() public {
        vm.prank(registrar);
        registry.upsertCoverage(MEMBER, PLAN_HASH, FROM, TO, true);

        CoverageRegistry.CoverageRecord memory c = registry.getCoverage(MEMBER, PLAN_HASH);
        assertEq(c.memberId, MEMBER);
        assertEq(c.planHash, PLAN_HASH);
        assertEq(c.effectiveFrom, FROM);
        assertEq(c.effectiveTo, TO);
        assertTrue(c.active);
    }

    function test_upsertCoverage_zeroMember() public {
        vm.prank(registrar);
        vm.expectRevert("CoverageRegistry: zero memberId");
        registry.upsertCoverage(bytes32(0), PLAN_HASH, FROM, TO, true);
    }

    function test_upsertCoverage_zeroPlan() public {
        vm.prank(registrar);
        vm.expectRevert("CoverageRegistry: zero planHash");
        registry.upsertCoverage(MEMBER, bytes32(0), FROM, TO, true);
    }

    function test_upsertCoverage_unauthorized() public {
        vm.prank(unauthorized);
        vm.expectRevert();
        registry.upsertCoverage(MEMBER, PLAN_HASH, FROM, TO, true);
    }

    // ─── isEligible ──────────────────────────────────────────────────

    function test_isEligible_activeWindow() public {
        vm.prank(registrar);
        registry.upsertCoverage(MEMBER, PLAN_HASH, FROM, TO, true);

        assertTrue(registry.isEligible(MEMBER, PLAN_HASH, FROM));
        assertTrue(registry.isEligible(MEMBER, PLAN_HASH, TO));
        assertFalse(registry.isEligible(MEMBER, PLAN_HASH, FROM - 1));
        assertFalse(registry.isEligible(MEMBER, PLAN_HASH, TO + 1));
    }

    function test_isEligible_inactive() public {
        vm.prank(registrar);
        registry.upsertCoverage(MEMBER, PLAN_HASH, FROM, TO, false);
        assertFalse(registry.isEligible(MEMBER, PLAN_HASH, FROM + 1));
    }

    function test_isEligible_unknownMember() public view {
        assertFalse(registry.isEligible(MEMBER, PLAN_HASH, FROM + 1));
    }

    function test_isEligible_wrongPlan() public {
        vm.prank(registrar);
        registry.upsertCoverage(MEMBER, PLAN_HASH, FROM, TO, true);
        assertFalse(registry.isEligible(MEMBER, keccak256("plan-b"), FROM + 1));
    }

    // ─── fuzz: eligibility window ────────────────────────────────────

    function testFuzz_isEligible_window(uint64 atTs) public {
        vm.prank(registrar);
        registry.upsertCoverage(MEMBER, PLAN_HASH, FROM, TO, true);

        bool expected = atTs >= FROM && atTs <= TO;
        assertEq(registry.isEligible(MEMBER, PLAN_HASH, atTs), expected);
    }
}
