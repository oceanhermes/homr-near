// @vitest-environment jsdom
import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { TransactionProvider } from '../context/TransactionContext';
import InvestorDashboard from '../pages/InvestorDashboard';

vi.mock('wagmi', () => ({
  useAccount: () => ({ address: '0x123', isConnected: true }),
  useReadContract: () => ({ data: null }),
  useWriteContract: () => ({ writeContractAsync: vi.fn() }),
  useConnect: () => ({ connect: vi.fn(), connectors: [] }),
  useDisconnect: () => ({ disconnect: vi.fn() }),
  useSwitchChain: () => ({ switchChain: vi.fn() })
}));

const transaction = vi.hoisted(() => vi.fn());
vi.mock('../hooks/useProtocol', () => ({
  useProtocolQuery: (resource) => ({ refetch: vi.fn(), data: resource === 'vault' ? { userShares: '25,000.00', userDeposited: '25,000.00' } : { loans: [] } }),
  useProtocolTransaction: () => ({ transact: transaction, refresh: vi.fn() })
}));

beforeEach(() => transaction.mockReset().mockResolvedValue('0xtest'));
afterEach(cleanup);

describe('Deposit Form Validation & Execution', () => {
  const renderDashboard = () => {
    return render(
      <TransactionProvider>
        <MemoryRouter>
          <InvestorDashboard />
        </MemoryRouter>
      </TransactionProvider>
    );
  };

  it('renders deposit input and initial vault shares in capital actions', async () => {
    renderDashboard();
    fireEvent.click(screen.getByRole('button', { name: /Capital.*Deposit/ }));
    expect(await screen.findByLabelText('Deposit amount (mUSDC)')).toBeTruthy();
    expect(screen.getAllByText('25,000.00').length).toBeGreaterThan(0);
  });

  it('displays error when submitting 0 or negative deposit amount', async () => {
    renderDashboard();
    fireEvent.click(screen.getByRole('button', { name: /Capital.*Deposit/ }));
    const input = await screen.findByLabelText('Deposit amount (mUSDC)');
    const submitBtn = screen.getByRole('button', { name: 'Deposit and mint shares' });

    fireEvent.change(input, { target: { value: '0' } });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByText('Deposit amount must be greater than 0.')).toBeTruthy();
    });
  });

  it('submits the deposit through the protocol transaction handler', async () => {
    renderDashboard();
    fireEvent.click(screen.getByRole('button', { name: /Capital.*Deposit/ }));
    const input = await screen.findByLabelText('Deposit amount (mUSDC)');
    const submitBtn = screen.getByRole('button', { name: 'Deposit and mint shares' });

    fireEvent.change(input, { target: { value: '5000' } });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByText('Deposited 5000 mUSDC into the vault.')).toBeTruthy();
    });
    expect(transaction).toHaveBeenCalledWith('deposit', '5000');
  });

  it('shows a rejected transaction without claiming a successful deposit', async () => {
    transaction.mockRejectedValueOnce(new Error('User rejected the request.'));
    renderDashboard();
    fireEvent.click(screen.getByRole('button', { name: /Capital.*Deposit/ }));
    fireEvent.change(screen.getByLabelText('Deposit amount (mUSDC)'), { target: { value: '5000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Deposit and mint shares' }));
    expect(await screen.findByText('User rejected the request.')).toBeTruthy();
    expect(screen.queryByText('Deposited 5000 mUSDC into the vault.')).toBeNull();
  });
});
