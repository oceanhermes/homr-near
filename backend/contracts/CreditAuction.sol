// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "./LoanManager.sol";
import "./HousingCreditVault.sol";

/**
 * @title CreditAuction
 * @dev Commit-reveal auction for capital allocation.
 */
contract CreditAuction is AccessControl {
    bytes32 public constant CREDIT_MANAGER_ROLE =
        keccak256("CREDIT_MANAGER_ROLE");
    bytes32 public constant AUCTION_MANAGER_ROLE =
        keccak256("AUCTION_MANAGER_ROLE");

    LoanManager public loanManager;
    HousingCreditVault public vault;

    enum AuctionState {
        Created,
        CommitPhase,
        RevealPhase,
        Finalized
    }
    AuctionState public state;

    uint256 public commitDeadline;
    uint256 public revealDeadline;

    struct BorrowerApproval {
        bool isApproved;
        uint256 maxPrincipal;
        string propertyHash;
    }

    mapping(address => BorrowerApproval) public approvals;
    mapping(address => bytes32) public commitments;
    address[] public committedBorrowers;

    struct RevealedBid {
        address borrower;
        uint256 amount;
        uint256 rate;
        uint256 term;
        bool isValid;
    }

    mapping(address => RevealedBid) public revealedBids;
    address[] public revealedBorrowers;

    event BorrowerApproved(
        address indexed borrower,
        uint256 maxPrincipal,
        string propertyHash
    );
    event AuctionStarted(uint256 commitDeadline, uint256 revealDeadline);
    event BidCommitted(address indexed borrower, bytes32 commitment);
    event BidRevealed(
        address indexed borrower,
        uint256 amount,
        uint256 rate,
        uint256 term
    );
    event AuctionFinalized();

    constructor(LoanManager _loanManager, HousingCreditVault _vault) {
        loanManager = _loanManager;
        vault = _vault;
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    function approveBorrower(
        address borrower,
        uint256 maxPrincipal,
        string memory propertyHash
    ) external onlyRole(CREDIT_MANAGER_ROLE) {
        approvals[borrower] = BorrowerApproval(
            true,
            maxPrincipal,
            propertyHash
        );
        emit BorrowerApproved(borrower, maxPrincipal, propertyHash);
    }

    function startAuction(
        uint256 _commitDuration,
        uint256 _revealDuration
    ) external onlyRole(AUCTION_MANAGER_ROLE) {
        require(_commitDuration > 0 && _revealDuration > 0, "Durations must be > 0");
        require(
            state == AuctionState.Created || state == AuctionState.Finalized,
            "Auction in progress"
        );

        commitDeadline = block.timestamp + _commitDuration;
        revealDeadline = commitDeadline + _revealDuration;
        state = AuctionState.CommitPhase;

        // Reset state for the next demo auction. Production needs per-auction storage.
        for (uint256 i = 0; i < committedBorrowers.length; i++) {
            delete commitments[committedBorrowers[i]];
        }
        delete committedBorrowers;
        for (uint256 i = 0; i < revealedBorrowers.length; i++) {
            delete revealedBids[revealedBorrowers[i]];
        }
        delete revealedBorrowers;

        emit AuctionStarted(commitDeadline, revealDeadline);
    }

    function commitBid(bytes32 commitment) external {
        require(state == AuctionState.CommitPhase, "Not commit phase");
        require(block.timestamp <= commitDeadline, "Commit phase ended");
        require(approvals[msg.sender].isApproved, "Borrower not approved");
        require(commitments[msg.sender] == bytes32(0), "Bid already committed");
        require(commitment != bytes32(0), "Commitment required");

        commitments[msg.sender] = commitment;
        committedBorrowers.push(msg.sender);
        emit BidCommitted(msg.sender, commitment);
    }

    function revealBid(
        uint256 amount,
        uint256 rate,
        uint256 term,
        string memory salt
    ) external {
        require(
            state == AuctionState.CommitPhase ||
                state == AuctionState.RevealPhase,
            "Not reveal phase"
        );
        if (
            state == AuctionState.CommitPhase &&
            block.timestamp > commitDeadline
        ) {
            state = AuctionState.RevealPhase; // Lazy transition
        }
        require(
            state == AuctionState.RevealPhase ||
                block.timestamp > commitDeadline,
            "Wait for reveal phase"
        );
        require(block.timestamp <= revealDeadline, "Reveal phase ended");

        bytes32 commitment = commitments[msg.sender];
        require(commitment != 0, "No commit found");
        require(!revealedBids[msg.sender].isValid, "Already revealed");

        // Hash recreation: abi.encodePacked in Solidity, user must use matching format
        bytes32 recreated = keccak256(
            abi.encodePacked(amount, rate, term, msg.sender, salt)
        );
        require(recreated == commitment, "Invalid reveal");

        // === GUARD tambahan (bukan Opsi B, tapi mencegah loan kosong) ===
        require(amount > 0, "Amount must be > 0");
        require(term > 0, "Term must be > 0");

        require(
            amount <= approvals[msg.sender].maxPrincipal,
            "Amount exceeds approval"
        );

        revealedBids[msg.sender] = RevealedBid({
            borrower: msg.sender,
            amount: amount,
            rate: rate,
            term: term,
            isValid: true
        });
        revealedBorrowers.push(msg.sender);

        emit BidRevealed(msg.sender, amount, rate, term);
    }

    /**
     * @dev Simple deterministic allocation for MVP.
     * In this mock, it funds the highest rate first until capital is exhausted.
     */
    function finalizeAuction() external onlyRole(AUCTION_MANAGER_ROLE) {
        require(state != AuctionState.Created, "Auction not started");
        require(block.timestamp > revealDeadline, "Too early");
        // === GUARD tambahan: cegah finalize dua kali ===
        require(state != AuctionState.Finalized, "Already finalized");

        state = AuctionState.Finalized;

        // Very basic sorting/allocation for MVP demo
        // (Not gas efficient for production, but okay for a small array in hackathon)
        uint256 n = revealedBorrowers.length;
        if (n > 0) {
            // Find highest rate manually for single winner demo
            uint256 bestIndex = 0;
            uint256 highestRate = 0;
            for (uint256 i = 0; i < n; i++) {
                RevealedBid memory bid = revealedBids[revealedBorrowers[i]];
                if (bid.rate > highestRate) {
                    highestRate = bid.rate;
                    bestIndex = i;
                }
            }

            RevealedBid memory bestBid = revealedBids[
                revealedBorrowers[bestIndex]
            ];

            // === OPSI B: risk guards ===
            require(
                bestBid.amount <= approvals[bestBid.borrower].maxPrincipal,
                "Bid exceeds approved principal"
            );
            require(
                bestBid.amount <= vault.availableCapital(),
                "Insufficient vault capital"
            );

            // Allocate loan if there's available capital
            // Calling LoanManager
            loanManager.createLoan(
                bestBid.borrower,
                bestBid.amount,
                bestBid.rate,
                bestBid.term,
                approvals[bestBid.borrower].propertyHash
            );
        }

        emit AuctionFinalized();
    }
}
