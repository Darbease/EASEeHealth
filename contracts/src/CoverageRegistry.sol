// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// @title CoverageRegistry — Member eligibility / active coverage
/// @notice Member↔plan coverage records modeled on FHIR `Coverage` /
///         `CoverageEligibilityResponse` (insurance.inforce + benefitPeriod).
///         Payer-written (registrar role). memberId is a hash — no PHI on-chain.
contract CoverageRegistry is AccessControl {
    bytes32 public constant REGISTRAR_ROLE = keccak256("REGISTRAR_ROLE");

    struct CoverageRecord {
        bytes32 memberId;
        bytes32 planHash;
        uint64 effectiveFrom;
        uint64 effectiveTo;
        bool active;
    }

    mapping(bytes32 => CoverageRecord) private _coverages; // keccak256(memberId, planHash)

    event CoverageUpserted(
        bytes32 indexed memberId, bytes32 indexed planHash, uint64 effectiveFrom, uint64 effectiveTo, bool active
    );

    constructor(address admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    /// @notice Create or update a member's coverage record for a plan
    function upsertCoverage(bytes32 memberId, bytes32 planHash, uint64 effectiveFrom, uint64 effectiveTo, bool active)
        external
        onlyRole(REGISTRAR_ROLE)
    {
        require(memberId != bytes32(0), "CoverageRegistry: zero memberId");
        require(planHash != bytes32(0), "CoverageRegistry: zero planHash");

        _coverages[_coverageKey(memberId, planHash)] = CoverageRecord({
            memberId: memberId,
            planHash: planHash,
            effectiveFrom: effectiveFrom,
            effectiveTo: effectiveTo,
            active: active
        });

        emit CoverageUpserted(memberId, planHash, effectiveFrom, effectiveTo, active);
    }

    /// @notice Is the member eligible under the plan at a given timestamp?
    function isEligible(bytes32 memberId, bytes32 planHash, uint64 atTs) external view returns (bool) {
        CoverageRecord storage c = _coverages[_coverageKey(memberId, planHash)];
        if (c.memberId == bytes32(0) || !c.active) return false;
        if (atTs < c.effectiveFrom) return false;
        if (atTs > c.effectiveTo) return false;
        return true;
    }

    /// @notice Get full coverage record
    function getCoverage(bytes32 memberId, bytes32 planHash) external view returns (CoverageRecord memory) {
        return _coverages[_coverageKey(memberId, planHash)];
    }

    function _coverageKey(bytes32 memberId, bytes32 planHash) private pure returns (bytes32) {
        return keccak256(abi.encodePacked(memberId, planHash));
    }
}
