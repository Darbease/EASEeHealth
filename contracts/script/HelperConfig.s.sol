// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";

/// @title HelperConfig — Network-aware configuration for deploy scripts
/// @notice Returns deployer key, role addresses, and chain-specific settings.
///         Anvil (31337): deterministic Anvil accounts, no verification.
///         Sepolia (11155111): reads DEPLOYER_PRIVATE_KEY + optional role addresses from env.
///         Tenderly Virtual TestNet: same as Sepolia (fork uses different chain ID).
contract HelperConfig is Script {
    struct NetworkConfig {
        uint256 deployerKey;
        address deployer;
        address creSigner;
        address opsAddress;
        address treasuryAddress;
    }

    NetworkConfig public activeConfig;

    // Anvil deterministic private keys (publicly known — never use on real networks)
    uint256 constant ANVIL_DEPLOYER_KEY = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
    uint256 constant ANVIL_CRE_SIGNER_KEY = 0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d;

    constructor() {
        if (block.chainid == 31337) {
            activeConfig = getAnvilConfig();
        } else {
            // Sepolia (11155111), Tenderly fork, or any other testnet
            activeConfig = getLiveNetworkConfig();
        }
    }

    /// @notice Anvil local chain — deterministic accounts, no env vars needed
    function getAnvilConfig() internal pure returns (NetworkConfig memory) {
        return NetworkConfig({
            deployerKey: ANVIL_DEPLOYER_KEY,
            deployer: 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266,     // Account 0
            creSigner: 0x70997970C51812dc3A010C7d01b50e0d17dc79C8,    // Account 1
            opsAddress: 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC,   // Account 2
            treasuryAddress: 0x90F79bf6EB2c4f870365E785982E1f101E93b906 // Account 3
        });
    }

    /// @notice Any live network (Sepolia, Tenderly fork, etc.) — reads keys from env
    function getLiveNetworkConfig() internal view returns (NetworkConfig memory) {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        // CRE signer: separate key if provided, otherwise deployer doubles as signer
        address creSigner;
        try vm.envAddress("CRE_SIGNER_ADDRESS") returns (address addr) {
            creSigner = addr;
        } catch {
            creSigner = deployer;
        }

        // Ops: separate address if provided, otherwise deployer
        address opsAddress;
        try vm.envAddress("OPS_ADDRESS") returns (address addr) {
            opsAddress = addr;
        } catch {
            opsAddress = deployer;
        }

        // Treasury: separate address if provided, otherwise deployer
        address treasuryAddress;
        try vm.envAddress("TREASURY_ADDRESS") returns (address addr) {
            treasuryAddress = addr;
        } catch {
            treasuryAddress = deployer;
        }

        return NetworkConfig({
            deployerKey: deployerKey,
            deployer: deployer,
            creSigner: creSigner,
            opsAddress: opsAddress,
            treasuryAddress: treasuryAddress
        });
    }
}
