import { expect } from 'chai';
import hardhat from 'hardhat';
const { ethers } = hardhat;

describe('HOMR contract lifecycle guards', function () {
  let token, vault, manager, auction, owner;
  beforeEach(async function () {
    [owner] = await ethers.getSigners();
    token = await (await ethers.getContractFactory('MockUSDC')).deploy();
    vault = await (await ethers.getContractFactory('HousingCreditVault')).deploy(token.target);
    manager = await (await ethers.getContractFactory('LoanManager')).deploy(vault.target, token.target);
    auction = await (await ethers.getContractFactory('CreditAuction')).deploy(manager.target, vault.target);
    await auction.grantRole(await auction.AUCTION_MANAGER_ROLE(), owner.address);
    await manager.grantRole(await manager.AUCTION_MANAGER_ROLE(), owner.address);
    await vault.grantRole(await vault.LOAN_MANAGER_ROLE(), manager.target);
  });

  it('cannot finalize an auction that has never started', async function () {
    await expect(auction.finalizeAuction()).to.be.revertedWith('Auction not started');
    expect(await auction.state()).to.equal(0);
  });

  it('requires usable commit and reveal windows', async function () {
    await expect(auction.startAuction(0, 60)).to.be.revertedWith('Durations must be > 0');
    await expect(auction.startAuction(60, 0)).to.be.revertedWith('Durations must be > 0');
  });

  it('rejects a loan manager wired to a different asset', async function () {
    const other = await (await ethers.getContractFactory('MockUSDC')).deploy();
    await expect((await ethers.getContractFactory('LoanManager')).deploy(vault.target, other.target))
      .to.be.revertedWith('Asset does not match vault');
  });

  it('rejects empty loans even from an authorized manager', async function () {
    await expect(manager.createLoan(owner.address, 0, 100, 3600, 'property'))
      .to.be.revertedWith('Principal must be > 0');
    expect(await manager.nextLoanId()).to.equal(0);
  });

  it('rolls back failed repayment and clears only principal when extra tokens are paid', async function () {
    const principal = ethers.parseEther('100');
    const repayment = ethers.parseEther('110');
    await token.mint(owner.address, repayment);
    await token.approve(vault.target, principal);
    await vault.deposit(principal);
    await manager.createLoan(owner.address, principal, 100, 3600, 'property');
    await expect(manager.repayLoan(0, repayment)).to.be.reverted;
    expect((await manager.loans(0)).isActive).to.equal(true);
    expect(await vault.totalDeployedCapital()).to.equal(principal);
    await token.approve(manager.target, repayment);
    await manager.repayLoan(0, repayment);
    expect((await manager.loans(0)).isActive).to.equal(false);
    expect(await vault.totalDeployedCapital()).to.equal(0);
    expect(await vault.availableCapital()).to.equal(repayment);
    await expect(manager.repayLoan(0, repayment)).to.be.revertedWith('Loan not active');
  });
});
