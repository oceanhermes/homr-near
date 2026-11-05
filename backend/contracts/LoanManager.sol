// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./HousingCreditVault.sol";

/**
 * @title LoanManager
 * @dev Tracks loan principal, rate, maturity, and accepts repayment.
 */
contract LoanManager is AccessControl {
    using SafeERC20 for IERC20;

    bytes32 public constant AUCTION_MANAGER_ROLE = keccak256("AUCTION_MANAGER_ROLE");

    HousingCreditVault public vault;
    IERC20 public asset;

    struct Loan {
        address borrower;
        uint256 principal;
        uint256 rate;
        uint256 term;
        string propertyHash;
        bool isActive;
    }

    mapping(uint256 => Loan) public loans;
    uint256 public nextLoanId;

    event LoanCreated(uint256 indexed loanId, address indexed borrower, uint256 principal, uint256 rate);
    event LoanRepaid(uint256 indexed loanId, uint256 amount);

    constructor(HousingCreditVault _vault, IERC20 _asset) {
        require(address(_vault.asset()) == address(_asset), "Asset does not match vault");
        vault = _vault;
        asset = _asset;
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    /**
     * @dev Creates a loan and transfers funds to borrower. Only callable by CreditAuction.
     */
    function createLoan(
        address borrower,
        uint256 principal,
        uint256 rate,
        uint256 term,
        string memory propertyHash
    ) external onlyRole(AUCTION_MANAGER_ROLE) returns (uint256) {
        require(borrower != address(0), "Borrower required");
        require(principal > 0, "Principal must be > 0");
        require(term > 0, "Term must be > 0");
        uint256 loanId = nextLoanId++;
        
        loans[loanId] = Loan({
            borrower: borrower,
            principal: principal,
            rate: rate,
            term: term,
            propertyHash: propertyHash,
            isActive: true
        });

        // Request vault to deploy capital to borrower
        vault.deployCapital(borrower, principal);

        emit LoanCreated(loanId, borrower, principal, rate);
        return loanId;
    }

    /**
     * @dev Repay loan (demo simplifies interest calculation)
     */
    function repayLoan(uint256 loanId, uint256 amount) external {
        Loan storage loan = loans[loanId];
        require(loan.isActive, "Loan not active");
        require(msg.sender == loan.borrower, "Not the borrower");
        require(amount >= loan.principal, "Repayment below principal");
        loan.isActive = false;

        // Transfer repayment from borrower to Vault
        asset.safeTransferFrom(msg.sender, address(vault), amount);
        
        // Update vault accounting
        vault.receiveRepayment(loan.principal);
        

        emit LoanRepaid(loanId, amount);
    }
}
