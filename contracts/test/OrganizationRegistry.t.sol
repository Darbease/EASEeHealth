// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {OrganizationRegistry} from "../src/OrganizationRegistry.sol";

contract OrganizationRegistryTest is Test {
    OrganizationRegistry public registry;

    address public admin = address(this);
    address public registrar = address(0xAD01);
    address public unauthorized = address(0xBAD);
    address public payerSigner = address(0x51);

    bytes32 constant PROVIDER_ORG = keccak256("org:provider:pacific-ortho");
    bytes32 constant PAYER_ORG = keccak256("org:payer:bluecross");
    bytes32 constant PLAN_HASH = keccak256("plan-a");

    uint64 constant FROM = 1_577_836_800; // 2020-01-01
    uint64 constant TO = 1_798_761_599; // 2026-12-31

    function setUp() public {
        registry = new OrganizationRegistry(admin);
        registry.grantRole(registry.REGISTRAR_ROLE(), registrar);
    }

    function _registerBoth() internal {
        vm.startPrank(registrar);
        registry.registerOrg(PROVIDER_ORG, OrganizationRegistry.OrgKind.PROVIDER, address(0), "Pacific Orthopedic");
        registry.registerOrg(PAYER_ORG, OrganizationRegistry.OrgKind.PAYER, payerSigner, "BlueCross");
        vm.stopPrank();
    }

    // ─── registerOrg ─────────────────────────────────────────────────

    function test_registerOrg() public {
        _registerBoth();

        OrganizationRegistry.Org memory org = registry.getOrg(PAYER_ORG);
        assertEq(org.orgId, PAYER_ORG);
        assertEq(uint8(org.kind), uint8(OrganizationRegistry.OrgKind.PAYER));
        assertEq(org.signer, payerSigner);
        assertTrue(org.active);
        assertEq(org.name, "BlueCross");
    }

    function test_registerOrg_duplicate() public {
        _registerBoth();
        vm.prank(registrar);
        vm.expectRevert("OrganizationRegistry: org exists");
        registry.registerOrg(PAYER_ORG, OrganizationRegistry.OrgKind.PAYER, payerSigner, "BlueCross");
    }

    function test_registerOrg_zeroId() public {
        vm.prank(registrar);
        vm.expectRevert("OrganizationRegistry: zero orgId");
        registry.registerOrg(bytes32(0), OrganizationRegistry.OrgKind.PAYER, payerSigner, "X");
    }

    function test_registerOrg_unauthorized() public {
        vm.prank(unauthorized);
        vm.expectRevert();
        registry.registerOrg(PAYER_ORG, OrganizationRegistry.OrgKind.PAYER, payerSigner, "BlueCross");
    }

    // ─── network membership ──────────────────────────────────────────

    function test_setNetworkMembership_and_isInNetwork() public {
        _registerBoth();

        vm.prank(registrar);
        registry.setNetworkMembership(PROVIDER_ORG, PLAN_HASH, FROM, TO, true);

        assertTrue(registry.isInNetwork(PROVIDER_ORG, PLAN_HASH, FROM));
        assertTrue(registry.isInNetwork(PROVIDER_ORG, PLAN_HASH, TO));
        assertFalse(registry.isInNetwork(PROVIDER_ORG, PLAN_HASH, FROM - 1));
        assertFalse(registry.isInNetwork(PROVIDER_ORG, PLAN_HASH, TO + 1));
    }

    function test_isInNetwork_noMembership() public {
        _registerBoth();
        assertFalse(registry.isInNetwork(PROVIDER_ORG, PLAN_HASH, FROM));
    }

    function test_isInNetwork_unknownOrg() public view {
        assertFalse(registry.isInNetwork(keccak256("nobody"), PLAN_HASH, FROM));
    }

    function test_isInNetwork_inactiveMembership() public {
        _registerBoth();
        vm.prank(registrar);
        registry.setNetworkMembership(PROVIDER_ORG, PLAN_HASH, FROM, TO, false);
        assertFalse(registry.isInNetwork(PROVIDER_ORG, PLAN_HASH, FROM + 1));
    }

    function test_isInNetwork_inactiveOrg() public {
        _registerBoth();
        vm.startPrank(registrar);
        registry.setNetworkMembership(PROVIDER_ORG, PLAN_HASH, FROM, TO, true);
        registry.setOrgActive(PROVIDER_ORG, false);
        vm.stopPrank();
        assertFalse(registry.isInNetwork(PROVIDER_ORG, PLAN_HASH, FROM + 1));
    }

    function test_setNetworkMembership_payerReverts() public {
        _registerBoth();
        vm.prank(registrar);
        vm.expectRevert("OrganizationRegistry: not a provider");
        registry.setNetworkMembership(PAYER_ORG, PLAN_HASH, FROM, TO, true);
    }

    function test_setNetworkMembership_unregisteredReverts() public {
        vm.prank(registrar);
        vm.expectRevert("OrganizationRegistry: org not found");
        registry.setNetworkMembership(PROVIDER_ORG, PLAN_HASH, FROM, TO, true);
    }

    function test_setNetworkMembership_unauthorized() public {
        _registerBoth();
        vm.prank(unauthorized);
        vm.expectRevert();
        registry.setNetworkMembership(PROVIDER_ORG, PLAN_HASH, FROM, TO, true);
    }

    // ─── payer helpers ───────────────────────────────────────────────

    function test_isActivePayer() public {
        _registerBoth();
        assertTrue(registry.isActivePayer(PAYER_ORG));
        assertFalse(registry.isActivePayer(PROVIDER_ORG)); // provider, not payer
        assertFalse(registry.isActivePayer(keccak256("nobody")));

        vm.prank(registrar);
        registry.setOrgActive(PAYER_ORG, false);
        assertFalse(registry.isActivePayer(PAYER_ORG));
    }

    function test_setOrgSigner() public {
        _registerBoth();
        address newSigner = address(0x52);
        vm.prank(registrar);
        registry.setOrgSigner(PAYER_ORG, newSigner);
        assertEq(registry.orgSigner(PAYER_ORG), newSigner);
    }

    // ─── fuzz: membership window ─────────────────────────────────────

    function testFuzz_isInNetwork_window(uint64 atTs) public {
        _registerBoth();
        vm.prank(registrar);
        registry.setNetworkMembership(PROVIDER_ORG, PLAN_HASH, FROM, TO, true);

        bool expected = atTs >= FROM && atTs <= TO;
        assertEq(registry.isInNetwork(PROVIDER_ORG, PLAN_HASH, atTs), expected);
    }
}
