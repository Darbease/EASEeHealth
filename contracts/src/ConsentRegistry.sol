// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// @title ConsentRegistry — Consent lifecycle management
/// @notice Manages patient consent records: create, update, revoke, query
contract ConsentRegistry is AccessControl {
    bytes32 public constant WORKFLOW_ROLE = keccak256("WORKFLOW_ROLE");

    enum Status {
        ACTIVE,
        REVOKED,
        EXPIRED
    }

    struct ConsentRecord {
        bytes32 consentId;
        bytes32 subjectIdHash;
        bytes32 consentScopeHash;
        uint64 issuedAt;
        uint64 expiresAt;
        Status status;
        uint32 version;
    }

    struct ConsentRecordInput {
        bytes32 consentId;
        bytes32 subjectIdHash;
        bytes32 consentScopeHash;
        uint64 expiresAt;
        uint32 version;
    }

    mapping(bytes32 => ConsentRecord) private _consents;

    event ConsentUpserted(
        bytes32 indexed consentId, bytes32 subjectIdHash, bytes32 scopeHash, uint8 status, uint32 version
    );
    event ConsentRevoked(bytes32 indexed consentId, uint16 reasonCode, uint64 revokedAt);

    constructor(address admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    /// @notice Create or update a consent record
    function upsertConsent(ConsentRecordInput calldata input) external onlyRole(WORKFLOW_ROLE) {
        ConsentRecord storage record = _consents[input.consentId];
        record.consentId = input.consentId;
        record.subjectIdHash = input.subjectIdHash;
        record.consentScopeHash = input.consentScopeHash;
        record.issuedAt = uint64(block.timestamp);
        record.expiresAt = input.expiresAt;
        record.status = Status.ACTIVE;
        record.version = input.version;

        emit ConsentUpserted(input.consentId, input.subjectIdHash, input.consentScopeHash, uint8(Status.ACTIVE), input.version);
    }

    /// @notice Revoke an existing consent
    function revokeConsent(bytes32 consentId, uint16 reasonCode) external onlyRole(WORKFLOW_ROLE) {
        ConsentRecord storage record = _consents[consentId];
        require(record.consentId != bytes32(0), "ConsentRegistry: consent not found");
        require(record.status == Status.ACTIVE, "ConsentRegistry: consent not active");

        record.status = Status.REVOKED;

        emit ConsentRevoked(consentId, reasonCode, uint64(block.timestamp));
    }

    /// @notice Get full consent record
    function getConsent(bytes32 consentId) external view returns (ConsentRecord memory) {
        return _consents[consentId];
    }

    /// @notice Check if consent is active at a given timestamp
    function isConsentActive(bytes32 consentId, uint64 atTs) external view returns (bool) {
        ConsentRecord storage record = _consents[consentId];
        if (record.consentId == bytes32(0)) return false;
        if (record.status != Status.ACTIVE) return false;
        if (atTs > record.expiresAt) return false;
        return true;
    }
}
