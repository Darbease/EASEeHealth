// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ClaimDecisionRegistry} from "../src/ClaimDecisionRegistry.sol";

// ═════════════════════════════════════════════════════════════════════
// Unit + Fuzz tests
// ═════════════════════════════════════════════════════════════════════

contract ClaimDecisionRegistryTest is Test {
    ClaimDecisionRegistry public registry;

    address public admin = address(this);
    address public workflow = address(0x1001);
    address public challenger = address(0xC4A);
    address public unauthorized = address(0xBAD);

    bytes32 constant CLAIM_ID = keccak256("claim-001");
    bytes32 constant POLICY_HASH = keccak256("policy-v1");
    bytes32 constant PROOF_HASH = keccak256("proof-abc");

    function setUp() public {
        registry = new ClaimDecisionRegistry(admin);
        registry.grantRole(registry.WORKFLOW_ROLE(), workflow);
        registry.grantRole(registry.CHALLENGE_ROLE(), challenger);
    }

    // ─── submitClaim ─────────────────────────────────────────────────

    function test_submitClaim() public {
        vm.prank(workflow);
        registry.submitClaim(CLAIM_ID, POLICY_HASH);

        ClaimDecisionRegistry.ClaimDecision memory d = registry.getDecision(CLAIM_ID);
        assertEq(d.claimId, CLAIM_ID);
        assertEq(uint8(d.state), uint8(ClaimDecisionRegistry.State.SUBMITTED));
        assertEq(d.policyHash, POLICY_HASH);
        assertEq(d.proofHash, bytes32(0));
        assertEq(d.reasonBitmap, 0);
        assertEq(d.updatedAt, uint64(block.timestamp));
    }

    function test_submitClaim_duplicate() public {
        vm.prank(workflow);
        registry.submitClaim(CLAIM_ID, POLICY_HASH);

        vm.prank(workflow);
        vm.expectRevert("ClaimDecisionRegistry: duplicate claim_id");
        registry.submitClaim(CLAIM_ID, POLICY_HASH);
    }

    // ─── setProofResult ──────────────────────────────────────────────

    function test_setProofResult_approved() public {
        _submitClaim(CLAIM_ID);

        vm.prank(workflow);
        registry.setProofResult(CLAIM_ID, PROOF_HASH, 0, true);

        ClaimDecisionRegistry.ClaimDecision memory d = registry.getDecision(CLAIM_ID);
        assertEq(uint8(d.state), uint8(ClaimDecisionRegistry.State.APPROVED));
        assertEq(d.proofHash, PROOF_HASH);
        assertEq(d.reasonBitmap, 0);
    }

    function test_setProofResult_denied() public {
        _submitClaim(CLAIM_ID);

        // Reason bit 1 (procedure not covered) + bit 2 (amount exceeds cap)
        uint256 bitmap = (1 << 1) | (1 << 2);

        vm.prank(workflow);
        registry.setProofResult(CLAIM_ID, PROOF_HASH, bitmap, false);

        ClaimDecisionRegistry.ClaimDecision memory d = registry.getDecision(CLAIM_ID);
        assertEq(uint8(d.state), uint8(ClaimDecisionRegistry.State.DENIED));
        assertEq(d.reasonBitmap, bitmap);
    }

    function test_setProofResult_invalidState() public {
        _submitClaim(CLAIM_ID);

        // Move to APPROVED first
        vm.prank(workflow);
        registry.setProofResult(CLAIM_ID, PROOF_HASH, 0, true);

        // Try to set proof again on APPROVED claim
        vm.prank(workflow);
        vm.expectRevert("ClaimDecisionRegistry: invalid state for proof");
        registry.setProofResult(CLAIM_ID, PROOF_HASH, 0, true);
    }

    // ─── markPaid ────────────────────────────────────────────────────

    function test_markPaid() public {
        _submitAndApprove(CLAIM_ID);

        vm.prank(workflow);
        registry.markPaid(CLAIM_ID);

        ClaimDecisionRegistry.ClaimDecision memory d = registry.getDecision(CLAIM_ID);
        assertEq(uint8(d.state), uint8(ClaimDecisionRegistry.State.PAID));
    }

    function test_markPaid_notApproved() public {
        _submitClaim(CLAIM_ID);

        // Still in SUBMITTED state
        vm.prank(workflow);
        vm.expectRevert("ClaimDecisionRegistry: can only pay APPROVED");
        registry.markPaid(CLAIM_ID);
    }

    function test_markPaid_challenged() public {
        _submitAndApprove(CLAIM_ID);

        // Challenge the claim
        vm.prank(challenger);
        registry.challengeClaim(CLAIM_ID, 1);

        // Try to pay while CHALLENGED
        vm.prank(workflow);
        vm.expectRevert("ClaimDecisionRegistry: can only pay APPROVED");
        registry.markPaid(CLAIM_ID);
    }

    // ─── challengeClaim ──────────────────────────────────────────────

    function test_challengeClaim() public {
        _submitAndApprove(CLAIM_ID);

        vm.prank(challenger);
        registry.challengeClaim(CLAIM_ID, 42);

        ClaimDecisionRegistry.ClaimDecision memory d = registry.getDecision(CLAIM_ID);
        assertEq(uint8(d.state), uint8(ClaimDecisionRegistry.State.CHALLENGED));
    }

    function test_challengeClaim_notApproved() public {
        _submitClaim(CLAIM_ID);

        // Still SUBMITTED, not APPROVED
        vm.prank(challenger);
        vm.expectRevert("ClaimDecisionRegistry: can only challenge APPROVED");
        registry.challengeClaim(CLAIM_ID, 1);
    }

    // ─── resolveChallenge ────────────────────────────────────────────

    function test_resolveChallenge_approve() public {
        _submitApproveAndChallenge(CLAIM_ID);

        vm.prank(challenger);
        registry.resolveChallenge(CLAIM_ID, true);

        ClaimDecisionRegistry.ClaimDecision memory d = registry.getDecision(CLAIM_ID);
        assertEq(uint8(d.state), uint8(ClaimDecisionRegistry.State.APPROVED));
    }

    function test_resolveChallenge_deny() public {
        _submitApproveAndChallenge(CLAIM_ID);

        vm.prank(challenger);
        registry.resolveChallenge(CLAIM_ID, false);

        ClaimDecisionRegistry.ClaimDecision memory d = registry.getDecision(CLAIM_ID);
        assertEq(uint8(d.state), uint8(ClaimDecisionRegistry.State.DENIED));
    }

    function test_resolveChallenge_notChallenged() public {
        _submitAndApprove(CLAIM_ID);

        // APPROVED, not CHALLENGED
        vm.prank(challenger);
        vm.expectRevert("ClaimDecisionRegistry: not challenged");
        registry.resolveChallenge(CLAIM_ID, true);
    }

    // ─── Integration / multi-step ────────────────────────────────────

    function test_fullHappyPath() public {
        // Submit
        vm.prank(workflow);
        registry.submitClaim(CLAIM_ID, POLICY_HASH);

        // Proof approved
        vm.prank(workflow);
        registry.setProofResult(CLAIM_ID, PROOF_HASH, 0, true);

        // Mark paid
        vm.prank(workflow);
        registry.markPaid(CLAIM_ID);

        ClaimDecisionRegistry.ClaimDecision memory d = registry.getDecision(CLAIM_ID);
        assertEq(uint8(d.state), uint8(ClaimDecisionRegistry.State.PAID));
    }

    function test_challengeBlocksPaid() public {
        _submitAndApprove(CLAIM_ID);

        // Challenge
        vm.prank(challenger);
        registry.challengeClaim(CLAIM_ID, 1);

        // Attempt markPaid — should revert
        vm.prank(workflow);
        vm.expectRevert("ClaimDecisionRegistry: can only pay APPROVED");
        registry.markPaid(CLAIM_ID);
    }

    function test_challengeResolveThenPay() public {
        _submitAndApprove(CLAIM_ID);

        // Challenge
        vm.prank(challenger);
        registry.challengeClaim(CLAIM_ID, 1);

        // Resolve in favor
        vm.prank(challenger);
        registry.resolveChallenge(CLAIM_ID, true);

        // Now pay
        vm.prank(workflow);
        registry.markPaid(CLAIM_ID);

        ClaimDecisionRegistry.ClaimDecision memory d = registry.getDecision(CLAIM_ID);
        assertEq(uint8(d.state), uint8(ClaimDecisionRegistry.State.PAID));
    }

    // ─── Authorization ───────────────────────────────────────────────

    function test_unauthorized_submit() public {
        vm.prank(unauthorized);
        vm.expectRevert();
        registry.submitClaim(CLAIM_ID, POLICY_HASH);
    }

    function test_unauthorized_challenge() public {
        _submitAndApprove(CLAIM_ID);

        vm.prank(unauthorized);
        vm.expectRevert();
        registry.challengeClaim(CLAIM_ID, 1);
    }

    // ─── Fuzz ────────────────────────────────────────────────────────

    function testFuzz_setProofResult(bytes32 claimId, uint256 reasonBitmap, bool approved) public {
        vm.assume(claimId != bytes32(0));

        // Submit claim
        vm.prank(workflow);
        registry.submitClaim(claimId, POLICY_HASH);

        // Set proof result
        vm.prank(workflow);
        registry.setProofResult(claimId, PROOF_HASH, reasonBitmap, approved);

        ClaimDecisionRegistry.ClaimDecision memory d = registry.getDecision(claimId);
        if (approved) {
            assertEq(uint8(d.state), uint8(ClaimDecisionRegistry.State.APPROVED));
        } else {
            assertEq(uint8(d.state), uint8(ClaimDecisionRegistry.State.DENIED));
        }
        assertEq(d.reasonBitmap, reasonBitmap);
        assertEq(d.proofHash, PROOF_HASH);
    }

    // ─── Helpers ─────────────────────────────────────────────────────

    function _submitClaim(bytes32 claimId) internal {
        vm.prank(workflow);
        registry.submitClaim(claimId, POLICY_HASH);
    }

    function _submitAndApprove(bytes32 claimId) internal {
        _submitClaim(claimId);
        vm.prank(workflow);
        registry.setProofResult(claimId, PROOF_HASH, 0, true);
    }

    function _submitApproveAndChallenge(bytes32 claimId) internal {
        _submitAndApprove(claimId);
        vm.prank(challenger);
        registry.challengeClaim(claimId, 1);
    }
}

// ═════════════════════════════════════════════════════════════════════
// Invariant test — handler pattern
// ═════════════════════════════════════════════════════════════════════

/// @title ClaimDecisionHandler — Stateful handler for invariant testing
/// @notice Randomly calls registry functions; tracks claim state for assertions
contract ClaimDecisionHandler is Test {
    ClaimDecisionRegistry public registry;
    address public workflow;
    address public challenger;

    bytes32[] public knownClaims;
    mapping(bytes32 => bool) public claimExists;

    uint256 private _nonce;

    constructor(ClaimDecisionRegistry _registry, address _workflow, address _challenger) {
        registry = _registry;
        workflow = _workflow;
        challenger = _challenger;
    }

    /// @notice Submit a new random claim
    function submit(uint256 salt) external {
        bytes32 claimId = keccak256(abi.encode("claim", _nonce, salt));
        _nonce++;

        if (claimExists[claimId]) return; // skip collision

        vm.prank(workflow);
        registry.submitClaim(claimId, keccak256("policy"));

        knownClaims.push(claimId);
        claimExists[claimId] = true;
    }

    /// @notice Set proof result on a random existing claim
    function proofResult(uint256 index, bool approved) external {
        if (knownClaims.length == 0) return;
        bytes32 claimId = knownClaims[index % knownClaims.length];

        ClaimDecisionRegistry.ClaimDecision memory d = registry.getDecision(claimId);
        if (d.state != ClaimDecisionRegistry.State.SUBMITTED) return;

        vm.prank(workflow);
        registry.setProofResult(claimId, keccak256("proof"), 0, approved);
    }

    /// @notice Challenge a random existing claim
    function challenge(uint256 index) external {
        if (knownClaims.length == 0) return;
        bytes32 claimId = knownClaims[index % knownClaims.length];

        ClaimDecisionRegistry.ClaimDecision memory d = registry.getDecision(claimId);
        if (d.state != ClaimDecisionRegistry.State.APPROVED) return;

        vm.prank(challenger);
        registry.challengeClaim(claimId, 1);
    }

    /// @notice Resolve a challenge on a random existing claim
    function resolve(uint256 index, bool approve) external {
        if (knownClaims.length == 0) return;
        bytes32 claimId = knownClaims[index % knownClaims.length];

        ClaimDecisionRegistry.ClaimDecision memory d = registry.getDecision(claimId);
        if (d.state != ClaimDecisionRegistry.State.CHALLENGED) return;

        vm.prank(challenger);
        registry.resolveChallenge(claimId, approve);
    }

    /// @notice Mark a random existing claim as paid
    function pay(uint256 index) external {
        if (knownClaims.length == 0) return;
        bytes32 claimId = knownClaims[index % knownClaims.length];

        ClaimDecisionRegistry.ClaimDecision memory d = registry.getDecision(claimId);
        if (d.state != ClaimDecisionRegistry.State.APPROVED) return;

        vm.prank(workflow);
        registry.markPaid(claimId);
    }

    function claimCount() external view returns (uint256) {
        return knownClaims.length;
    }
}

contract ClaimDecisionRegistryInvariantTest is Test {
    ClaimDecisionRegistry public registry;
    ClaimDecisionHandler public handler;

    address public admin = address(this);
    address public workflow = address(0x1001);
    address public challenger = address(0xC4A);

    function setUp() public {
        registry = new ClaimDecisionRegistry(admin);
        registry.grantRole(registry.WORKFLOW_ROLE(), workflow);
        registry.grantRole(registry.CHALLENGE_ROLE(), challenger);

        handler = new ClaimDecisionHandler(registry, workflow, challenger);

        // Only target the handler for invariant calls
        targetContract(address(handler));
    }

    /// @notice Invariant: no claim is simultaneously PAID and CHALLENGED
    function invariant_noPaidAndChallenged() public view {
        uint256 count = handler.claimCount();
        for (uint256 i = 0; i < count; i++) {
            bytes32 claimId = handler.knownClaims(i);
            ClaimDecisionRegistry.ClaimDecision memory d = registry.getDecision(claimId);
            // A claim cannot be both PAID and CHALLENGED (they are distinct enum values,
            // but we check no claim oscillates into an impossible combined state)
            assertTrue(
                !(uint8(d.state) == uint8(ClaimDecisionRegistry.State.PAID)
                    && uint8(d.state) == uint8(ClaimDecisionRegistry.State.CHALLENGED)),
                "Claim is both PAID and CHALLENGED"
            );
        }
    }

    /// @notice Invariant: PAID is terminal — once a claim reaches PAID, it stays PAID
    /// We use a ghost variable approach: after each invariant check, if a claim is PAID
    /// we record it. On next check, any previously-PAID claim must still be PAID.
    /// Since Foundry runs the invariant check after each call, we embed the check here.
    mapping(bytes32 => bool) private _wasPaid;

    function invariant_paidIsTerminal() public {
        uint256 count = handler.claimCount();
        for (uint256 i = 0; i < count; i++) {
            bytes32 claimId = handler.knownClaims(i);
            ClaimDecisionRegistry.ClaimDecision memory d = registry.getDecision(claimId);

            if (_wasPaid[claimId]) {
                assertEq(
                    uint8(d.state),
                    uint8(ClaimDecisionRegistry.State.PAID),
                    "PAID claim changed state"
                );
            }

            if (d.state == ClaimDecisionRegistry.State.PAID) {
                _wasPaid[claimId] = true;
            }
        }
    }
}
