import { describe, expect, it } from 'vitest';
import { fromRaw, hashCommitment, toRaw } from '../near/contracts';
import { auctionPhase, parseAmount } from '../contracts/protocol';

describe('NEAR amount helpers', () => {
  it('converts fixed-point amounts to raw 6-decimal integers', () => {
    expect(toRaw('50000')).toBe('50000000000');
    expect(toRaw('9.5')).toBe('9500000');
    expect(toRaw('0.000001')).toBe('1');
    expect(() => toRaw('1.1234567')).toThrow(/at most 6 decimal places/);
    expect(() => toRaw('abc')).toThrow(/decimal amount/);
  });

  it('formats raw integers back to display amounts', () => {
    expect(fromRaw('50000000000')).toBe('50000');
    expect(fromRaw('9500000')).toBe('9.5');
    expect(fromRaw('1')).toBe('0.000001');
    expect(fromRaw('0')).toBe('0');
  });

  it('rejects zero amounts unless explicitly allowed', () => {
    expect(() => parseAmount('0', 6)).toThrow('Amount must be greater than 0.');
    expect(parseAmount('0', 2, true)).toBe(0n);
    expect(parseAmount('9.5', 2, true)).toBe(950n);
  });
});

describe('commitment hashing', () => {
  it('matches the contract preimage layout and is stable across calls', async () => {
    const args = { amount: '50000', rateBps: 950, termDays: 360, salt: 'pepper', accountId: 'borrower.testnet' };
    const first = await hashCommitment(args);
    const second = await hashCommitment(args);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(second).toBe(first);
  });

  it('changes when any committed term changes', async () => {
    const base = { amount: '50000', rateBps: 950, termDays: 360, salt: 'pepper', accountId: 'borrower.testnet' };
    const hash = await hashCommitment(base);
    expect(await hashCommitment({ ...base, rateBps: 951 })).not.toBe(hash);
    expect(await hashCommitment({ ...base, salt: 'salt2' })).not.toBe(hash);
    expect(await hashCommitment({ ...base, accountId: 'other.testnet' })).not.toBe(hash);
    await expect(hashCommitment({ ...base, salt: '' })).rejects.toThrow(/secret salt/);
  });
});

describe('auction phase mapping', () => {
  const now = 1_000_000;

  it('maps contract states to dashboard phases', () => {
    expect(auctionPhase('Draft')).toBe('Created');
    expect(auctionPhase('Open')).toBe('Created');
    expect(auctionPhase('Commit')).toBe('CommitPhase');
    expect(auctionPhase('Reveal', now + 1000, now)).toBe('RevealPhase');
    expect(auctionPhase('Reveal', now - 1, now)).toBe('AwaitingFinalization');
    expect(auctionPhase('Finalized')).toBe('Finalized');
    expect(auctionPhase(null)).toBe('Created');
  });
});
