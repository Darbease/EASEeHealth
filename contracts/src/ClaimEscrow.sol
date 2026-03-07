// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title ClaimEscrow — ERC-20 settlement pool with payout scheduling
/// @notice Manages fund pool, schedules payouts on approval, releases on confirmation
contract ClaimEscrow is AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant WORKFLOW_ROLE = keccak256("WORKFLOW_ROLE");
    bytes32 public constant CHALLENGE_ROLE = keccak256("CHALLENGE_ROLE");
    bytes32 public constant TREASURY_ROLE = keccak256("TREASURY_ROLE");

    IERC20 public immutable settlementToken;

    enum PayoutStatus {
        NONE,
        SCHEDULED,
        RELEASED,
        CANCELED
    }

    struct PayoutInstruction {
        address recipient;
        uint256 amount;
        PayoutStatus status;
    }

    mapping(bytes32 => PayoutInstruction) private _payouts;
    uint256 public totalScheduled;

    event PoolFunded(address indexed from, uint256 amount);
    event PayoutScheduled(bytes32 indexed claimId, address recipient, uint256 amount);
    event PayoutReleased(bytes32 indexed claimId, address recipient, uint256 amount);
    event PayoutCanceled(bytes32 indexed claimId, uint16 reasonCode);

    constructor(address admin, IERC20 _settlementToken) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        settlementToken = _settlementToken;
    }

    /// @notice Fund the escrow pool. Caller must have approved this contract.
    function fundPool(uint256 amount) external onlyRole(TREASURY_ROLE) {
        settlementToken.safeTransferFrom(msg.sender, address(this), amount);
        emit PoolFunded(msg.sender, amount);
    }

    /// @notice Schedule a payout for a claim
    function schedulePayout(bytes32 claimId, address recipient, uint256 amount) external onlyRole(WORKFLOW_ROLE) {
        require(_payouts[claimId].status == PayoutStatus.NONE, "ClaimEscrow: payout already exists");
        require(recipient != address(0), "ClaimEscrow: zero recipient");
        require(amount > 0, "ClaimEscrow: zero amount");

        _payouts[claimId] = PayoutInstruction({recipient: recipient, amount: amount, status: PayoutStatus.SCHEDULED});

        totalScheduled += amount;

        emit PayoutScheduled(claimId, recipient, amount);
    }

    /// @notice Release a scheduled payout. CEI + ReentrancyGuard.
    function releasePayout(bytes32 claimId) external onlyRole(WORKFLOW_ROLE) nonReentrant {
        PayoutInstruction storage p = _payouts[claimId];
        require(p.status == PayoutStatus.SCHEDULED, "ClaimEscrow: not scheduled");

        // Effects before interaction (CEI)
        p.status = PayoutStatus.RELEASED;
        totalScheduled -= p.amount;

        // Interaction
        settlementToken.safeTransfer(p.recipient, p.amount);

        emit PayoutReleased(claimId, p.recipient, p.amount);
    }

    /// @notice Cancel a scheduled payout (e.g., due to challenge)
    function cancelPayout(bytes32 claimId) external onlyRole(CHALLENGE_ROLE) {
        PayoutInstruction storage p = _payouts[claimId];
        require(p.status == PayoutStatus.SCHEDULED, "ClaimEscrow: not scheduled");

        p.status = PayoutStatus.CANCELED;
        totalScheduled -= p.amount;

        emit PayoutCanceled(claimId, 0);
    }

    /// @notice Get payout details for a claim
    function getPayout(bytes32 claimId) external view returns (PayoutInstruction memory) {
        return _payouts[claimId];
    }
}
