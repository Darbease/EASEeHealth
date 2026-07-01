// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {PolicyRegistry} from "../src/PolicyRegistry.sol";
import {OrganizationRegistry} from "../src/OrganizationRegistry.sol";

contract PolicyRegistryTest is Test {
    PolicyRegistry public registry;
    OrganizationRegistry public orgs;

    address public admin = address(this);
    address public policyAdmin = address(0xAD01);
    address public unauthorized = address(0xBAD);

    bytes32 constant POLICY_HASH = keccak256("policy-v1");
    bytes32 constant VERIFIER_KEY_HASH = keccak256("verifier-key-v1");

    bytes32 constant PAYER_ORG = keccak256("org:payer:bluecross");
    bytes32 constant PROC_KEY = keccak256("CPT:73721");
    bytes32 constant BENEFIT_DESIGN_HASH = keccak256("benefit-design-v1");

    uint256 constant PAYER_SIGNER_KEY = 0xA11CE;
    address public payerSigner;

    function setUp() public {
        registry = new PolicyRegistry(admin);
        registry.grantRole(registry.POLICY_ADMIN_ROLE(), policyAdmin);

        payerSigner = vm.addr(PAYER_SIGNER_KEY);
        orgs = new OrganizationRegistry(admin);
        orgs.grantRole(orgs.REGISTRAR_ROLE(), admin);
        orgs.registerOrg(PAYER_ORG, OrganizationRegistry.OrgKind.PAYER, payerSigner, "BlueCross");
        registry.setOrganizationRegistry(address(orgs));
    }

    function _setActivePolicy() internal returns (uint64 from, uint64 to) {
        from = uint64(block.timestamp);
        to = uint64(block.timestamp + 365 days);
        vm.prank(policyAdmin);
        registry.setPolicyVersion(POLICY_HASH, VERIFIER_KEY_HASH, from, to, true);
    }

    function _signPlan() internal {
        bytes32 digest = registry.planCommitmentDigest(POLICY_HASH, BENEFIT_DESIGN_HASH);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(PAYER_SIGNER_KEY, digest);
        vm.prank(policyAdmin);
        registry.attachPayerSignature(POLICY_HASH, PAYER_ORG, BENEFIT_DESIGN_HASH, abi.encodePacked(r, s, v));
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

    // ─── plan gates ──────────────────────────────────────────────────

    function test_setPlanGate_and_get() public {
        _setActivePolicy();
        vm.prank(policyAdmin);
        registry.setPlanGate(POLICY_HASH, PROC_KEY, true, true, 1_500 * 1e6);

        PolicyRegistry.PlanGate memory gate = registry.getPlanGate(POLICY_HASH, PROC_KEY);
        assertTrue(gate.exists);
        assertTrue(gate.covered);
        assertTrue(gate.authRequired);
        assertEq(gate.capAmount, 1_500 * 1e6);
    }

    function test_setPlanGate_unknownPolicyReverts() public {
        vm.prank(policyAdmin);
        vm.expectRevert("PolicyRegistry: policy not found");
        registry.setPlanGate(POLICY_HASH, PROC_KEY, true, true, 1);
    }

    function test_setPlanGate_unauthorized() public {
        _setActivePolicy();
        vm.prank(unauthorized);
        vm.expectRevert();
        registry.setPlanGate(POLICY_HASH, PROC_KEY, true, true, 1);
    }

    // ─── payer signature ─────────────────────────────────────────────

    function test_attachPayerSignature() public {
        _setActivePolicy();
        _signPlan();

        assertTrue(registry.isPlanSigned(POLICY_HASH));
        PolicyRegistry.PlanCommitment memory c = registry.getPlanCommitment(POLICY_HASH);
        assertEq(c.payerOrgId, PAYER_ORG);
        assertEq(c.benefitDesignHash, BENEFIT_DESIGN_HASH);
        assertEq(c.signer, payerSigner);
    }

    function test_attachPayerSignature_wrongSigner() public {
        _setActivePolicy();
        bytes32 digest = registry.planCommitmentDigest(POLICY_HASH, BENEFIT_DESIGN_HASH);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(0xDEAD, digest); // not the payer's key

        vm.prank(policyAdmin);
        vm.expectRevert("PolicyRegistry: bad payer signature");
        registry.attachPayerSignature(POLICY_HASH, PAYER_ORG, BENEFIT_DESIGN_HASH, abi.encodePacked(r, s, v));
    }

    function test_attachPayerSignature_nonPayerOrg() public {
        _setActivePolicy();
        bytes32 providerOrg = keccak256("org:provider:mercy");
        orgs.registerOrg(providerOrg, OrganizationRegistry.OrgKind.PROVIDER, payerSigner, "Mercy");

        bytes32 digest = registry.planCommitmentDigest(POLICY_HASH, BENEFIT_DESIGN_HASH);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(PAYER_SIGNER_KEY, digest);

        vm.prank(policyAdmin);
        vm.expectRevert("PolicyRegistry: not an active payer");
        registry.attachPayerSignature(POLICY_HASH, providerOrg, BENEFIT_DESIGN_HASH, abi.encodePacked(r, s, v));
    }

    function test_attachPayerSignature_unknownPolicyReverts() public {
        bytes32 digest = registry.planCommitmentDigest(POLICY_HASH, BENEFIT_DESIGN_HASH);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(PAYER_SIGNER_KEY, digest);

        vm.prank(policyAdmin);
        vm.expectRevert("PolicyRegistry: policy not found");
        registry.attachPayerSignature(POLICY_HASH, PAYER_ORG, BENEFIT_DESIGN_HASH, abi.encodePacked(r, s, v));
    }

    // ─── checkCoverage adjudication ──────────────────────────────────

    function test_checkCoverage_approved() public {
        _setActivePolicy();
        _signPlan();
        vm.prank(policyAdmin);
        registry.setPlanGate(POLICY_HASH, PROC_KEY, true, true, 1_500 * 1e6);

        (bool ok, uint256 bitmap, bool authRequired) =
            registry.checkCoverage(POLICY_HASH, PROC_KEY, 850 * 1e6, uint64(block.timestamp));
        assertTrue(ok);
        assertEq(bitmap, 0);
        assertTrue(authRequired);
    }

    function test_checkCoverage_notCovered() public {
        _setActivePolicy();
        _signPlan();
        vm.prank(policyAdmin);
        registry.setPlanGate(POLICY_HASH, PROC_KEY, false, false, 0);

        (bool ok, uint256 bitmap,) = registry.checkCoverage(POLICY_HASH, PROC_KEY, 1, uint64(block.timestamp));
        assertFalse(ok);
        assertEq(bitmap, registry.REASON_NOT_COVERED());
    }

    function test_checkCoverage_noGateIsNotCovered() public {
        _setActivePolicy();
        _signPlan();

        (bool ok, uint256 bitmap,) =
            registry.checkCoverage(POLICY_HASH, keccak256("CPT:99999"), 1, uint64(block.timestamp));
        assertFalse(ok);
        assertEq(bitmap, registry.REASON_NOT_COVERED());
    }

    function test_checkCoverage_exceedsCap() public {
        _setActivePolicy();
        _signPlan();
        vm.prank(policyAdmin);
        registry.setPlanGate(POLICY_HASH, PROC_KEY, true, true, 1_500 * 1e6);

        (bool ok, uint256 bitmap,) =
            registry.checkCoverage(POLICY_HASH, PROC_KEY, 1_501 * 1e6, uint64(block.timestamp));
        assertFalse(ok);
        assertEq(bitmap, registry.REASON_EXCEEDS_CAP());
    }

    function test_checkCoverage_expiredPlan() public {
        (, uint64 to) = _setActivePolicy();
        _signPlan();
        vm.prank(policyAdmin);
        registry.setPlanGate(POLICY_HASH, PROC_KEY, true, true, 1_500 * 1e6);

        (bool ok, uint256 bitmap,) = registry.checkCoverage(POLICY_HASH, PROC_KEY, 850 * 1e6, to + 1);
        assertFalse(ok);
        assertEq(bitmap, registry.REASON_PLAN_INACTIVE());
    }

    function test_checkCoverage_unsignedPlan() public {
        _setActivePolicy();
        vm.prank(policyAdmin);
        registry.setPlanGate(POLICY_HASH, PROC_KEY, true, true, 1_500 * 1e6);

        (bool ok, uint256 bitmap,) =
            registry.checkCoverage(POLICY_HASH, PROC_KEY, 850 * 1e6, uint64(block.timestamp));
        assertFalse(ok);
        assertEq(bitmap, registry.REASON_PLAN_INACTIVE());
    }

    function test_checkCoverage_combinedReasons() public {
        _setActivePolicy(); // unsigned + no gate
        (bool ok, uint256 bitmap,) =
            registry.checkCoverage(POLICY_HASH, PROC_KEY, 1, uint64(block.timestamp));
        assertFalse(ok);
        assertEq(bitmap, registry.REASON_PLAN_INACTIVE() | registry.REASON_NOT_COVERED());
    }

    // ─── fuzz: cap boundary ──────────────────────────────────────────

    function testFuzz_checkCoverage_cap(uint256 amount) public {
        _setActivePolicy();
        _signPlan();
        uint256 cap = 1_500 * 1e6;
        vm.prank(policyAdmin);
        registry.setPlanGate(POLICY_HASH, PROC_KEY, true, true, cap);

        (bool ok, uint256 bitmap,) = registry.checkCoverage(POLICY_HASH, PROC_KEY, amount, uint64(block.timestamp));
        assertEq(ok, amount <= cap);
        assertEq(bitmap, amount <= cap ? 0 : registry.REASON_EXCEEDS_CAP());
    }
}
