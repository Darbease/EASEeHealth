// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ClaimEscrow} from "../src/ClaimEscrow.sol";
import {MockUSDC} from "../src/MockUSDC.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

// ═════════════════════════════════════════════════════════════════════
// Unit tests
// ═════════════════════════════════════════════════════════════════════

contract ClaimEscrowTest is Test {
    ClaimEscrow public escrow;
    MockUSDC public usdc;

    address public admin = address(this);
    address public workflow = address(0x1001);
    address public challenger = address(0xC4A);
    address public treasury = address(0x7EA5);
    address public unauthorized = address(0xBAD);
    address public recipient = address(0xBEEF);

    bytes32 constant CLAIM_ID = keccak256("claim-001");
    uint256 constant FUND_AMOUNT = 1_000_000e6; // 1M USDC
    uint256 constant PAYOUT_AMOUNT = 500e6; // 500 USDC

    function setUp() public {
        usdc = new MockUSDC();
        escrow = new ClaimEscrow(admin, IERC20(address(usdc)));

        escrow.grantRole(escrow.WORKFLOW_ROLE(), workflow);
        escrow.grantRole(escrow.CHALLENGE_ROLE(), challenger);
        escrow.grantRole(escrow.TREASURY_ROLE(), treasury);

        // Mint tokens to the treasury and approve escrow
        usdc.mint(treasury, FUND_AMOUNT);
        vm.prank(treasury);
        usdc.approve(address(escrow), type(uint256).max);
    }

    // ─── fundPool ────────────────────────────────────────────────────

    function test_fundPool() public {
        uint256 amount = 100_000e6;

        vm.prank(treasury);
        escrow.fundPool(amount);

        assertEq(usdc.balanceOf(address(escrow)), amount);
        assertEq(usdc.balanceOf(treasury), FUND_AMOUNT - amount);
    }

    // ─── schedulePayout ──────────────────────────────────────────────

    function test_schedulePayout() public {
        vm.prank(workflow);
        escrow.schedulePayout(CLAIM_ID, recipient, PAYOUT_AMOUNT);

        ClaimEscrow.PayoutInstruction memory p = escrow.getPayout(CLAIM_ID);
        assertEq(p.recipient, recipient);
        assertEq(p.amount, PAYOUT_AMOUNT);
        assertEq(uint8(p.status), uint8(ClaimEscrow.PayoutStatus.SCHEDULED));
        assertEq(escrow.totalScheduled(), PAYOUT_AMOUNT);
    }

    function test_schedulePayout_duplicate() public {
        vm.prank(workflow);
        escrow.schedulePayout(CLAIM_ID, recipient, PAYOUT_AMOUNT);

        vm.prank(workflow);
        vm.expectRevert("ClaimEscrow: payout already exists");
        escrow.schedulePayout(CLAIM_ID, recipient, PAYOUT_AMOUNT);
    }

    // ─── releasePayout ───────────────────────────────────────────────

    function test_releasePayout() public {
        _fundAndSchedule(CLAIM_ID, PAYOUT_AMOUNT);

        uint256 recipientBalBefore = usdc.balanceOf(recipient);
        uint256 escrowBalBefore = usdc.balanceOf(address(escrow));

        vm.prank(workflow);
        escrow.releasePayout(CLAIM_ID);

        ClaimEscrow.PayoutInstruction memory p = escrow.getPayout(CLAIM_ID);
        assertEq(uint8(p.status), uint8(ClaimEscrow.PayoutStatus.RELEASED));
        assertEq(usdc.balanceOf(recipient), recipientBalBefore + PAYOUT_AMOUNT);
        assertEq(usdc.balanceOf(address(escrow)), escrowBalBefore - PAYOUT_AMOUNT);
        assertEq(escrow.totalScheduled(), 0);
    }

    function test_releasePayout_notScheduled() public {
        bytes32 unknownClaim = keccak256("never-scheduled");

        vm.prank(workflow);
        vm.expectRevert("ClaimEscrow: not scheduled");
        escrow.releasePayout(unknownClaim);
    }

    // ─── cancelPayout ────────────────────────────────────────────────

    function test_cancelPayout() public {
        _fundAndSchedule(CLAIM_ID, PAYOUT_AMOUNT);

        vm.prank(challenger);
        escrow.cancelPayout(CLAIM_ID);

        ClaimEscrow.PayoutInstruction memory p = escrow.getPayout(CLAIM_ID);
        assertEq(uint8(p.status), uint8(ClaimEscrow.PayoutStatus.CANCELED));
        assertEq(escrow.totalScheduled(), 0);
    }

    function test_cancelPayout_released() public {
        _fundAndSchedule(CLAIM_ID, PAYOUT_AMOUNT);

        // Release first
        vm.prank(workflow);
        escrow.releasePayout(CLAIM_ID);

        // Cancel after release should revert
        vm.prank(challenger);
        vm.expectRevert("ClaimEscrow: not scheduled");
        escrow.cancelPayout(CLAIM_ID);
    }

    // ─── Integration / multi-step ────────────────────────────────────

    function test_fullFlow() public {
        uint256 fundAmount = 10_000e6;

        // Fund the pool
        vm.prank(treasury);
        escrow.fundPool(fundAmount);

        // Schedule payout
        vm.prank(workflow);
        escrow.schedulePayout(CLAIM_ID, recipient, PAYOUT_AMOUNT);
        assertEq(escrow.totalScheduled(), PAYOUT_AMOUNT);

        // Release payout
        vm.prank(workflow);
        escrow.releasePayout(CLAIM_ID);

        // Verify final balances
        assertEq(usdc.balanceOf(recipient), PAYOUT_AMOUNT);
        assertEq(usdc.balanceOf(address(escrow)), fundAmount - PAYOUT_AMOUNT);
        assertEq(escrow.totalScheduled(), 0);
    }

    function test_cancelThenRelease() public {
        _fundAndSchedule(CLAIM_ID, PAYOUT_AMOUNT);

        // Cancel
        vm.prank(challenger);
        escrow.cancelPayout(CLAIM_ID);

        // Try to release canceled payout
        vm.prank(workflow);
        vm.expectRevert("ClaimEscrow: not scheduled");
        escrow.releasePayout(CLAIM_ID);
    }

    // ─── Authorization ───────────────────────────────────────────────

    function test_unauthorized_fund() public {
        vm.prank(unauthorized);
        vm.expectRevert();
        escrow.fundPool(1000e6);
    }

    function test_unauthorized_schedule() public {
        vm.prank(unauthorized);
        vm.expectRevert();
        escrow.schedulePayout(CLAIM_ID, recipient, PAYOUT_AMOUNT);
    }

    function test_unauthorized_release() public {
        _fundAndSchedule(CLAIM_ID, PAYOUT_AMOUNT);

        vm.prank(unauthorized);
        vm.expectRevert();
        escrow.releasePayout(CLAIM_ID);
    }

    function test_unauthorized_cancel() public {
        _fundAndSchedule(CLAIM_ID, PAYOUT_AMOUNT);

        vm.prank(unauthorized);
        vm.expectRevert();
        escrow.cancelPayout(CLAIM_ID);
    }

    // ─── Helpers ─────────────────────────────────────────────────────

    function _fundAndSchedule(bytes32 claimId, uint256 amount) internal {
        // Fund the pool with enough to cover the payout
        vm.prank(treasury);
        escrow.fundPool(amount);

        // Schedule the payout
        vm.prank(workflow);
        escrow.schedulePayout(claimId, recipient, amount);
    }
}

// ═════════════════════════════════════════════════════════════════════
// Invariant test — total scheduled never exceeds balance
// ═════════════════════════════════════════════════════════════════════

/// @title EscrowHandler — Stateful handler for invariant testing
contract EscrowHandler is Test {
    ClaimEscrow public escrow;
    MockUSDC public usdc;
    address public workflow;
    address public challenger;
    address public treasury;
    address public recipient;

    bytes32[] public knownClaims;
    uint256 private _nonce;

    constructor(
        ClaimEscrow _escrow,
        MockUSDC _usdc,
        address _workflow,
        address _challenger,
        address _treasury,
        address _recipient
    ) {
        escrow = _escrow;
        usdc = _usdc;
        workflow = _workflow;
        challenger = _challenger;
        treasury = _treasury;
        recipient = _recipient;
    }

    /// @notice Fund the pool with a bounded amount
    function fund(uint256 amount) external {
        amount = bound(amount, 1e6, 100_000e6);

        // Ensure treasury has enough
        uint256 bal = usdc.balanceOf(treasury);
        if (bal < amount) {
            usdc.mint(treasury, amount - bal);
        }

        vm.prank(treasury);
        usdc.approve(address(escrow), amount);
        vm.prank(treasury);
        escrow.fundPool(amount);
    }

    /// @notice Schedule a payout for a new claim
    function schedule(uint256 amount) external {
        amount = bound(amount, 1e6, 10_000e6);
        bytes32 claimId = keccak256(abi.encode("escrow-claim", _nonce));
        _nonce++;

        vm.prank(workflow);
        escrow.schedulePayout(claimId, recipient, amount);

        knownClaims.push(claimId);
    }

    /// @notice Release a random scheduled payout
    function release(uint256 index) external {
        if (knownClaims.length == 0) return;
        bytes32 claimId = knownClaims[index % knownClaims.length];

        ClaimEscrow.PayoutInstruction memory p = escrow.getPayout(claimId);
        if (p.status != ClaimEscrow.PayoutStatus.SCHEDULED) return;

        // Only release if escrow has sufficient balance
        if (usdc.balanceOf(address(escrow)) < p.amount) return;

        vm.prank(workflow);
        escrow.releasePayout(claimId);
    }

    /// @notice Cancel a random scheduled payout
    function cancel(uint256 index) external {
        if (knownClaims.length == 0) return;
        bytes32 claimId = knownClaims[index % knownClaims.length];

        ClaimEscrow.PayoutInstruction memory p = escrow.getPayout(claimId);
        if (p.status != ClaimEscrow.PayoutStatus.SCHEDULED) return;

        vm.prank(challenger);
        escrow.cancelPayout(claimId);
    }

    function claimCount() external view returns (uint256) {
        return knownClaims.length;
    }
}

contract ClaimEscrowInvariantTest is Test {
    ClaimEscrow public escrow;
    MockUSDC public usdc;
    EscrowHandler public handler;

    address public admin = address(this);
    address public workflow = address(0x1001);
    address public challenger = address(0xC4A);
    address public treasury = address(0x7EA5);
    address public recipient = address(0xBEEF);

    function setUp() public {
        usdc = new MockUSDC();
        escrow = new ClaimEscrow(admin, IERC20(address(usdc)));

        escrow.grantRole(escrow.WORKFLOW_ROLE(), workflow);
        escrow.grantRole(escrow.CHALLENGE_ROLE(), challenger);
        escrow.grantRole(escrow.TREASURY_ROLE(), treasury);

        // Initial funding
        usdc.mint(treasury, 10_000_000e6);
        vm.prank(treasury);
        usdc.approve(address(escrow), type(uint256).max);
        vm.prank(treasury);
        escrow.fundPool(1_000_000e6);

        handler = new EscrowHandler(escrow, usdc, workflow, challenger, treasury, recipient);

        targetContract(address(handler));
    }

    /// @notice Invariant: totalScheduled never exceeds the escrow token balance
    function invariant_scheduledNeverExceedsBalance() public view {
        uint256 balance = usdc.balanceOf(address(escrow));
        uint256 scheduled = escrow.totalScheduled();
        assertLe(scheduled, balance, "Scheduled payouts exceed escrow balance");
    }
}
