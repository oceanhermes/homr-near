import { Interface, getAddress, solidityPackedKeccak256 } from 'ethers';

const auctionEvents = new Interface(['event AuctionFinalized()']);
const loanEvents = new Interface([
  'event LoanCreated(uint256 indexed loanId, address indexed borrower, uint256 principal, uint256 rate)',
  'event LoanRepaid(uint256 indexed loanId, uint256 amount)',
]);
const MAX_U128 = (1n << 128n) - 1n;

function rawAmount(value, label) {
  const amount = BigInt(value);
  if (amount < 0n || amount > MAX_U128) throw new Error(`${label} exceeds NEAR u128 range`);
  return amount.toString();
}

function eventAt(log, address, iface) {
  if (log.address.toLowerCase() !== address.toLowerCase()) return null;
  try {
    return iface.parseLog(log);
  } catch {
    return null;
  }
}

export async function prepareNearProofs(receipt, options) {
  const { chainId, auctionAddress, loanManagerAddress, getLoanPrincipal } = options;
  if (!Number.isSafeInteger(chainId) || chainId <= 0) throw new Error('Expected a positive EVM chain ID');
  const auction = getAddress(auctionAddress);
  const loanManager = getAddress(loanManagerAddress);
  const txHash = receipt?.hash || receipt?.transactionHash;
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash || '')) throw new Error('Invalid transaction hash');
  if (receipt.status !== 1) throw new Error('EVM transaction did not succeed');
  if (!Array.isArray(receipt.logs)) throw new Error('Transaction receipt has no logs');

  const finalized = [];
  const created = [];
  const repaid = [];
  for (const log of receipt.logs) {
    if (log.transactionHash && log.transactionHash.toLowerCase() !== txHash.toLowerCase()) {
      throw new Error('Receipt contains a log from another transaction');
    }
    const auctionEvent = eventAt(log, auction, auctionEvents);
    if (auctionEvent?.name === 'AuctionFinalized') finalized.push(log);
    const loanEvent = eventAt(log, loanManager, loanEvents);
    if (loanEvent?.name === 'LoanCreated') created.push({ log, args: loanEvent.args });
    if (loanEvent?.name === 'LoanRepaid') repaid.push({ log, args: loanEvent.args });
  }
  if (!finalized.length && !created.length && !repaid.length) {
    throw new Error('No supported HOMR events from the configured contracts in this receipt');
  }

  const sourceChain = `eip155:${chainId}`;
  const loanPrefix = `${sourceChain}:${loanManager.toLowerCase()}`;
  const actions = [];
  for (const log of finalized) {
    const capital = created.reduce((sum, item) => sum + item.args.principal, 0n);
    actions.push({
      method: 'register_auction',
      args: {
        auction_id: `${sourceChain}:${auction.toLowerCase()}:${txHash.toLowerCase()}`,
        source_chain: sourceChain,
        proof_hash: txHash,
        total_capital: rawAmount(capital, 'Auction capital'),
      },
      evidence: { event: 'AuctionFinalized', log_index: log.index },
    });
  }
  for (const { log, args } of created) {
    actions.push({
      method: 'register_loan',
      args: {
        loan_id: `${loanPrefix}:${args.loanId}`,
        borrower_hash: solidityPackedKeccak256(['address'], [args.borrower]),
        proof_hash: txHash,
        principal: rawAmount(args.principal, 'Loan principal'),
      },
      evidence: { event: 'LoanCreated', log_index: log.index },
    });
  }
  for (const { log, args } of repaid) {
    if (typeof getLoanPrincipal !== 'function') throw new Error('Loan principal lookup is required for repayments');
    const principal = BigInt(await getLoanPrincipal(args.loanId));
    if (principal <= 0n || args.amount < principal) throw new Error(`Invalid principal for loan ${args.loanId}`);
    actions.push({
      method: 'record_repayment',
      args: {
        loan_id: `${loanPrefix}:${args.loanId}`,
        amount: rawAmount(principal, 'Repaid principal'),
        proof_hash: txHash,
      },
      evidence: { event: 'LoanRepaid', log_index: log.index, evm_amount: args.amount.toString() },
    });
  }

  return {
    source: { chain_id: chainId, transaction_hash: txHash, block_number: receipt.blockNumber },
    actions,
  };
}
