// @vitest-environment jsdom
import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { TransactionProvider } from '../context/TransactionContext';
import BorrowerDashboard from '../pages/BorrowerDashboard';

vi.mock('wagmi', () => ({
  useAccount: () => ({ address: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8', isConnected: true }),
  useReadContract: () => ({ data: null }),
  useWriteContract: () => ({ writeContractAsync: vi.fn() }),
  useConnect: () => ({ connect: vi.fn(), connectors: [] }),
  useDisconnect: () => ({ disconnect: vi.fn() }),
  useSwitchChain: () => ({ switchChain: vi.fn() })
}));

const transaction = vi.hoisted(() => vi.fn());
vi.mock('../api/client', () => ({ fetchApplications: vi.fn(async () => ({ applications: [] })), createApplication: vi.fn() }));
vi.mock('../hooks/useProtocol', () => ({
  useProtocolQuery: (resource) => ({ refetch: vi.fn(), data: resource === 'auction' ? { state: 'CommitPhase', bids: [], canCommit: true, canReveal: true, decimals: 18 } : { loans: [] } }),
  useProtocolTransaction: () => ({ transact: transaction, refresh: vi.fn() })
}));

beforeEach(() => transaction.mockReset().mockResolvedValue('0xtest'));
afterEach(cleanup);

describe('Auction State Transitions & Commit/Reveal Bidding', () => {
  const renderBorrower = () => {
    return render(
      <TransactionProvider>
        <MemoryRouter>
          <BorrowerDashboard />
        </MemoryRouter>
      </TransactionProvider>
    );
  };

  it('separates approval status from commit and reveal actions', () => {
    renderBorrower();
    fireEvent.click(screen.getByRole('button', { name: /Property.*Application/ }));
    expect(screen.getByRole('heading', { name: 'Credit approval' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Auction.*Commit/ }));
    expect(screen.getByRole('button', { name: 'Commit bid hash' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Reveal and verify bid' })).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: '2. Reveal terms' }));
    expect(screen.getByRole('button', { name: 'Reveal and verify bid' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Commit bid hash' })).toBeNull();
  });

  it('triggers commit hash submission', async () => {
    renderBorrower();
    fireEvent.click(screen.getByRole('button', { name: /Auction.*Commit/ }));
    const commitBtn = screen.getByRole('button', { name: 'Commit bid hash' });

    fireEvent.click(commitBtn);

    await waitFor(() => {
      expect(screen.getByText('Bid commitment submitted.')).toBeTruthy();
    });
    expect(transaction).toHaveBeenCalledWith('commitBid', expect.objectContaining({ amount: '50000', rate: '9.5' }));
  });

  it('triggers reveal bid parameters submission', async () => {
    renderBorrower();
    fireEvent.click(screen.getByRole('button', { name: /Auction.*Commit/ }));
    fireEvent.click(screen.getByRole('tab', { name: '2. Reveal terms' }));
    const revealBtn = screen.getByRole('button', { name: 'Reveal and verify bid' });

    fireEvent.click(revealBtn);

    await waitFor(() => {
      expect(screen.getByText('Bid parameters revealed and validated.')).toBeTruthy();
    });
    expect(transaction).toHaveBeenCalledWith('revealBid', expect.objectContaining({ amount: '50000', rate: '9.5' }));
  });
});
