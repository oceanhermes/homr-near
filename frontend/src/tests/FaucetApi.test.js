import { afterEach, describe, expect, it, vi } from 'vitest';
import { claimFaucetToken, fetchFaucetInfo } from '../api/faucet';

afterEach(() => vi.unstubAllGlobals());

describe('faucet API', () => {
  it('rejects an old server that cannot report the actual claim amounts', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ success: true }) }));
    await expect(fetchFaucetInfo()).rejects.toThrow('The faucet server must be updated');
  });

  it('sends the selected wallet address to the mUSDC claim endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ success: true, txHash: '0xabc' }) });
    vi.stubGlobal('fetch', fetchMock);
    const address = '0x1111111111111111111111111111111111111111';

    await claimFaucetToken('usdc', address);

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/api\/claim-usdc$/);
    expect(options.method).toBe('POST');
    expect(JSON.parse(options.body)).toEqual({ address });
  });
});
