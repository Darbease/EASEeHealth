# Contract Sources

Solidity contracts (Foundry, Solidity 0.8.24, OpenZeppelin AccessControl):
- `MockUSDC.sol` — ERC-20 mock USDC token (6 decimals) for settlement
- `ConsentRegistry.sol` — Consent lifecycle (ACTIVE/REVOKED/EXPIRED)
- `PolicyRegistry.sol` — Policy version hashes and activation windows
- `ClaimDecisionRegistry.sol` — Claim state machine (SUBMITTED → APPROVED/DENIED → PAID)
- `ClaimEscrow.sol` — ERC-20 payout pool (schedule/release/cancel)
