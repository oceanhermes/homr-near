import { API_BASE } from '../api/endpoints';
import { CONTRACT_ADDRESSES } from './addresses';
import { callNearView } from '../near/rpc';
import {
  TOKEN_DECIMALS,
  SHARE_DECIMALS,
  fromRaw,
  toRaw,
  hashCommitment,
  deposit as depositAction,
  withdraw as withdrawAction,
  approveBorrower as approveBorrowerAction,
  createAuction as createAuctionAction,
  commitBid as commitBidAction,
  revealBid as revealBidAction,
  finalizeAuction as finalizeAuctionAction,
  repayLoan as repayLoanAction,
} from '../near/contracts';

/**
 * NEAR protocol layer.
 *
 * Reads go straight to the NEAR RPC (`view` calls, finality: final) and to the
 * indexer API for the event ledger. Writes go through the Wallet Selector via
 * `src/near/contracts.ts`.
 */

export const sameAddress = (a, b) => Boolean(a && b && String(a).toLowerCase() === String(b).toLowerCase());

export const amountText = (raw, decimals = TOKEN_DECIMALS) => fromRaw(raw, decimals);

export function parseAmount(value, decimals = TOKEN_DECIMALS, allowZero = false) {
  const text = String(value).trim();
  if (!/^\d+(\.\d+)?$/.test(text) || (text.split('.')[1]?.length || 0) > decimals) {
    throw new Error(`Enter a decimal amount with at most ${decimals} decimal places.`);
  }
  const raw = BigInt(toRaw(text, decimals));
  if (raw < 0n || (!allowZero && raw === 0n)) throw new Error('Amount must be greater than 0.');
  return raw;
}

/** Maps the contract's `AuctionState` enum (plus clocks) to the UI phase names. */
export function auctionPhase(state, revealDeadline, nowMs = Date.now()) {
  if (state === 'Finalized') return 'Finalized';
  if (state === 'Cancelled') return 'Cancelled';
  if (state === 'Draft' || state === 'Open') return 'Created';
  if (state === 'Commit') return 'CommitPhase';
  if (state === 'Reveal') {
    return revealDeadline && nowMs > revealDeadline ? 'AwaitingFinalization' : 'RevealPhase';
  }
  return state || 'Created';
}

const view = (contract, method, args = {}) => callNearView(method, args, contract);

async function metadata() {
  let decimals = TOKEN_DECIMALS;
  try {
    const meta = await view(CONTRACT_ADDRESSES.MockUSDC, 'ft_metadata');
    if (meta && Number.isInteger(meta.decimals)) decimals = meta.decimals;
  } catch {
    // The mock token has no ft_metadata view: mUSDC is 6 decimals by design.
  }
  return { decimals, shareDecimals: SHARE_DECIMALS };
}

/** Contract storage does not accrue interest on-chain: NAV is principal-backed. */
const sharePriceFromNav = (navRaw) => fromRaw(String(navRaw ?? '1000000'), SHARE_DECIMALS);

async function vault(account) {
  const meta = await metadata();
  const [totalAssets, available, outstanding, totalShares, userShares, nav] = await Promise.all([
    view(CONTRACT_ADDRESSES.HousingCreditVault, 'total_assets'),
    view(CONTRACT_ADDRESSES.HousingCreditVault, 'get_available_underlying'),
    view(CONTRACT_ADDRESSES.HousingCreditVault, 'get_total_outstanding_principal'),
    view(CONTRACT_ADDRESSES.HousingCreditVault, 'ft_total_supply'),
    account ? view(CONTRACT_ADDRESSES.HousingCreditVault, 'ft_balance_of', { account_id: account }) : null,
    view(CONTRACT_ADDRESSES.HousingCreditVault, 'get_nav_booked').catch(() => '1000000'),
  ]);

  const sharePrice = sharePriceFromNav(nav);
  const sharesRaw = userShares === null ? null : String(userShares);
  const userShareValue = sharesRaw === null
    ? null
    : amountText((BigInt(sharesRaw) * BigInt(nav || '1000000')) / 1000000n, meta.decimals);

  return {
    ...meta,
    totalAssets: amountText(String(totalAssets ?? '0'), meta.decimals),
    tvl: amountText(String(totalAssets ?? '0'), meta.decimals),
    availableCapital: amountText(String(available ?? '0'), meta.decimals),
    deployedCapital: amountText(String(outstanding ?? '0'), meta.decimals),
    totalShares: amountText(String(totalShares ?? '0'), meta.shareDecimals),
    nav: sharePrice,
    sharePrice,
    userShares: sharesRaw === null ? 'Connect wallet' : amountText(sharesRaw, meta.shareDecimals),
    userDeposited: userShareValue === null ? 'Connect wallet' : userShareValue,
    estimatedApy: 'Not calculated',
  };
}

async function loanRecord(id, decimals) {
  const loan = await view(CONTRACT_ADDRESSES.LoanManager, 'get_loan', { loan_id: id });
  if (!loan) return null;
  const status = String(loan.status);
  return {
    id: String(loan.id),
    borrower: loan.borrower,
    principal: amountText(loan.principal, decimals),
    remainingPrincipal: amountText(loan.remaining_principal, decimals),
    rate: (Number(loan.rate_bps) / 100).toString(),
    term: Math.round(Number(loan.term_days) / 30).toString(),
    propertyHash: loan.property_hash,
    status,
    isActive: status === 'Funded' || status === 'Repaying',
    maturityDate: null,
  };
}

async function loans() {
  const { decimals } = await metadata();
  const next = Number(await view(CONTRACT_ADDRESSES.LoanManager, 'get_next_loan_id') || 0);
  const ids = Array.from({ length: next }, (_, index) => index);
  const records = await Promise.all(ids.map((id) => loanRecord(id, decimals).catch(() => null)));
  return {
    loans: records.filter(Boolean),
    nextLoanId: String(next),
  };
}

/** Latest auction plus the connected borrower's approval / commitment / reveal. */
async function auction(account) {
  const meta = await metadata();
  const nextId = Number(await view(CONTRACT_ADDRESSES.CreditAuction, 'get_next_auction_id') || 1);
  const auctionId = nextId > 1 ? nextId - 1 : null;

  let record = null;
  if (auctionId !== null) {
    record = await view(CONTRACT_ADDRESSES.CreditAuction, 'get_auction', { auction_id: auctionId });
  }

  const commitment = account && auctionId !== null
    ? await view(CONTRACT_ADDRESSES.CreditAuction, 'get_commitment', { auction_id: auctionId, borrower: account }).catch(() => null)
    : null;
  const revealed = account && auctionId !== null
    ? await view(CONTRACT_ADDRESSES.CreditAuction, 'get_revealed_bid', { auction_id: auctionId, borrower: account }).catch(() => null)
    : null;
  const approval = account
    ? await view(CONTRACT_ADDRESSES.CreditAuction, 'get_borrower_approval', { borrower: account }).catch(() => null)
    : null;

  const state = auctionPhase(record?.state, record ? Number(record.reveal_deadline) : null);
  const bestBid = record?.best_bid || null;
  const bids = bestBid
    ? [{
        borrower: bestBid.borrower,
        amount: amountText(bestBid.amount, meta.decimals),
        rate: (Number(bestBid.rate_bps) / 100).toString(),
        term: Math.round(Number(bestBid.term_days) / 30).toString(),
        status: 'Revealed',
        property: 'Current auction',
      }]
    : [];

  const isApproved = Boolean(approval?.is_approved);

  return {
    ...meta,
    auctionId,
    state,
    rawState: record?.state || null,
    commitDeadline: record ? Number(record.commit_deadline) : null,
    revealDeadline: record ? Number(record.reveal_deadline) : null,
    commitment: commitment || null,
    hasCommitment: Boolean(commitment),
    alreadyRevealed: Boolean(revealed),
    userApproval: approval
      ? {
          isApproved,
          maxPrincipal: amountText(approval.max_principal, meta.decimals),
          propertyHash: approval.property_hash,
        }
      : null,
    bids,
    creditManager: Boolean(account),
    auctionManager: Boolean(account),
    canCommit: Boolean(account && isApproved && state === 'CommitPhase' && !commitment && !revealed),
    canReveal: Boolean(account && commitment && !revealed && state === 'RevealPhase'),
    canStart: state === 'Created' || state === 'Finalized' || state === 'Cancelled',
    canFinalize: state === 'AwaitingFinalization',
  };
}

/** Event ledger from the indexer API (keeps B6 `txSource` visible in the UI). */
async function recentEvents() {
  const response = await fetch(`${API_BASE}/api/events?limit=50`);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  const rows = Array.isArray(data?.events) ? data.events : [];
  const events = rows.map((row) => {
    const name = String(row.eventName || 'event');
    const simulated = row.txSource === 'SIMULATION';
    return {
      id: `${row.receiptId || row.txHash}:${row.logIndex ?? 0}`,
      type: name,
      title: name.replace(/[_-]+/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase()),
      detail: `${row.standard || 'contract'} · Block #${row.blockHeight}`,
      timestamp: simulated ? 'Simulated step' : `Receipt ${String(row.receiptId || '').slice(0, 8)}…`,
      txHash: row.txHash,
      dataType: simulated ? 'offchain' : 'onchain',
      txSource: simulated ? 'SIMULATION' : 'ONCHAIN',
      block: Number(row.blockHeight),
      logIndex: Number(row.logIndex ?? 0),
    };
  });
  const heights = events.map((event) => event.block).filter((value) => Number.isFinite(value));
  return {
    events,
    fromBlock: heights.length ? String(Math.min(...heights)) : null,
    toBlock: heights.length ? String(Math.max(...heights)) : null,
  };
}

/**
 * Builds the action surface bound to a connected account + wallet signer.
 * Call shapes mirror the previous EVM implementation so the dashboards did not
 * need restructuring.
 */
function actions(account, signer, onProgress = () => {}) {
  if (!account) throw new Error('Connect your wallet to submit a transaction.');
  if (!signer) throw new Error('The NEAR wallet is not ready yet.');

  const run = async (label, task) => {
    onProgress(`Confirm ${label} in your NEAR wallet.`);
    const { txHash } = await task();
    onProgress(`${label} submitted${txHash ? ` · ${txHash.slice(0, 8)}…` : ''}.`);
    return txHash;
  };

  const requireAuction = async () => {
    const current = await auction(account);
    if (current.auctionId === null) throw new Error('No auction cycle exists yet.');
    return current;
  };

  return {
    async deposit(value) {
      const { decimals } = await metadata();
      parseAmount(value, decimals);
      return run('the deposit', () => depositAction(signer, value));
    },

    async withdraw(value) {
      const { shareDecimals } = await metadata();
      parseAmount(value, shareDecimals);
      return run('the redemption', () => withdrawAction(signer, value));
    },

    async commitBid(input) {
      const current = await auction(account);
      if (!current.canCommit) {
        throw new Error('Commit is unavailable: check your approval, the deadline, and previous reveals.');
      }
      const commitment = await hashCommitment({
        amount: input.amount,
        rateBps: Math.round(Number(input.rate) * 100),
        termDays: Math.round(Number(input.term) * 30),
        salt: input.salt,
        accountId: account,
      });
      if (current.userApproval && parseAmount(input.amount, current.decimals) > parseAmount(current.userApproval.maxPrincipal, current.decimals)) {
        throw new Error('Bid exceeds your approved principal.');
      }
      return run('the bid commitment', () => commitBidAction(signer, {
        auctionId: current.auctionId,
        commitment,
      }));
    },

    async revealBid(input) {
      const current = await auction(account);
      if (!current.canReveal) throw new Error('Reveal is unavailable: check the deadline and your commitment.');
      const rateBps = Math.round(Number(input.rate) * 100);
      const termDays = Math.round(Number(input.term) * 30);
      const hash = await hashCommitment({
        amount: input.amount,
        rateBps,
        termDays,
        salt: input.salt,
        accountId: account,
      });
      if (hash !== current.commitment) throw new Error('Bid terms or salt do not match your onchain commitment.');
      return run('the reveal', () => revealBidAction(signer, {
        auctionId: current.auctionId,
        amount: input.amount,
        rateBps,
        termDays,
        salt: input.salt,
      }));
    },

    async approveBorrower(borrower, value, property) {
      return run('the credit approval', () => approveBorrowerAction(signer, {
        borrower,
        maxPrincipal: value,
        propertyHash: property,
      }));
    },

    async startAuction(commitDuration, revealDuration) {
      return run('the new auction cycle', () =>
        createAuctionAction(signer, {
          commitDurationSeconds: commitDuration,
          revealDurationSeconds: revealDuration,
        })
      );
    },

    async finalizeAuction() {
      const current = await requireAuction();
      if (!current.canFinalize) {
        throw new Error('Wait until the reveal deadline before finalizing the auction.');
      }
      return run('the finalization', () => finalizeAuctionAction(signer, current.auctionId));
    },

    async repayLoan(id, amount) {
      return run('the repayment', () => repayLoanAction(signer, { loanId: id, amount }));
    },
  };
}

export function createProtocol(account, signer, onProgress) {
  return {
    metadata,
    vault,
    loans,
    auction,
    recentEvents,
    actions: (accountId = account, walletSigner = signer, progress = onProgress) => actions(accountId, walletSigner, progress),
  };
}

/** Commitment hash for a bid, plus the raw terms the contract expects on reveal. */
export async function bidValues({ amount, rate, term, salt }, decimals, account) {
  if (!account) throw new Error('Connect your wallet first.');
  if (!salt || !String(salt).trim()) throw new Error('Enter the secret salt used for this bid.');
  const rawAmount = parseAmount(amount, decimals).toString();
  const rateBps = Math.round(Number(rate) * 100);
  const termDays = Math.round(Number(term) * 30);
  if (!Number.isFinite(rateBps) || rateBps < 0) throw new Error('Enter a valid interest rate.');
  if (!Number.isFinite(termDays) || termDays <= 0) throw new Error('Enter a valid term.');
  const hash = await hashCommitment({ amount, rateBps, termDays, salt, accountId: account });
  return { args: { amount: rawAmount, rateBps, termDays, salt }, hash };
}
