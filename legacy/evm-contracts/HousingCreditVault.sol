// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * @title HousingCreditVault
 * @dev Accepts stablecoin deposits, mints vault shares, tracks deployed capital.
 */
contract HousingCreditVault is ERC20, AccessControl {
    using SafeERC20 for IERC20;

    bytes32 public constant CREDIT_MANAGER_ROLE = keccak256("CREDIT_MANAGER_ROLE");
    bytes32 public constant AUCTION_MANAGER_ROLE = keccak256("AUCTION_MANAGER_ROLE");
    bytes32 public constant LOAN_MANAGER_ROLE = keccak256("LOAN_MANAGER_ROLE");

    IERC20 public asset;
    
    uint256 public totalDeployedCapital;

    event Deposit(address indexed investor, uint256 assets, uint256 shares);
    event Withdraw(address indexed investor, uint256 assets, uint256 shares);
    event CapitalDeployed(uint256 amount);
    event RepaymentReceived(uint256 amount);

    constructor(IERC20 _asset) ERC20("Housing Credit Vault Share", "hvSHARE") {
        asset = _asset;
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    /**
     * @dev Simple deposit: 1 asset = 1 share for simplicity in MVP.
     * In a real vault, this would use ERC4626 logic for share pricing.
     */
    function deposit(uint256 assets) external {
        require(assets > 0, "Amount must be > 0");
        
        // Transfer assets from investor to vault
        asset.safeTransferFrom(msg.sender, address(this), assets);
        
        // Mint shares 1:1
        _mint(msg.sender, assets);
        
        emit Deposit(msg.sender, assets, assets);
    }

    /**
     * @dev Withdraw requested amount
     */
    function withdraw(uint256 shares) external {
        require(shares > 0, "Shares must be > 0");
        require(balanceOf(msg.sender) >= shares, "Insufficient shares");
        require(availableCapital() >= shares, "Insufficient vault liquidity");
        
        _burn(msg.sender, shares);
        asset.safeTransfer(msg.sender, shares);
        
        emit Withdraw(msg.sender, shares, shares);
    }

    function availableCapital() public view returns (uint256) {
        return asset.balanceOf(address(this));
    }

    function deployCapital(address to, uint256 amount) external onlyRole(LOAN_MANAGER_ROLE) {
        require(availableCapital() >= amount, "Insufficient vault liquidity");
        totalDeployedCapital += amount;
        asset.safeTransfer(to, amount);
        emit CapitalDeployed(amount);
    }

    function receiveRepayment(uint256 amount) external onlyRole(LOAN_MANAGER_ROLE) {
        totalDeployedCapital -= amount; // Assuming principal repayment for simplicity
        emit RepaymentReceived(amount);
    }
}
