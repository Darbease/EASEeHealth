// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// @title ClaimDecisionRegistry — Core claim state machine
/// @notice Manages claim lifecycle: submit → proof → approve/deny → pay, with challenge support
contract ClaimDecisionRegistry is AccessControl {
    bytes32 public constant WORKFLOW_ROLE = keccak256("WORKFLOW_ROLE");
    bytes32 public constant CHALLENGE_ROLE = keccak256("CHALLENGE_ROLE");

    enum State {
        NONE, // 0 — claim does not exist
        SUBMITTED, // 1
        PROOF_PENDING, // 2
        APPROVED, // 3
        DENIED, // 4
        CHALLENGED, // 5
        PAID // 6
    }

    struct ClaimDecision {
        bytes32 claimId;
        State state;
        bytes32 policyHash;
        bytes32 proofHash;
        uint256 reasonBitmap;
        uint64 updatedAt;
    }

    mapping(bytes32 => ClaimDecision) private _decisions;

    event ClaimSubmitted(bytes32 indexed claimId, bytes32 policyHash);
    event ProofEvaluated(
        bytes32 indexed claimId,
        bytes32 proofHash,
        bool approved,
        uint256 reasonBitmap
    );
    event ClaimChallenged(bytes32 indexed claimId, uint16 reasonCode);
    event ClaimResolved(bytes32 indexed claimId, bool approved);
    event ClaimPaid(bytes32 indexed claimId);

    constructor(address admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    /// @notice Submit a new claim. Reverts on duplicate claim_id.
    function submitClaim(
        bytes32 claimId,
        bytes32 policyHash
    ) external onlyRole(WORKFLOW_ROLE) {
        require(
            _decisions[claimId].state == State.NONE,
            "ClaimDecisionRegistry: duplicate claim_id"
        );

        _decisions[claimId] = ClaimDecision({
            claimId: claimId,
            state: State.SUBMITTED,
            policyHash: policyHash,
            proofHash: bytes32(0),
            reasonBitmap: 0,
            updatedAt: uint64(block.timestamp)
        });

        emit ClaimSubmitted(claimId, policyHash);
    }

    /// @notice Set the proof result. Transitions SUBMITTED → APPROVED or DENIED.
    function setProofResult(
        bytes32 claimId,
        bytes32 proofHash,
        uint256 reasonBitmap,
        bool approved
    ) external onlyRole(WORKFLOW_ROLE) {
        ClaimDecision storage d = _decisions[claimId];
        require(
            d.state == State.SUBMITTED,
            "ClaimDecisionRegistry: invalid state for proof"
        );

        d.proofHash = proofHash;
        d.reasonBitmap = reasonBitmap;
        d.state = approved ? State.APPROVED : State.DENIED;
        d.updatedAt = uint64(block.timestamp);

        emit ProofEvaluated(claimId, proofHash, approved, reasonBitmap);
    }

    /// @notice Challenge an approved claim. APPROVED → CHALLENGED.
    function challengeClaim(
        bytes32 claimId,
        uint16 reasonCode
    ) external onlyRole(CHALLENGE_ROLE) {
        ClaimDecision storage d = _decisions[claimId];
        require(
            d.state == State.APPROVED,
            "ClaimDecisionRegistry: can only challenge APPROVED"
        );

        d.state = State.CHALLENGED;
        d.updatedAt = uint64(block.timestamp);

        emit ClaimChallenged(claimId, reasonCode);
    }

    /// @notice Resolve a challenge. CHALLENGED → APPROVED or DENIED.
    function resolveChallenge(
        bytes32 claimId,
        bool approve
    ) external onlyRole(CHALLENGE_ROLE) {
        ClaimDecision storage d = _decisions[claimId];
        require(
            d.state == State.CHALLENGED,
            "ClaimDecisionRegistry: not challenged"
        );

        d.state = approve ? State.APPROVED : State.DENIED;
        d.updatedAt = uint64(block.timestamp);

        emit ClaimResolved(claimId, approve);
    }

    /// @notice Mark a claim as paid. APPROVED → PAID. Terminal state.
    function markPaid(bytes32 claimId) external onlyRole(WORKFLOW_ROLE) {
        ClaimDecision storage d = _decisions[claimId];
        require(
            d.state == State.APPROVED,
            "ClaimDecisionRegistry: can only pay APPROVED"
        );

        d.state = State.PAID;
        d.updatedAt = uint64(block.timestamp);

        emit ClaimPaid(claimId);
    }

    /// @notice Get the full decision record for a claim
    function getDecision(
        bytes32 claimId
    ) external view returns (ClaimDecision memory) {
        return _decisions[claimId];
    }
}
