// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title MockUSDC
 * @dev Test-only ERC-20 used for the demo. Prominently labelled as having no real value.
 */
contract MockUSDC is ERC20, Ownable {
    constructor() ERC20("Mock USDC (DEMO ONLY)", "mUSDC") Ownable(msg.sender) {}

    // Anyone can mint for demo purposes
    function mint(address to, uint256 amount) public {
        _mint(to, amount);
    }
}
