/**
 * Typed NEAR contract wrappers.
 *
 * Every write goes through the Wallet Selector's `signAndSendTransaction`
 * (NEP-413-free flow: the wallet signs the transaction itself), so the UI never
 * needs a private key. Read calls stay in `src/near/rpc.ts` helpers /
 * `src/contracts/protocol.js`.
 */
import { CONTRACT_ADDRESSES, NEAR_CONFIG } from '../contracts/addresses';

export const TOKEN_DECIMALS = 6;
export const SHARE_DECIMALS = 6;
export const NAV_PRECISION = 1_000_000;

/** 1 yoctoNEAR — required by NEP-141 / one-yocto guarded methods. */
export const ONE_YOCTO = '1';
/** 0.01 NEAR storage deposit required by `commit_bid`. */
export const COMMIT_DEPOSIT = '10000000000000000000000';
/** 1 NEAR storage deposit forwarded to `ft_on_transfer`. */
export const STORAGE_DEPOSIT = '1000000000000000000000000';

export const GAS = {
  /** Simple state mutations (commit, reveal, finalize, approve, create). */
  simple: '30000000000000',
  /** Cross-contract vault calls (`withdraw`, `fund_loan`, `record_repayment`). */
  crossContract: '150000000000000',
  /** NEP-141 `ft_transfer_call` (token → vault `ft_on_transfer`). */
  ftTransferCall: '100000000000000',
} as const;

export type Numeric = string | number | bigint;

export interface FunctionCallAction {
  type: 'FunctionCall';
  params: {
    methodName: string;
    args: Record<string, unknown>;
    gas: string;
    deposit: string;
  };
}

/** Minimal surface of the Wallet Selector wallet we rely on. */
export interface NearSigner {
  signAndSendTransaction(params: {
    receiverId: string;
    actions: FunctionCallAction[];
  }): Promise<unknown>;
}

export interface SignedTransaction {
  txHash: string;
  outcome: unknown;
}

/** Fixed-point string → raw integer string (6 decimals by default). */
export function toRaw(value: Numeric, decimals: number = TOKEN_DECIMALS): string {
  const text = String(value).trim();
  if (!/^\d+(\.\d+)?$/.test(text)) {
    throw new Error(`Enter a decimal amount with at most ${decimals} decimal places.`);
  }
  const [whole, fraction = ''] = text.split('.');
  if (fraction.length > decimals) {
    throw new Error(`Enter a decimal amount with at most ${decimals} decimal places.`);
  }
  const padded = fraction.padEnd(decimals, '0');
  const raw = `${whole}${padded}`.replace(/^0+(?=\d)/, '');
  return raw || '0';
}

/** Raw integer string → fixed-point display string, trailing zeros trimmed. */
export function fromRaw(value: Numeric, decimals: number = TOKEN_DECIMALS): string {
  const raw = BigInt(String(value ?? '0')).toString().padStart(decimals + 1, '0');
  const whole = raw.slice(0, raw.length - decimals);
  const fraction = raw.slice(raw.length - decimals).replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole;
}

function u128be(value: bigint): Uint8Array {
  const out = new Uint8Array(16);
  let rest = value;
  for (let i = 15; i >= 0; i--) {
    out[i] = Number(rest & 0xffn);
    rest >>= 8n;
  }
  return out;
}

function u32be(value: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value, false);
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Mirrors `homr_common::hash_commitment` exactly:
 * sha256(amount u128 BE || rate_bps u32 BE || term_days u32 BE || salt utf8 || account_id utf8)
 */
export async function hashCommitment(input: {
  amount: Numeric;
  rateBps: number;
  termDays: number;
  salt: string;
  accountId: string;
}): Promise<string> {
  if (!input.salt.trim()) throw new Error('Enter the secret salt used for this bid.');
  if (!input.accountId) throw new Error('Connect your wallet first.');

  const preimage = concat([
    u128be(BigInt(toRaw(input.amount))),
    u32be(input.rateBps),
    u32be(input.termDays),
    new TextEncoder().encode(input.salt),
    new TextEncoder().encode(input.accountId),
  ]);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', preimage as unknown as BufferSource);
  return toHex(new Uint8Array(digest));
}

function extractTxHash(outcome: unknown): string {
  const candidates = Array.isArray(outcome) ? outcome : [outcome];
  for (const entry of candidates) {
    const record = entry as Record<string, any> | null;
    const hash =
      record?.transaction?.hash ||
      record?.transaction_outcome?.id ||
      record?.transaction_outcome?.transaction_hash ||
      record?.id;
    if (typeof hash === 'string' && hash) return hash;
  }
  return '';
}

async function call(
  signer: NearSigner,
  receiverId: string,
  methodName: string,
  args: Record<string, unknown>,
  options: { gas?: string; deposit?: string } = {}
): Promise<SignedTransaction> {
  if (!signer) throw new Error('Connect your NEAR wallet to submit a transaction.');
  if (!receiverId) throw new Error(`No contract configured for ${methodName}.`);

  const outcome = await signer.signAndSendTransaction({
    receiverId,
    actions: [
      {
        type: 'FunctionCall',
        params: {
          methodName,
          args,
          gas: options.gas || GAS.simple,
          deposit: options.deposit || '0',
        },
      },
    ],
  });

  return { txHash: extractTxHash(outcome), outcome };
}

async function callMany(
  signer: NearSigner,
  receiverId: string,
  calls: Array<{ methodName: string; args: Record<string, unknown>; gas?: string; deposit?: string }>
): Promise<SignedTransaction> {
  if (!signer) throw new Error('Connect your NEAR wallet to submit a transaction.');
  if (!receiverId) throw new Error('No contract configured for this transaction.');

  const outcome = await signer.signAndSendTransaction({
    receiverId,
    actions: calls.map((entry) => ({
      type: 'FunctionCall' as const,
      params: {
        methodName: entry.methodName,
        args: entry.args,
        gas: entry.gas || GAS.simple,
        deposit: entry.deposit || '0',
      },
    })),
  });

  return { txHash: extractTxHash(outcome), outcome };
}

// ---------------------------------------------------------------------------
// Vault (homr-housing-vault)
// ---------------------------------------------------------------------------

/**
 * Deposit underlying tokens: NEP-141 `ft_transfer_call` → vault `ft_on_transfer`,
 * which mints hvSHARE at the booked NAV.
 *
 * The vault's `ft_on_transfer` refunds unless it receives >= 1 NEAR of attached
 * deposit, so the token contract must forward the storage deposit. See the STEP 5
 * report for the integration caveat.
 */
export function deposit(signer: NearSigner, amount: Numeric): Promise<SignedTransaction> {
  return call(
    signer,
    CONTRACT_ADDRESSES.MockUSDC,
    'ft_transfer_call',
    {
      receiver_id: CONTRACT_ADDRESSES.HousingCreditVault,
      amount: toRaw(amount),
      msg: '',
    },
    { gas: GAS.ftTransferCall, deposit: ONE_YOCTO }
  );
}

export function withdraw(signer: NearSigner, shares: Numeric): Promise<SignedTransaction> {
  return call(
    signer,
    CONTRACT_ADDRESSES.HousingCreditVault,
    'withdraw',
    { shares: toRaw(shares, SHARE_DECIMALS) },
    { deposit: ONE_YOCTO, gas: GAS.crossContract }
  );
}

// ---------------------------------------------------------------------------
// Credit auction (homr-credit-auction)
// ---------------------------------------------------------------------------

export function approveBorrower(
  signer: NearSigner,
  input: { borrower: string; maxPrincipal: Numeric; propertyHash: string }
): Promise<SignedTransaction> {
  if (!input.borrower) throw new Error('Enter a valid borrower account ID.');
  if (!input.propertyHash.trim()) throw new Error('Enter the verified property reference.');
  return call(signer, CONTRACT_ADDRESSES.CreditAuction, 'approve_borrower', {
    borrower: input.borrower,
    max_principal: toRaw(input.maxPrincipal),
    property_hash: input.propertyHash,
  });
}

export function createAuction(
  signer: NearSigner,
  input: { commitDurationSeconds: Numeric; revealDurationSeconds: Numeric; auctionId: Numeric }
): Promise<SignedTransaction> {
  const auctionId = Number(input.auctionId);
  // `create_auction` leaves the auction in Draft; it must be opened and then
  // moved into the commit phase. All three calls are issued atomically in one
  // wallet approval, in declaration order.
  return callMany(signer, CONTRACT_ADDRESSES.CreditAuction, [
    {
      methodName: 'create_auction',
      args: {
        commit_duration_ms: Number(input.commitDurationSeconds) * 1000,
        reveal_duration_ms: Number(input.revealDurationSeconds) * 1000,
      },
    },
    { methodName: 'open_auction', args: { auction_id: auctionId } },
    { methodName: 'start_commit_phase', args: { auction_id: auctionId } },
  ]);
}

export function openAuction(signer: NearSigner, auctionId: Numeric): Promise<SignedTransaction> {
  return call(signer, CONTRACT_ADDRESSES.CreditAuction, 'open_auction', {
    auction_id: Number(auctionId),
  });
}

export function startCommitPhase(signer: NearSigner, auctionId: Numeric): Promise<SignedTransaction> {
  return call(signer, CONTRACT_ADDRESSES.CreditAuction, 'start_commit_phase', {
    auction_id: Number(auctionId),
  });
}

/** `commit_bid` is payable: the contract requires >= 0.01 NEAR for storage. */
export function commitBid(
  signer: NearSigner,
  input: { auctionId: Numeric; commitment: string }
): Promise<SignedTransaction> {
  if (!input.commitment) throw new Error('Commitment hash is required.');
  return call(
    signer,
    CONTRACT_ADDRESSES.CreditAuction,
    'commit_bid',
    { auction_id: Number(input.auctionId), commitment: input.commitment },
    { deposit: COMMIT_DEPOSIT }
  );
}

export function revealBid(
  signer: NearSigner,
  input: {
    auctionId: Numeric;
    amount: Numeric;
    rateBps: number;
    termDays: number;
    salt: string;
  }
): Promise<SignedTransaction> {
  return call(
    signer,
    CONTRACT_ADDRESSES.CreditAuction,
    'reveal_bid',
    {
      auction_id: Number(input.auctionId),
      amount: toRaw(input.amount),
      rate_bps: input.rateBps,
      term_days: input.termDays,
      salt: input.salt,
    },
    { gas: GAS.crossContract }
  );
}

/** `finalize_auction` cross-calls `loan_manager.issue_loan`. */
export function finalizeAuction(signer: NearSigner, auctionId: Numeric): Promise<SignedTransaction> {
  return call(
    signer,
    CONTRACT_ADDRESSES.CreditAuction,
    'finalize_auction',
    { auction_id: Number(auctionId) },
    { gas: GAS.crossContract }
  );
}

// ---------------------------------------------------------------------------
// Loan manager (homr-loan-manager)
// ---------------------------------------------------------------------------

/** `repay_loan` forwards principal accounting to the vault via `record_repayment`. */
export function repayLoan(
  signer: NearSigner,
  input: { loanId: Numeric; amount: Numeric }
): Promise<SignedTransaction> {
  return call(
    signer,
    CONTRACT_ADDRESSES.LoanManager,
    'repay_loan',
    { loan_id: Number(input.loanId), amount: toRaw(input.amount) },
    { gas: GAS.crossContract }
  );
}

export const CONTRACTS = {
  vault: NEAR_CONFIG.vaultContractId,
  auction: NEAR_CONFIG.auctionContractId,
  loanManager: NEAR_CONFIG.loanManagerContractId,
  token: NEAR_CONFIG.tokenContractId,
};
