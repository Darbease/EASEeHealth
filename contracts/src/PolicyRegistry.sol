// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

interface IOrganizationRegistry {
    function isActivePayer(bytes32 orgId) external view returns (bool);
    function orgSigner(bytes32 orgId) external view returns (address);
}

/// @title PolicyRegistry — Payer-signed plans with on-chain coverage gates
/// @notice A plan = a policy version (hash + validity) + a payer-signed commitment to the
///         full off-chain benefit design + on-chain adjudication gates per procedure,
///         modeled on Da Vinci CRD `ext-coverage-information`
///         (covered / pa-needed → `covered`/`authRequired`; benefit limit → `capAmount`).
///         Hybrid split: key gates on-chain, full benefit design off-chain by hash.
contract PolicyRegistry is AccessControl, EIP712 {
    bytes32 public constant POLICY_ADMIN_ROLE = keccak256("POLICY_ADMIN_ROLE");

    bytes32 public constant PLAN_COMMITMENT_TYPEHASH =
        keccak256("PlanCommitment(bytes32 policyHash,bytes32 benefitDesignHash,uint64 effectiveFrom,uint64 effectiveTo)");

    // Denial reason bitmap bits (shared vocabulary — see CLAUDE.md)
    uint256 public constant REASON_NOT_COVERED = 1 << 1;
    uint256 public constant REASON_EXCEEDS_CAP = 1 << 2;
    uint256 public constant REASON_PLAN_INACTIVE = 1 << 10;

    struct PolicyVersion {
        bytes32 policyHash;
        bytes32 verifierKeyHash;
        uint64 effectiveFrom;
        uint64 effectiveTo;
        bool active;
    }

    /// @dev CRD-style coverage gate for one (plan, procedure) pair
    struct PlanGate {
        bool exists;
        bool covered;
        bool authRequired;
        uint256 capAmount; // settlement-token base units (6-decimals USDC)
    }

    /// @dev Payer's signed commitment binding the plan to its full off-chain benefit design
    struct PlanCommitment {
        bytes32 payerOrgId;
        bytes32 benefitDesignHash;
        address signer;
        bool signed;
    }

    mapping(bytes32 => PolicyVersion) private _policyVersions;
    mapping(bytes32 => mapping(bytes32 => PlanGate)) private _planGates; // policyHash → procedureKey
    mapping(bytes32 => PlanCommitment) private _planCommitments;

    IOrganizationRegistry public organizationRegistry;

    event PolicyVersionSet(bytes32 indexed policyHash, bytes32 verifierKeyHash, bool active);
    event PlanGateSet(
        bytes32 indexed policyHash, bytes32 indexed procedureKey, bool covered, bool authRequired, uint256 capAmount
    );
    event PlanSigned(bytes32 indexed policyHash, bytes32 indexed payerOrgId, bytes32 benefitDesignHash, address signer);
    event OrganizationRegistrySet(address organizationRegistry);

    constructor(address admin) EIP712("EASE-PolicyRegistry", "1") {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    /// @notice Wire the organization registry used to resolve payer signing addresses
    function setOrganizationRegistry(address registry) external onlyRole(DEFAULT_ADMIN_ROLE) {
        organizationRegistry = IOrganizationRegistry(registry);
        emit OrganizationRegistrySet(registry);
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

    /// @notice Set a plan's coverage gate for a procedure (procedureKey = keccak256("CPT:<code>"))
    function setPlanGate(bytes32 policyHash, bytes32 procedureKey, bool covered, bool authRequired, uint256 capAmount)
        external
        onlyRole(POLICY_ADMIN_ROLE)
    {
        require(_policyVersions[policyHash].policyHash != bytes32(0), "PolicyRegistry: policy not found");

        _planGates[policyHash][procedureKey] =
            PlanGate({exists: true, covered: covered, authRequired: authRequired, capAmount: capAmount});

        emit PlanGateSet(policyHash, procedureKey, covered, authRequired, capAmount);
    }

    /// @notice Attach the payer's EIP-712 signature over the plan commitment.
    ///         The signature binds (policyHash, benefitDesignHash, validity window) and must be
    ///         signed by the payer org's registered signing address.
    function attachPayerSignature(
        bytes32 policyHash,
        bytes32 payerOrgId,
        bytes32 benefitDesignHash,
        bytes calldata signature
    ) external onlyRole(POLICY_ADMIN_ROLE) {
        require(address(organizationRegistry) != address(0), "PolicyRegistry: org registry not set");
        require(_policyVersions[policyHash].policyHash != bytes32(0), "PolicyRegistry: policy not found");
        require(organizationRegistry.isActivePayer(payerOrgId), "PolicyRegistry: not an active payer");

        address recovered = ECDSA.recover(planCommitmentDigest(policyHash, benefitDesignHash), signature);
        require(recovered == organizationRegistry.orgSigner(payerOrgId), "PolicyRegistry: bad payer signature");

        _planCommitments[policyHash] = PlanCommitment({
            payerOrgId: payerOrgId,
            benefitDesignHash: benefitDesignHash,
            signer: recovered,
            signed: true
        });

        emit PlanSigned(policyHash, payerOrgId, benefitDesignHash, recovered);
    }

    /// @notice EIP-712 digest the payer signs (also used by deploy scripts / tests)
    function planCommitmentDigest(bytes32 policyHash, bytes32 benefitDesignHash) public view returns (bytes32) {
        PolicyVersion storage pv = _policyVersions[policyHash];
        return _hashTypedDataV4(
            keccak256(
                abi.encode(PLAN_COMMITMENT_TYPEHASH, policyHash, benefitDesignHash, pv.effectiveFrom, pv.effectiveTo)
            )
        );
    }

    /// @notice Adjudicate a procedure + amount against the plan's on-chain gates.
    /// @return ok true when the plan is active+signed, the procedure covered, and the amount within cap
    /// @return reasonBitmap denial reasons (bit 1 not covered, bit 2 exceeds cap, bit 10 plan inactive/unsigned)
    /// @return authRequired whether the plan requires prior auth for this procedure
    function checkCoverage(bytes32 policyHash, bytes32 procedureKey, uint256 amount, uint64 atTs)
        external
        view
        returns (bool ok, uint256 reasonBitmap, bool authRequired)
    {
        if (!_isPolicyActive(policyHash, atTs) || !_planCommitments[policyHash].signed) {
            reasonBitmap |= REASON_PLAN_INACTIVE;
        }

        PlanGate storage gate = _planGates[policyHash][procedureKey];
        if (!gate.exists || !gate.covered) {
            reasonBitmap |= REASON_NOT_COVERED;
        } else if (amount > gate.capAmount) {
            reasonBitmap |= REASON_EXCEEDS_CAP;
        }

        return (reasonBitmap == 0, reasonBitmap, gate.authRequired);
    }

    /// @notice Check if a policy is active at a given timestamp
    function isPolicyActive(bytes32 policyHash, uint64 atTs) external view returns (bool) {
        return _isPolicyActive(policyHash, atTs);
    }

    /// @notice Is the plan backed by a verified payer signature?
    function isPlanSigned(bytes32 policyHash) external view returns (bool) {
        return _planCommitments[policyHash].signed;
    }

    /// @notice Get full policy version record
    function getPolicyVersion(bytes32 policyHash) external view returns (PolicyVersion memory) {
        return _policyVersions[policyHash];
    }

    /// @notice Get a plan's coverage gate for a procedure
    function getPlanGate(bytes32 policyHash, bytes32 procedureKey) external view returns (PlanGate memory) {
        return _planGates[policyHash][procedureKey];
    }

    /// @notice Get the payer's plan commitment
    function getPlanCommitment(bytes32 policyHash) external view returns (PlanCommitment memory) {
        return _planCommitments[policyHash];
    }

    function _isPolicyActive(bytes32 policyHash, uint64 atTs) private view returns (bool) {
        PolicyVersion storage pv = _policyVersions[policyHash];
        if (!pv.active) return false;
        if (atTs < pv.effectiveFrom) return false;
        if (atTs > pv.effectiveTo) return false;
        return true;
    }
}
