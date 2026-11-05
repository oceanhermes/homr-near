import { beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createPublicClient, createWalletClient, custom, keccak256, parseUnits, stringToHex } from 'viem';
import { hardhat } from 'viem/chains';
import { createProtocol, auctionPhase, bidValues, parseAmount } from '../contracts/protocol';
import { applicationAmountToToken } from '../../../api/src/modules/applications/units';

describe('amounts and deadline boundaries', () => {
  it('preserves 18-decimal precision and rejects silent rounding', () => {
    expect(parseAmount('1.000000000000000001', 18)).toBe(1000000000000000001n);
    expect(() => parseAmount('1.0000001', 6)).toThrow();
    expect(() => parseAmount('1e3', 18)).toThrow();
    expect(() => parseAmount('0', 18)).toThrow();
    expect(applicationAmountToToken(50000000000n, 18)).toBe(parseUnits('50000', 18));
    expect(applicationAmountToToken(50000000000n, 6)).toBe(50000000000n);
  });
  it('allows the first reveal after the commit deadline without a state-changing transaction', () => {
    expect(auctionPhase(1, 100n, 200n, 100n)).toBe('CommitPhase');
    expect(auctionPhase(1, 100n, 200n, 101n)).toBe('RevealPhase');
    expect(auctionPhase(1, 100n, 200n, 200n)).toBe('RevealPhase');
    expect(auctionPhase(1, 100n, 200n, 201n)).toBe('AwaitingFinalization');
    expect(auctionPhase(3, 100n, 200n, 201n)).toBe('Finalized');
  });
});

const backend = resolve('../backend');
const installed = existsSync(resolve(backend, 'node_modules/hardhat/package.json'));
describe.skipIf(!installed)('frontend adapter against unchanged Solidity contracts', () => {
  let provider, client, protocol, wallets, addresses, artifacts;
  beforeAll(async () => {
    const require = createRequire(resolve(backend, 'package.json'));
    process.env.HARDHAT_CONFIG = resolve(backend, 'test/frontend.config.cjs');
    provider = require('hardhat').network.provider;
    await provider.request({ method: 'hardhat_reset' });
    const solc = require('solc');
    const names = ['MockUSDC', 'HousingCreditVault', 'LoanManager', 'CreditAuction'];
    const sources = Object.fromEntries(names.map((name) => [`${name}.sol`, { content: readFileSync(resolve(backend, `contracts/${name}.sol`), 'utf8') }]));
    const compiled = JSON.parse(solc.compile(JSON.stringify({ language: 'Solidity', sources,
      settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: 'cancun', outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } } }
    }), { import: (path) => ({ contents: readFileSync(resolve(backend, 'node_modules', path), 'utf8') }) }));
    expect(compiled.errors?.filter((error) => error.severity === 'error') || []).toEqual([]);
    artifacts = Object.fromEntries(names.map((name) => [name, compiled.contracts[`${name}.sol`][name]]));
    client = createPublicClient({ chain: hardhat, transport: custom(provider), cacheTime: 0, pollingInterval: 10 });
    const accounts = await provider.request({ method: 'eth_accounts' });
    wallets = accounts.slice(0, 3).map((account) => createWalletClient({ account, chain: hardhat, transport: custom(provider) }));
    addresses = {};
    for (const name of names) {
      const args = name === 'MockUSDC' ? [] : name === 'HousingCreditVault' ? [addresses.MockUSDC]
        : name === 'LoanManager' ? [addresses.HousingCreditVault, addresses.MockUSDC] : [addresses.LoanManager, addresses.HousingCreditVault];
      const hash = await wallets[0].deployContract({ abi: artifacts[name].abi, bytecode: `0x${artifacts[name].evm.bytecode.object}`, args });
      addresses[name] = (await client.waitForTransactionReceipt({ hash })).contractAddress;
    }
    const grant = async (name, role, account) => wallets[0].writeContract({ address: addresses[name], abi: artifacts[name].abi,
      functionName: 'grantRole', args: [keccak256(stringToHex(role)), account] });
    await grant('HousingCreditVault', 'LOAN_MANAGER_ROLE', addresses.LoanManager);
    await grant('LoanManager', 'AUCTION_MANAGER_ROLE', addresses.CreditAuction);
    await grant('CreditAuction', 'CREDIT_MANAGER_ROLE', accounts[0]);
    await grant('CreditAuction', 'AUCTION_MANAGER_ROLE', accounts[0]);
    await wallets[0].writeContract({ address: addresses.MockUSDC, abi: artifacts.MockUSDC.abi, functionName: 'mint', args: [accounts[1], parseUnits('1000', 18)] });
    protocol = createProtocol(client, addresses, 31337);
  }, 60000);

  it('deposits, redeems, commits, reveals, allocates and repays using the real ABI and token decimals', async () => {
    const investor = protocol.actions(wallets[1].account.address, (request) => wallets[1].writeContract(request));
    const borrower = protocol.actions(wallets[2].account.address, (request) => wallets[2].writeContract(request));
    const manager = protocol.actions(wallets[0].account.address, (request) => wallets[0].writeContract(request));
    expect(await protocol.metadata()).toEqual({ decimals: 18, shareDecimals: 18 });
    await investor.deposit('1000');
    expect((await protocol.vault(wallets[1].account.address)).userShares).toBe('1000');
    await investor.withdraw('100');
    expect((await protocol.vault()).availableCapital).toBe('900');
    await manager.approveBorrower(wallets[2].account.address, '500', 'test-property');
    await manager.startAuction('60', '60');
    const input = { amount: '500', rate: '9.5', term: '12', salt: 'private-integration-test-salt' };
    await borrower.commitBid(input);
    const committed = await protocol.auction(wallets[2].account.address);
    expect(committed.commitment).toBe(bidValues(input, 18, wallets[2].account.address).hash);
    expect(committed.bids).toEqual([]);
    expect(committed.canCommit).toBe(false);
    await provider.request({ method: 'evm_setNextBlockTimestamp', params: [committed.commitDeadline / 1000 + 1] });
    await provider.request({ method: 'evm_mine' });
    expect((await protocol.auction(wallets[2].account.address)).canReveal).toBe(true);
    await expect(borrower.revealBid({ ...input, salt: 'wrong-salt' })).rejects.toThrow('do not match');
    await borrower.revealBid(input);
    expect((await protocol.auction()).bids[0].amount).toBe('500');
    await expect(manager.finalizeAuction()).rejects.toThrow('Wait until');
    await provider.request({ method: 'evm_setNextBlockTimestamp', params: [committed.revealDeadline / 1000 + 1] });
    await provider.request({ method: 'evm_mine' });
    await manager.finalizeAuction();
    const { loans } = await protocol.loans();
    expect(loans[0]).toMatchObject({ principal: '500', isActive: true, maturityDate: null });
    expect(loans[0].borrower.toLowerCase()).toBe(wallets[2].account.address.toLowerCase());
    await expect(investor.repayLoan('0')).rejects.toThrow('borrower wallet');
    await borrower.repayLoan('0');
    expect((await protocol.loans()).loans[0].isActive).toBe(false);
    expect((await protocol.vault()).availableCapital).toBe('900');
    const { events } = await protocol.recentEvents();
    expect(events.some((event) => event.type === 'LoanRepaid')).toBe(true);
    expect(events.some((event) => event.type === 'BidRevealed')).toBe(true);
    await manager.startAuction('60', '60');
    expect((await protocol.auction(wallets[2].account.address)).alreadyRevealed).toBe(false);
    expect((await protocol.auction(wallets[2].account.address)).canCommit).toBe(true);
    const nextInput = { amount: '250', rate: '8.5', term: '6', salt: 'second-auction-salt' };
    await borrower.commitBid(nextInput);
    const secondCommit = await protocol.auction(wallets[2].account.address);
    expect(secondCommit.commitment).toBe(bidValues(nextInput, 18, wallets[2].account.address).hash);
    await provider.request({ method: 'evm_setNextBlockTimestamp', params: [secondCommit.commitDeadline / 1000 + 1] });
    await provider.request({ method: 'evm_mine' });
    await borrower.revealBid(nextInput);
    expect((await protocol.auction()).bids).toHaveLength(1);
    expect((await protocol.auction()).bids[0].amount).toBe('250');
  }, 60000);
});
