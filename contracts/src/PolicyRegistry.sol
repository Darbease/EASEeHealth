// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// @title PolicyRegistry — Policy version hash management
/// @notice Stores and validates policy version metadata
contract PolicyRegistry is AccessControl {
    bytes32 public constant POLICY_ADMIN_ROLE = keccak256("POLICY_ADMIN_ROLE");

    struct PolicyVersion {
        bytes32 policyHash;
        bytes32 verifierKeyHash;
        uint64 effectiveFrom;
        uint64 effectiveTo;
        bool active;
    }

    mapping(bytes32 => PolicyVersion) private _policyVersions;

    event PolicyVersionSet(bytes32 indexed policyHash, bytes32 verifierKeyHash, bool active);

    constructor(address admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    /// @notice Set or update a policy version
    function setPolicyVersion(
        bytes32 policyHash,
        bytes32 verifierKeyHash,
        uint64 effectiveFrom,
        uint64 effectiveTo,
        bool active
    ) external onlyRole(POLICY_ADMIN_ROLE) {
        _policyVersions[policyHash] = PolicyVersion({
            policyHash: policyHash,
            verifierKeyHash: verifierKeyHash,
            effectiveFrom: effectiveFrom,
            effectiveTo: effectiveTo,
            active: active
        });

        emit PolicyVersionSet(policyHash, verifierKeyHash, active);
    }

    /// @notice Check if a policy is active at a given timestamp
    function isPolicyActive(bytes32 policyHash, uint64 atTs) external view returns (bool) {
        PolicyVersion storage pv = _policyVersions[policyHash];
        if (!pv.active) return false;
        if (atTs < pv.effectiveFrom) return false;
        if (atTs > pv.effectiveTo) return false;
        return true;
    }

    /// @notice Get full policy version record
    function getPolicyVersion(bytes32 policyHash) external view returns (PolicyVersion memory) {
        return _policyVersions[policyHash];
    }
}
