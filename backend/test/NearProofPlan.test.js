import { expect } from 'chai';
import assert from 'node:assert/strict';
import { Interface } from 'ethers';
import { prepareNearProofs } from '../scripts/near-proof-plan.js';

const auctionAddress = '0x1111111111111111111111111111111111111111';
const loanManagerAddress = '0x2222222222222222222222222222222222222222';
const borrower = '0x3333333333333333333333333333333333333333';
const hash = `0x${'ab'.repeat(32)}`;
const auctionEvents = new Interface(['event AuctionFinalized()']);
const loanEvents = new Interface([
  'event LoanCreated(uint256 indexed loanId, address indexed borrower, uint256 principal, uint256 rate)',
  'event LoanRepaid(uint256 indexed loanId, uint256 amount)',
]);

function log(iface, event, args, address, index) {
  const encoded = iface.encodeEventLog(iface.getEvent(event), args);
  return { ...encoded, address, index, transactionHash: hash };
}

const options = { chainId: 97, auctionAddress, loanManagerAddress };

describe('NEAR proof preparation from EVM receipts', () => {
  it('prepares stable auction and loan IDs from a successful finalized transaction', async () => {
    const receipt = {
      hash, status: 1, blockNumber: 12,
      logs: [
        log(loanEvents, 'LoanCreated', [7n, borrower, 50_000_000n, 800n], loanManagerAddress, 2),
        log(auctionEvents, 'AuctionFinalized', [], auctionAddress, 3),
      ],
    };
    const plan = await prepareNearProofs(receipt, options);
    expect(plan.actions.map((action) => action.method)).to.deep.equal(['register_auction', 'register_loan']);
    expect(plan.actions[0].args.total_capital).to.equal('50000000');
    expect(plan.actions[0].args.auction_id).to.equal(`eip155:97:${auctionAddress}:${hash}`);
    expect(plan.actions[1].args.loan_id).to.equal(`eip155:97:${loanManagerAddress}:7`);
    expect(plan.actions[1].args.borrower_hash).to.match(/^0x[0-9a-f]{64}$/);
  });

  it('anchors only repaid principal when the EVM repayment includes extra tokens', async () => {
    const receipt = {
      hash, status: 1, blockNumber: 15,
      logs: [log(loanEvents, 'LoanRepaid', [7n, 55_000_000n], loanManagerAddress, 1)],
    };
    const plan = await prepareNearProofs(receipt, {
      ...options,
      getLoanPrincipal: async () => 50_000_000n,
    });
    expect(plan.actions[0].args.amount).to.equal('50000000');
    expect(plan.actions[0].evidence.evm_amount).to.equal('55000000');
  });

  it('rejects failed or unrelated receipts', async () => {
    const unrelated = {
      hash, status: 1, blockNumber: 17,
      logs: [log(loanEvents, 'LoanCreated', [7n, borrower, 50n, 800n], borrower, 1)],
    };
    await assert.rejects(prepareNearProofs({ ...unrelated, status: 0 }, options), /did not succeed/);
    await assert.rejects(prepareNearProofs(unrelated, options), /No supported HOMR events/);
  });

  it('rejects EVM amounts that cannot fit in the NEAR registry', async () => {
    const tooLarge = 1n << 128n;
    const receipt = {
      hash, status: 1, blockNumber: 19,
      logs: [log(loanEvents, 'LoanCreated', [8n, borrower, tooLarge, 800n], loanManagerAddress, 1)],
    };
    await assert.rejects(prepareNearProofs(receipt, options), /exceeds NEAR u128 range/);
  });
});
