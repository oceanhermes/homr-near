import { describe, expect, it } from 'vitest';
import { createPublicClient, http } from 'viem';
import { bscTestnet } from 'viem/chains';
import { createProtocol } from '../contracts/protocol';
import deployment from '../../../deployments.json';
import { CHAIN_CONFIG } from '../contracts/addresses';

describe.skipIf(process.env.HOMR_LIVE_READ !== '1')('read-only deployed BNB Testnet integration', () => {
  it('reads metadata, vault, auction, loans and recent logs without a wallet', async () => {
    const client = createPublicClient({ chain: bscTestnet, transport: http(CHAIN_CONFIG.rpcUrl, { timeout: 15000, retryCount: 0 }) });
    const protocol = createProtocol(client, deployment.contracts, deployment.chainId);
    const meta = await protocol.metadata();
    const vault = await protocol.vault();
    const auction = await protocol.auction();
    const loans = await protocol.loans();
    const history = await protocol.recentEvents();
    expect(meta).toEqual({ decimals: 18, shareDecimals: 18 });
    expect(vault.userShares).toBe('Connect wallet');
    expect(auction.state).not.toBe('Unavailable');
    expect(Array.isArray(loans.loans)).toBe(true);
    expect(Array.isArray(history.events)).toBe(true);
    console.info('Live read:', { decimals: meta.decimals, availableCapital: vault.availableCapital,
      phase: auction.state, loans: loans.loans.length, recentEvents: history.events.length });
  }, 90000);
});
