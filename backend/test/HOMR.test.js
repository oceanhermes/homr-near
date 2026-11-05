import { expect } from "chai";
import hardhat from "hardhat";
const { ethers } = hardhat;

describe("HOMR Backend - Smart Contracts", function () {
  let mockUSDC, vault, loanManager, auction;
  let admin, creditManager, auctionManager, investor, borrower;
  const initialDeposit = ethers.parseUnits("100000", 6); // 100k USDC

  before(async function () {
    [admin, creditManager, auctionManager, investor, borrower] = await ethers.getSigners();

    // 1. Deploy MockUSDC
    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    mockUSDC = await MockUSDC.deploy();

    // 2. Deploy Vault
    const Vault = await ethers.getContractFactory("HousingCreditVault");
    vault = await Vault.deploy(await mockUSDC.getAddress());

    // 3. Deploy LoanManager
    const LoanManager = await ethers.getContractFactory("LoanManager");
    loanManager = await LoanManager.deploy(await vault.getAddress(), await mockUSDC.getAddress());

    // 4. Deploy Auction
    const CreditAuction = await ethers.getContractFactory("CreditAuction");
    auction = await CreditAuction.deploy(
      await loanManager.getAddress(),
      await vault.getAddress()
    );

    // Setup Roles
    await vault.grantRole(await vault.LOAN_MANAGER_ROLE(), await loanManager.getAddress());
    await loanManager.grantRole(await loanManager.AUCTION_MANAGER_ROLE(), await auction.getAddress());
    await auction.grantRole(await auction.CREDIT_MANAGER_ROLE(), creditManager.address);
    await auction.grantRole(await auction.AUCTION_MANAGER_ROLE(), auctionManager.address);

    // Setup Funds
    await mockUSDC.mint(investor.address, initialDeposit);
    await mockUSDC.connect(investor).approve(await vault.getAddress(), initialDeposit);
  });

  describe("Vault Deposits (FR-01)", function () {
    it("Should allow investor to deposit and receive shares", async function () {
      await vault.connect(investor).deposit(initialDeposit);
      expect(await vault.balanceOf(investor.address)).to.equal(initialDeposit);
      expect(await vault.availableCapital()).to.equal(initialDeposit);
    });
  });

  describe("Borrower Approval (FR-03)", function () {
    it("Should approve a borrower", async function () {
      const maxPrincipal = ethers.parseUnits("50000", 6);
      await auction.connect(creditManager).approveBorrower(borrower.address, maxPrincipal, "hash123");
      const approval = await auction.approvals(borrower.address);
      expect(approval.isApproved).to.be.true;
      expect(approval.maxPrincipal).to.equal(maxPrincipal);
    });
  });

  describe("Commit-Reveal Auction (FR-04, FR-05, FR-06)", function () {
    let amount, rate, term, salt;
    before(async function () {
      amount = ethers.parseUnits("50000", 6);
      rate = 10; // 10%
      term = 12; // 12 months
      salt = "demo_salt";
    });

    it("Should start auction", async function () {
      await auction.connect(auctionManager).startAuction(3600, 3600); // 1 hour commit, 1 hour reveal
      expect(await auction.state()).to.equal(1); // CommitPhase
    });

    it("Should commit bid", async function () {
      // Keccak256 encoding matching Solidity abi.encodePacked
      const commitment = ethers.solidityPackedKeccak256(
        ["uint256", "uint256", "uint256", "address", "string"],
        [amount, rate, term, borrower.address, salt]
      );
      await auction.connect(borrower).commitBid(commitment);
      expect(await auction.commitments(borrower.address)).to.equal(commitment);
    });

    it("Should reject a second commitment from the same borrower", async function () {
      await expect(auction.connect(borrower).commitBid(ethers.id("second bid")))
        .to.be.revertedWith("Bid already committed");
    });

    it("Should reveal bid by advancing time", async function () {
      // Advance time to reveal phase
      await ethers.provider.send("evm_increaseTime", [3601]);
      await ethers.provider.send("evm_mine");

      await auction.connect(borrower).revealBid(amount, rate, term, salt);
      const revealed = await auction.revealedBids(borrower.address);
      expect(revealed.isValid).to.be.true;
    });

    it("Should reject finalization during the reveal window", async function () {
      const freshAuction = auction;
      await expect(freshAuction.connect(auctionManager).finalizeAuction())
        .to.be.revertedWith("Too early");
    });

    it("Should finalize auction and create loan", async function () {
      // Advance time past reveal
      await ethers.provider.send("evm_increaseTime", [3601]);
      await ethers.provider.send("evm_mine");

      await expect(auction.connect(auctionManager).finalizeAuction())
        .to.emit(loanManager, "LoanCreated")
        .withArgs(0, borrower.address, amount, rate);

      const loan = await loanManager.loans(0);
      expect(loan.borrower).to.equal(borrower.address);
      expect(loan.principal).to.equal(amount);
      expect(await mockUSDC.balanceOf(borrower.address)).to.equal(amount);
    });
  });

  describe("Repayment (FR-07)", function () {
    it("Should reject repayment below the outstanding principal", async function () {
      const loanAmount = ethers.parseUnits("49999", 6);
      await mockUSDC.connect(borrower).approve(await loanManager.getAddress(), loanAmount);
      await expect(loanManager.connect(borrower).repayLoan(0, loanAmount))
        .to.be.revertedWith("Repayment below principal");
    });

    it("Should allow borrower to repay loan", async function () {
      const loanAmount = ethers.parseUnits("50000", 6);
      await mockUSDC.connect(borrower).approve(await loanManager.getAddress(), loanAmount);

      await expect(loanManager.connect(borrower).repayLoan(0, loanAmount))
        .to.emit(loanManager, "LoanRepaid")
        .withArgs(0, loanAmount);

      const loan = await loanManager.loans(0);
      expect(loan.isActive).to.be.false;
      // Vault should have the money back
      expect(await mockUSDC.balanceOf(await vault.getAddress())).to.equal(ethers.parseUnits("100000", 6));
    });
  });
});
