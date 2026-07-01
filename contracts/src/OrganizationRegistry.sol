// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// @title OrganizationRegistry — Shared provider/payer identity + network membership
/// @notice Orgs (providers, payers) as on-chain identities, plus provider↔plan network
///         membership modeled on Da Vinci Plan-Net `OrganizationAffiliation`
///         (network reference + active period → "in-network now?").
///         This registry is the shared source of truth: a membership fix written once
///         is visible to every payer/provider reading it.
contract OrganizationRegistry is AccessControl {
    bytes32 public constant REGISTRAR_ROLE = keccak256("REGISTRAR_ROLE");

    enum OrgKind {
        PROVIDER,
        PAYER
    }

    struct Org {
        bytes32 orgId;
        OrgKind kind;
        address signer;
        bool active;
        string name;
    }

    /// @dev Plan-Net OrganizationAffiliation shape: provider org ↔ plan (network) + active period
    struct NetworkMembership {
        bytes32 providerOrgId;
        bytes32 planHash;
        uint64 effectiveFrom;
        uint64 effectiveTo;
        bool active;
    }

    mapping(bytes32 => Org) private _orgs;
    mapping(bytes32 => NetworkMembership) private _memberships; // keccak256(providerOrgId, planHash)

    event OrgRegistered(bytes32 indexed orgId, uint8 kind, address signer, string name);
    event OrgStatusSet(bytes32 indexed orgId, bool active);
    event OrgSignerSet(bytes32 indexed orgId, address signer);
    event NetworkMembershipSet(
        bytes32 indexed providerOrgId, bytes32 indexed planHash, uint64 effectiveFrom, uint64 effectiveTo, bool active
    );

    constructor(address admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    /// @notice Register a new organization identity
    function registerOrg(bytes32 orgId, OrgKind kind, address signer, string calldata name)
        external
        onlyRole(REGISTRAR_ROLE)
    {
        require(orgId != bytes32(0), "OrganizationRegistry: zero orgId");
        require(_orgs[orgId].orgId == bytes32(0), "OrganizationRegistry: org exists");

        _orgs[orgId] = Org({orgId: orgId, kind: kind, signer: signer, active: true, name: name});

        emit OrgRegistered(orgId, uint8(kind), signer, name);
    }

    /// @notice Activate / deactivate an organization
    function setOrgActive(bytes32 orgId, bool active) external onlyRole(REGISTRAR_ROLE) {
        require(_orgs[orgId].orgId != bytes32(0), "OrganizationRegistry: org not found");
        _orgs[orgId].active = active;
        emit OrgStatusSet(orgId, active);
    }

    /// @notice Rotate an organization's signing address
    function setOrgSigner(bytes32 orgId, address signer) external onlyRole(REGISTRAR_ROLE) {
        require(_orgs[orgId].orgId != bytes32(0), "OrganizationRegistry: org not found");
        _orgs[orgId].signer = signer;
        emit OrgSignerSet(orgId, signer);
    }

    /// @notice Set or update a provider's network membership for a plan
    function setNetworkMembership(
        bytes32 providerOrgId,
        bytes32 planHash,
        uint64 effectiveFrom,
        uint64 effectiveTo,
        bool active
    ) external onlyRole(REGISTRAR_ROLE) {
        Org storage org = _orgs[providerOrgId];
        require(org.orgId != bytes32(0), "OrganizationRegistry: org not found");
        require(org.kind == OrgKind.PROVIDER, "OrganizationRegistry: not a provider");
        require(planHash != bytes32(0), "OrganizationRegistry: zero planHash");

        _memberships[_membershipKey(providerOrgId, planHash)] = NetworkMembership({
            providerOrgId: providerOrgId,
            planHash: planHash,
            effectiveFrom: effectiveFrom,
            effectiveTo: effectiveTo,
            active: active
        });

        emit NetworkMembershipSet(providerOrgId, planHash, effectiveFrom, effectiveTo, active);
    }

    /// @notice Is the provider in-network for the plan at a given timestamp?
    function isInNetwork(bytes32 providerOrgId, bytes32 planHash, uint64 atTs) external view returns (bool) {
        Org storage org = _orgs[providerOrgId];
        if (org.orgId == bytes32(0) || !org.active) return false;

        NetworkMembership storage m = _memberships[_membershipKey(providerOrgId, planHash)];
        if (m.providerOrgId == bytes32(0) || !m.active) return false;
        if (atTs < m.effectiveFrom) return false;
        if (atTs > m.effectiveTo) return false;
        return true;
    }

    /// @notice Is the org a registered, active payer? (used by PolicyRegistry signature checks)
    function isActivePayer(bytes32 orgId) external view returns (bool) {
        Org storage org = _orgs[orgId];
        return org.orgId != bytes32(0) && org.active && org.kind == OrgKind.PAYER;
    }

    /// @notice Signing address registered for an org
    function orgSigner(bytes32 orgId) external view returns (address) {
        return _orgs[orgId].signer;
    }

    /// @notice Get full organization record
    function getOrg(bytes32 orgId) external view returns (Org memory) {
        return _orgs[orgId];
    }

    /// @notice Get full network membership record
    function getNetworkMembership(bytes32 providerOrgId, bytes32 planHash)
        external
        view
        returns (NetworkMembership memory)
    {
        return _memberships[_membershipKey(providerOrgId, planHash)];
    }

    function _membershipKey(bytes32 providerOrgId, bytes32 planHash) private pure returns (bytes32) {
        return keccak256(abi.encodePacked(providerOrgId, planHash));
    }
}
