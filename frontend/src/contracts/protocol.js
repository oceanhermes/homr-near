import { decodeEventLog, encodePacked, formatUnits, isAddress, keccak256, parseUnits, stringToHex, zeroHash } from 'viem';
import VaultABI from './abi/HousingCreditVault';
import AuctionABI from './abi/CreditAuction';
import LoanABI from './abi/LoanManager';
import TokenABI from './abi/MockUSDC';

export const sameAddress = (a, b) => Boolean(a && b && a.toLowerCase() === b.toLowerCase());
export const amountText = (raw, decimals) => formatUnits(raw, decimals);

export function parseAmount(value, decimals, allowZero = false) {
  const text = String(value).trim();
  if (!/^\d+(\.\d+)?$/.test(text) || (text.split('.')[1]?.length || 0) > decimals) {
    throw new Error(`Enter a decimal amount with at most ${decimals} decimal places.`);
  }
  const amount = parseUnits(text, decimals);
  if (amount < 0n || (!allowZero && amount === 0n)) throw new Error('Amount must be greater than 0.');
  return amount;
}

export function bidValues({ amount, rate, term, salt }, decimals, account) {
  if (!isAddress(account || '')) throw new Error('Connect your wallet first.');
  if (!salt?.trim()) throw new Error('Enter the secret salt used for this bid.');
  const months = parseAmount(term, 0);
  const args = [parseAmount(amount, decimals), parseAmount(rate, 2, true), months * 30n * 86400n, salt];
  const hash = keccak256(encodePacked(
    ['uint256', 'uint256', 'uint256', 'address', 'string'],
    [...args.slice(0, 3), account, salt]
  ));
  return { args, hash };
}

export function auctionPhase(rawState, commitDeadline, revealDeadline, timestamp) {
  if (rawState === 3) return 'Finalized';
  if (rawState === 0) return 'Created';
  if (timestamp > revealDeadline) return 'AwaitingFinalization';
  if (timestamp > commitDeadline) return 'RevealPhase';
  return ['Created', 'CommitPhase', 'RevealPhase', 'Finalized'][rawState];
}

export function createProtocol(client, addresses, chainId) {
  const read = (name, abi, functionName, args = [], blockNumber) => client.readContract({
    address: addresses[name], abi, functionName, args, blockNumber
  });

  async function metadata() {
    const [rpcChain, decimals, shareDecimals, asset, loanAsset, loanVault, loanManager] = await Promise.all([
      client.getChainId(), read('MockUSDC', TokenABI, 'decimals'),
      read('HousingCreditVault', VaultABI, 'decimals'), read('HousingCreditVault', VaultABI, 'asset'),
      read('LoanManager', LoanABI, 'asset'), read('LoanManager', LoanABI, 'vault'),
      read('CreditAuction', AuctionABI, 'loanManager')
    ]);
    if (rpcChain !== chainId) throw new Error('RPC chain does not match the configured network.');
    if (!sameAddress(asset, addresses.MockUSDC) || !sameAddress(loanAsset, asset) ||
      !sameAddress(loanVault, addresses.HousingCreditVault) ||
      !sameAddress(loanManager, addresses.LoanManager)) throw new Error('Contract addresses do not belong to the same deployment.');
    return { decimals, shareDecimals };
  }

  async function vault(account) {
    const meta = await metadata();
    const blockNumber = await client.getBlockNumber();
    const [available, deployed, shares] = await Promise.all([
      read('HousingCreditVault', VaultABI, 'availableCapital', [], blockNumber),
      read('HousingCreditVault', VaultABI, 'totalDeployedCapital', [], blockNumber),
      account ? read('HousingCreditVault', VaultABI, 'balanceOf', [account], blockNumber) : null
    ]);
    return {
      ...meta, tvl: amountText(available + deployed, meta.decimals),
      availableCapital: amountText(available, meta.decimals), deployedCapital: amountText(deployed, meta.decimals),
      userShares: shares === null ? 'Connect wallet' : amountText(shares, meta.shareDecimals),
      userDeposited: shares === null ? 'Connect wallet' : amountText(shares, meta.decimals),
      sharePrice: meta.shareDecimals >= meta.decimals
        ? (10n ** BigInt(meta.shareDecimals - meta.decimals)).toString()
        : formatUnits(1n, meta.decimals - meta.shareDecimals),
      estimatedApy: 'Not calculated'
    };
  }

  async function loans() {
    const { decimals } = await metadata();
    const blockNumber = await client.getBlockNumber();
    const count = await read('LoanManager', LoanABI, 'nextLoanId', [], blockNumber);
    const result = [];
    for (let offset = 0n; offset < count; offset += 20n) {
      const ids = Array.from({ length: Number(count - offset > 20n ? 20n : count - offset) }, (_, i) => offset + BigInt(i));
      const batch = await Promise.all(ids.map(async (id) => {
        const [borrower, principal, rate, term, propertyHash, isActive] = await read('LoanManager', LoanABI, 'loans', [id], blockNumber);
        return { id: id.toString(), borrower, principal: amountText(principal, decimals), rate: formatUnits(rate, 2),
          term: (Number(term) / (30 * 86400)).toString(), propertyHash, isActive, maturityDate: null };
      }));
      result.push(...batch);
    }
    return { loans: result, nextLoanId: count.toString() };
  }

  async function auction(account) {
    const meta = await metadata();
    const block = await client.getBlock();
    const readAuction = (name, args) => read('CreditAuction', AuctionABI, name, args, block.number);
    const [rawState, commitDeadline, revealDeadline, approval, commitment, revealed, creditManager, auctionManager] = await Promise.all([
      readAuction('state'), readAuction('commitDeadline'), readAuction('revealDeadline'),
      account ? readAuction('approvals', [account]) : null,
      account ? readAuction('commitments', [account]) : zeroHash,
      account ? readAuction('revealedBids', [account]) : null,
      account ? readAuction('hasRole', [keccak256(stringToHex('CREDIT_MANAGER_ROLE')), account]) : false,
      account ? readAuction('hasRole', [keccak256(stringToHex('AUCTION_MANAGER_ROLE')), account]) : false
    ]);
    // The contract exposes an indexed array getter, but no length getter.
    const bids = [];
    for (let i = 0n; ; i++) {
      let borrower;
      try { borrower = await readAuction('revealedBorrowers', [i]); }
      catch (error) {
        const cause = error.walk?.((item) => item.name === 'ContractFunctionRevertedError');
        if (cause?.data?.errorName === 'Panic' && Number(cause.data.args?.[0]) === 50) break;
        // Providers report the generated getter's out-of-bounds revert differently.
        if (cause?.name === 'ContractFunctionRevertedError' && !cause.data && (!cause.raw || cause.raw === '0x')) break;
        const emptyRevert = error.walk?.((item) => item.data === '0x' && /revert/i.test(item.message || ''));
        if (emptyRevert?.data === '0x') break;
        throw error;
      }
      const [, amount, rate, term] = await readAuction('revealedBids', [borrower]);
      bids.push({ borrower, amount: amountText(amount, meta.decimals), rate: formatUnits(rate, 2),
        term: (Number(term) / (30 * 86400)).toString(), status: 'Revealed', property: 'Current auction' });
    }
    const state = auctionPhase(Number(rawState), commitDeadline, revealDeadline, block.timestamp);
    const hasCommitment = commitment !== zeroHash;
    return {
      ...meta, state, rawState: Number(rawState), commitDeadline: Number(commitDeadline) * 1000,
      revealDeadline: Number(revealDeadline) * 1000, commitment, hasCommitment, alreadyRevealed: Boolean(revealed?.[4]),
      userApproval: approval ? { isApproved: approval[0], maxPrincipal: amountText(approval[1], meta.decimals), propertyHash: approval[2] } : null,
      bids, creditManager, auctionManager,
      canCommit: Boolean(account && approval?.[0] && state === 'CommitPhase' && !hasCommitment && !revealed?.[4]),
      canReveal: Boolean(account && hasCommitment && !revealed?.[4] && state === 'RevealPhase'),
      canStart: auctionManager && (state === 'Created' || state === 'Finalized'),
      canFinalize: auctionManager && state === 'AwaitingFinalization'
    };
  }

  async function recentEvents() {
    const latest = await client.getBlockNumber();
    const fromBlock = latest > 1999n ? latest - 1999n : 0n;
    const abis = { HousingCreditVault: VaultABI, CreditAuction: AuctionABI, LoanManager: LoanABI };
    const events = [];
    for (let from = fromBlock; from <= latest; from += 500n) {
      const toBlock = from + 499n > latest ? latest : from + 499n;
      const logs = await client.getLogs({ address: Object.keys(abis).map((key) => addresses[key]), fromBlock: from, toBlock });
      for (const log of logs) {
        const name = Object.keys(abis).find((key) => sameAddress(addresses[key], log.address));
        let decoded;
        try { decoded = decodeEventLog({ abi: abis[name], data: log.data, topics: log.topics }); }
        catch { continue; }
        events.push({ id: `${log.transactionHash}:${log.logIndex}`, type: decoded.eventName,
          title: decoded.eventName.replace(/([A-Z])/g, ' $1').trim(),
          detail: `${name} · Block #${log.blockNumber}`, timestamp: `Log #${log.logIndex}`,
          txHash: log.transactionHash, dataType: 'onchain', block: log.blockNumber, logIndex: log.logIndex });
      }
    }
    events.sort((a, b) => a.block === b.block ? b.logIndex - a.logIndex : a.block > b.block ? -1 : 1);
    return { events: events.slice(0, 50), fromBlock: fromBlock.toString(), toBlock: latest.toString() };
  }

  function actions(account, write, onProgress = () => {}) {
    async function send(name, abi, functionName, args = []) {
      const { request } = await client.simulateContract({ address: addresses[name], abi, functionName, args, account });
      onProgress(`Confirm ${functionName} in your wallet.`);
      const hash = await write(request);
      onProgress(`Waiting for ${functionName} confirmation...`);
      let replaced = false;
      const receipt = await client.waitForTransactionReceipt({ hash, timeout: 180_000,
        onReplaced: ({ reason }) => { if (reason !== 'repriced') replaced = true; } });
      if (replaced) throw new Error('Transaction was cancelled or replaced with another action.');
      if (receipt.status !== 'success') throw new Error(`${functionName} reverted onchain.`);
      return receipt.transactionHash;
    }
    async function approve(spender, amount) {
      const allowance = await read('MockUSDC', TokenABI, 'allowance', [account, spender]);
      if (allowance < amount) await send('MockUSDC', TokenABI, 'approve', [spender, amount]);
    }
    return {
      async deposit(value) {
        const { decimals } = await metadata();
        const amount = parseAmount(value, decimals);
        await approve(addresses.HousingCreditVault, amount);
        return send('HousingCreditVault', VaultABI, 'deposit', [amount]);
      },
      async withdraw(value) {
        const { shareDecimals } = await metadata();
        return send('HousingCreditVault', VaultABI, 'withdraw', [parseAmount(value, shareDecimals)]);
      },
      async commitBid(input) {
        const current = await auction(account);
        if (!current.canCommit) throw new Error('Commit is unavailable: check approval, deadline, and previous reveal status.');
        const { hash, args } = bidValues(input, current.decimals, account);
        if (args[0] > parseAmount(current.userApproval.maxPrincipal, current.decimals)) throw new Error('Bid exceeds your approved principal.');
        return send('CreditAuction', AuctionABI, 'commitBid', [hash]);
      },
      async revealBid(input) {
        const current = await auction(account);
        if (!current.canReveal) throw new Error('Reveal is unavailable: check the deadline and your commitment.');
        const { hash, args } = bidValues(input, current.decimals, account);
        if (hash !== current.commitment) throw new Error('Bid terms or salt do not match your onchain commitment.');
        return send('CreditAuction', AuctionABI, 'revealBid', args);
      },
      async approveBorrower(borrower, value, property) {
        if (!isAddress(borrower)) throw new Error('Enter a valid borrower wallet address.');
        if (!property.trim()) throw new Error('Enter the verified property reference.');
        const { decimals } = await metadata();
        return send('CreditAuction', AuctionABI, 'approveBorrower', [borrower, parseAmount(value, decimals), property]);
      },
      async startAuction(commitDuration, revealDuration) {
        return send('CreditAuction', AuctionABI, 'startAuction', [parseAmount(commitDuration, 0), parseAmount(revealDuration, 0)]);
      },
      async finalizeAuction() {
        const current = await auction(account);
        if (!current.canFinalize) throw new Error('Wait until the reveal deadline and connect an auction manager wallet.');
        return send('CreditAuction', AuctionABI, 'finalizeAuction');
      },
      async repayLoan(id) {
        await metadata();
        const [borrower, principal, , , , active] = await read('LoanManager', LoanABI, 'loans', [BigInt(id)]);
        if (!active || !sameAddress(borrower, account)) throw new Error('Connect the borrower wallet for this active loan.');
        await approve(addresses.LoanManager, principal);
        return send('LoanManager', LoanABI, 'repayLoan', [BigInt(id), principal]);
      }
    };
  }
  return { metadata, vault, loans, auction, recentEvents, actions };
}
