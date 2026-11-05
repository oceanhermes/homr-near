import { describe, expect, it, vi } from 'vitest';
import { createProtocol } from '../contracts/protocol';

const addresses = {
  MockUSDC: '0x0000000000000000000000000000000000000001',
  HousingCreditVault: '0x0000000000000000000000000000000000000002',
  LoanManager: '0x0000000000000000000000000000000000000003',
  CreditAuction: '0x0000000000000000000000000000000000000004'
};
const account = '0x0000000000000000000000000000000000000005';
function setup(receipt) {
  const client = {
    getChainId: async () => 97,
    readContract: vi.fn(async ({ functionName }) => ({ decimals: 18, asset: addresses.MockUSDC,
      vault: addresses.HousingCreditVault, loanManager: addresses.LoanManager, allowance: 0n })[functionName]),
    simulateContract: vi.fn(async (request) => ({ request })),
    waitForTransactionReceipt: vi.fn(receipt)
  };
  const write = vi.fn(async ({ functionName }) => functionName);
  return { client, write, actions: createProtocol(client, addresses, 97).actions(account, write) };
}

describe('transaction confirmation', () => {
  it('waits for approval mining before simulating or sending a deposit', async () => {
    let release;
    const approvalReceipt = new Promise((resolve) => { release = resolve; });
    const { actions, client, write } = setup(({ hash }) => hash === 'approve' ? approvalReceipt : { status: 'success', transactionHash: hash });
    const pending = actions.deposit('1.000000000000000001');
    await vi.waitFor(() => expect(client.waitForTransactionReceipt).toHaveBeenCalledOnce());
    expect(write.mock.calls.map(([request]) => request.functionName)).toEqual(['approve']);
    release({ status: 'success', transactionHash: 'approve' });
    expect(await pending).toBe('deposit');
    expect(write.mock.calls[1][0].args).toEqual([1000000000000000001n]);
  });
  it('does not send a deposit after a reverted approval', async () => {
    const { actions, write } = setup(async () => ({ status: 'reverted' }));
    await expect(actions.deposit('1')).rejects.toThrow('approve reverted');
    expect(write).toHaveBeenCalledOnce();
  });
  it('does not treat a cancelled transaction as success', async () => {
    const { actions, write } = setup(async ({ onReplaced }) => {
      onReplaced({ reason: 'cancelled' });
      return { status: 'success', transactionHash: 'cancelled' };
    });
    await expect(actions.deposit('1')).rejects.toThrow('cancelled or replaced');
    expect(write).toHaveBeenCalledOnce();
  });
  it('rejects a mismatched RPC chain before requesting a wallet signature', async () => {
    const { actions, client, write } = setup(async () => ({ status: 'success' }));
    client.getChainId = async () => 56;
    await expect(actions.deposit('1')).rejects.toThrow('RPC chain');
    expect(write).not.toHaveBeenCalled();
  });
  it('propagates a failed RPC instead of returning empty history', async () => {
    const client = { getBlockNumber: async () => 2000n, getLogs: async () => { throw new Error('RPC offline'); } };
    await expect(createProtocol(client, addresses, 97).recentEvents()).rejects.toThrow('RPC offline');
  });
});
