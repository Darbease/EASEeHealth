// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ConsentRegistry} from "../src/ConsentRegistry.sol";

contract ConsentRegistryTest is Test {
    ConsentRegistry public registry;

    address public admin = address(this);
    address public workflow = address(0x1001);
    address public unauthorized = address(0xBAD);

    bytes32 constant CONSENT_ID = keccak256("consent-001");
    bytes32 constant SUBJECT_HASH = keccak256("patient-abc");
    bytes32 constant SCOPE_HASH = keccak256("scope-prior-auth");

    function setUp() public {
        registry = new ConsentRegistry(admin);
        registry.grantRole(registry.WORKFLOW_ROLE(), workflow);
    }

    // ─── upsertConsent ───────────────────────────────────────────────

    function test_upsertConsent() public {
        uint64 expiry = uint64(block.timestamp + 365 days);

        ConsentRegistry.ConsentRecordInput memory input = ConsentRegistry.ConsentRecordInput({
            consentId: CONSENT_ID,
            subjectIdHash: SUBJECT_HASH,
            consentScopeHash: SCOPE_HASH,
            expiresAt: expiry,
            version: 1
        });

        vm.prank(workflow);
        registry.upsertConsent(input);

        ConsentRegistry.ConsentRecord memory rec = registry.getConsent(CONSENT_ID);
        assertEq(rec.consentId, CONSENT_ID);
        assertEq(rec.subjectIdHash, SUBJECT_HASH);
        assertEq(rec.consentScopeHash, SCOPE_HASH);
        assertEq(rec.expiresAt, expiry);
        assertEq(uint8(rec.status), uint8(ConsentRegistry.Status.ACTIVE));
        assertEq(rec.version, 1);
        assertEq(rec.issuedAt, uint64(block.timestamp));
    }

    function test_upsertConsent_update() public {
        uint64 expiry = uint64(block.timestamp + 365 days);

        // First upsert
        ConsentRegistry.ConsentRecordInput memory input = ConsentRegistry.ConsentRecordInput({
            consentId: CONSENT_ID,
            subjectIdHash: SUBJECT_HASH,
            consentScopeHash: SCOPE_HASH,
            expiresAt: expiry,
            version: 1
        });

        vm.prank(workflow);
        registry.upsertConsent(input);

        // Update same consent with new scope and version
        bytes32 newScope = keccak256("scope-v2");
        uint64 newExpiry = uint64(block.timestamp + 730 days);

        ConsentRegistry.ConsentRecordInput memory input2 = ConsentRegistry.ConsentRecordInput({
            consentId: CONSENT_ID,
            subjectIdHash: SUBJECT_HASH,
            consentScopeHash: newScope,
            expiresAt: newExpiry,
            version: 2
        });

        vm.warp(block.timestamp + 1 days);
        vm.prank(workflow);
        registry.upsertConsent(input2);

        ConsentRegistry.ConsentRecord memory rec = registry.getConsent(CONSENT_ID);
        assertEq(rec.consentScopeHash, newScope);
        assertEq(rec.expiresAt, newExpiry);
        assertEq(rec.version, 2);
        // Status should be reset to ACTIVE on upsert
        assertEq(uint8(rec.status), uint8(ConsentRegistry.Status.ACTIVE));
    }

    // ─── revokeConsent ───────────────────────────────────────────────

    function test_revokeConsent() public {
        _createActiveConsent(CONSENT_ID);

        vm.prank(workflow);
        registry.revokeConsent(CONSENT_ID, 1);

        ConsentRegistry.ConsentRecord memory rec = registry.getConsent(CONSENT_ID);
        assertEq(uint8(rec.status), uint8(ConsentRegistry.Status.REVOKED));
    }

    function test_revokeConsent_notFound() public {
        bytes32 unknownId = keccak256("does-not-exist");

        vm.prank(workflow);
        vm.expectRevert("ConsentRegistry: consent not found");
        registry.revokeConsent(unknownId, 1);
    }

    function test_revokeConsent_notActive() public {
        _createActiveConsent(CONSENT_ID);

        // Revoke first time
        vm.prank(workflow);
        registry.revokeConsent(CONSENT_ID, 1);

        // Attempt second revocation
        vm.prank(workflow);
        vm.expectRevert("ConsentRegistry: consent not active");
        registry.revokeConsent(CONSENT_ID, 2);
    }

    // ─── isConsentActive ─────────────────────────────────────────────

    function test_isConsentActive_valid() public {
        _createActiveConsent(CONSENT_ID);

        bool active = registry.isConsentActive(CONSENT_ID, uint64(block.timestamp));
        assertTrue(active);
    }

    function test_isConsentActive_expired() public {
        uint64 expiry = uint64(block.timestamp + 1 days);
        _createConsentWithExpiry(CONSENT_ID, expiry);

        // Warp past expiry
        vm.warp(block.timestamp + 2 days);

        bool active = registry.isConsentActive(CONSENT_ID, uint64(block.timestamp));
        assertFalse(active);
    }

    function test_isConsentActive_revoked() public {
        _createActiveConsent(CONSENT_ID);

        vm.prank(workflow);
        registry.revokeConsent(CONSENT_ID, 1);

        bool active = registry.isConsentActive(CONSENT_ID, uint64(block.timestamp));
        assertFalse(active);
    }

    function test_isConsentActive_nonExistent() public view {
        bytes32 unknownId = keccak256("never-created");
        bool active = registry.isConsentActive(unknownId, uint64(block.timestamp));
        assertFalse(active);
    }

    // ─── Authorization ───────────────────────────────────────────────

    function test_unauthorized_upsert() public {
        ConsentRegistry.ConsentRecordInput memory input = ConsentRegistry.ConsentRecordInput({
            consentId: CONSENT_ID,
            subjectIdHash: SUBJECT_HASH,
            consentScopeHash: SCOPE_HASH,
            expiresAt: uint64(block.timestamp + 365 days),
            version: 1
        });

        vm.prank(unauthorized);
        vm.expectRevert();
        registry.upsertConsent(input);
    }

    function test_unauthorized_revoke() public {
        _createActiveConsent(CONSENT_ID);

        vm.prank(unauthorized);
        vm.expectRevert();
        registry.revokeConsent(CONSENT_ID, 1);
    }

    // ─── Helpers ─────────────────────────────────────────────────────

    function _createActiveConsent(bytes32 consentId) internal {
        _createConsentWithExpiry(consentId, uint64(block.timestamp + 365 days));
    }

    function _createConsentWithExpiry(bytes32 consentId, uint64 expiry) internal {
        ConsentRegistry.ConsentRecordInput memory input = ConsentRegistry.ConsentRecordInput({
            consentId: consentId,
            subjectIdHash: SUBJECT_HASH,
            consentScopeHash: SCOPE_HASH,
            expiresAt: expiry,
            version: 1
        });

        vm.prank(workflow);
        registry.upsertConsent(input);
    }
}
