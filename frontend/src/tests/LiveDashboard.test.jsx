// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { TransactionProvider } from '../context/TransactionContext';
import BorrowerDashboard from '../pages/BorrowerDashboard';
import TransparencyLedger from '../components/transparency/TransparencyLedger';
import { createApplication, fetchApplications } from '../api/client';

vi.mock('../api/client', () => ({ createApplication: vi.fn(), fetchApplications: vi.fn() }));

const state = vi.hoisted(() => ({ address: '0x0000000000000000000000000000000000000001', error: null, repay: vi.fn() }));
vi.mock('wagmi', () => ({
  useAccount: () => ({ address: state.address, isConnected: Boolean(state.address), chainId: 97 }),
  useConnect: () => ({ connect: vi.fn(), connectors: [] }), useDisconnect: () => ({ disconnect: vi.fn() }),
  useSwitchChain: () => ({ switchChain: vi.fn() })
}));
vi.mock('../hooks/useProtocol', () => ({
  useProtocolTransaction: () => ({ transact: state.repay, refresh: vi.fn() }),
  useProtocolQuery: (resource) => ({ error: state.error, refetch: vi.fn(), isPending: false, data:
    resource === 'auction' ? { state: 'RevealPhase', canReveal: true, canCommit: false, bids: [], decimals: 18 } :
      resource === 'loans' ? { loans: [
        { id: '1', borrower: '0x0000000000000000000000000000000000000001', principal: '12.5', isActive: true, rate: '9', term: '12' },
        { id: '2', borrower: '0x0000000000000000000000000000000000000002', principal: '50', isActive: true, rate: '9', term: '12' }
      ] } : undefined
  })
}));
const wrap = (child) => <TransactionProvider><MemoryRouter>{child}</MemoryRouter></TransactionProvider>;
beforeEach(() => {
  state.error = null;
  state.address = '0x0000000000000000000000000000000000000001';
  state.repay.mockReset();
  fetchApplications.mockReset().mockResolvedValue({ applications: [] });
  createApplication.mockReset();
});
afterEach(cleanup);

describe('live dashboard', () => {
  it('defaults to live and never falls back to demo events on an empty or failed read', () => {
    const view = render(wrap(<TransparencyLedger />));
    expect(screen.getByText('No activity in this window')).toBeTruthy();
    expect(screen.queryByText('Vault Deposit Received')).toBeNull();
    state.error = new Error('RPC unavailable');
    view.rerender(wrap(<TransparencyLedger />));
    expect(screen.getByRole('alert').textContent).toContain('RPC unavailable');
    expect(screen.queryByText('No activity in this window')).toBeNull();
    expect(screen.queryByText('Vault Deposit Received')).toBeNull();
  });
  it('filters loans by the current wallet and only submits full principal', async () => {
    const view = render(wrap(<BorrowerDashboard />));
    fireEvent.click(screen.getByRole('button', { name: /Repay.*Payment/ }));
    const amount = screen.getByLabelText('Full principal repayment (mUSDC)');
    expect(amount.value).toBe('12.5');
    expect(amount.readOnly).toBe(true);
    expect(screen.queryByText('Loan #2')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Submit repayment' }));
    expect(state.repay).toHaveBeenCalledWith('repayLoan', '1');
    state.address = '0x0000000000000000000000000000000000000002';
    view.rerender(wrap(<BorrowerDashboard />));
    expect(screen.getByLabelText('Full principal repayment (mUSDC)').value).toBe('50');
    expect(screen.queryByText('Loan #1')).toBeNull();
  });
  it('allows reveal when the adapter derives the deadline transition', () => {
    render(wrap(<BorrowerDashboard />));
    fireEvent.click(screen.getByRole('button', { name: /Auction.*Commit/ }));
    fireEvent.click(screen.getByRole('tab', { name: '2. Reveal terms' }));
    expect(screen.getByRole('button', { name: 'Reveal and verify bid' }).disabled).toBe(false);
    expect(screen.getByLabelText('Original secret salt')).toBeTruthy();
  });
});

const savedApplication = (overrides = {}) => ({
  id: 'application-test',
  applicant: { walletAddress: state.address },
  propertyHash: 'TEST-DEED-REFERENCE',
  requestedAmount: '50000000000',
  requestedRate: 950,
  requestedTerm: 12 * 30 * 86400,
  status: 'PENDING',
  createdAt: '2026-10-05T04:00:00.000Z',
  ...overrides,
});

function openProperty() {
  fireEvent.click(screen.getByRole('button', { name: /Property.*Application/ }));
}

describe('borrower application history', () => {
  it('loads only the connected wallet history, newest first, and updates the next step', async () => {
    state.address = '0xabcdef0000000000000000000000000000000001';
    fetchApplications.mockResolvedValue({ applications: [
      savedApplication({ id: 'older', createdAt: '2026-10-04T04:00:00.000Z', status: 'REJECTED', reviewNote: 'Property reference incomplete' }),
      savedApplication({ id: 'other-wallet', applicant: { walletAddress: '0x0000000000000000000000000000000000000002' } }),
      savedApplication({ id: 'newest', applicant: { walletAddress: state.address.toUpperCase() } }),
    ] });
    render(wrap(<BorrowerDashboard />));
    expect(await screen.findByRole('button', { name: 'View submitted application' })).toBeTruthy();
    const workflow = screen.getByRole('list');
    expect(within(workflow).getByText('Credit assessment').closest('li').className).toBe('is-current');
    openProperty();
    expect(screen.getAllByText(/^Application #/).map((node) => node.textContent)).toEqual(['Application #newest', 'Application #older']);
    expect(screen.queryByText('Application #other-wallet')).toBeNull();
    const history = within(screen.getByRole('heading', { name: 'Application history' }).closest('section'));
    expect(history.getByText('Pending review')).toBeTruthy();
    expect(screen.getByText('Rejected')).toBeTruthy();
    expect(screen.getByText('Review note: Property reference incomplete')).toBeTruthy();
    expect(screen.getAllByText('50000 mUSDC')).toHaveLength(2);
    expect(screen.getAllByText('9.5% APR · 12 months')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: /Activity.*Audit trail/ }));
    expect(screen.getByText('Application #newest')).toBeTruthy();
  });

  it('reloads saved history after submitting and after reopening the dashboard', async () => {
    createApplication.mockImplementation(async (input) => {
      const application = savedApplication({ ...input });
      fetchApplications.mockResolvedValue({ applications: [application] });
      return application;
    });
    const view = render(wrap(<BorrowerDashboard />));
    openProperty();
    await screen.findByText('No applications submitted');
    fireEvent.click(screen.getByRole('button', { name: 'Submit new application' }));
    fireEvent.change(screen.getByLabelText('Applicant full name'), { target: { value: 'Test borrower' } });
    fireEvent.change(screen.getByLabelText('Property / deed reference'), { target: { value: 'TEST-DEED-REFERENCE' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit for credit review' }));
    expect(await screen.findByText('Application #application-test')).toBeTruthy();
    expect(createApplication).toHaveBeenCalledWith(expect.objectContaining({ walletAddress: state.address, requestedAmount: '50000000000' }));
    expect(screen.queryByLabelText('Applicant full name')).toBeNull();
    view.unmount();
    render(wrap(<BorrowerDashboard />));
    openProperty();
    expect(await screen.findByText('Application #application-test')).toBeTruthy();
  });

  it('shows a retryable load error instead of claiming there are no applications', async () => {
    fetchApplications.mockRejectedValueOnce(new Error('Cannot reach the application service.'));
    render(wrap(<BorrowerDashboard />));
    openProperty();
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('Cannot reach the application service.');
    expect(screen.getByRole('alert').textContent).not.toContain('last successful load');
    expect(screen.queryByText('No applications submitted')).toBeNull();
    fetchApplications.mockResolvedValue({ applications: [savedApplication({ status: 'APPROVED' })] });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh application history' }));
    expect(await screen.findByText('Application #application-test')).toBeTruthy();
    expect(screen.getByText('Approved')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('discards an old wallet response and clears history on disconnect', async () => {
    let resolveOldRequest;
    const oldApplication = savedApplication();
    fetchApplications.mockImplementationOnce(() => new Promise((resolve) => { resolveOldRequest = resolve; }));
    const view = render(wrap(<BorrowerDashboard />));
    openProperty();
    expect(screen.getByText('Loading application history...')).toBeTruthy();
    state.address = '0x0000000000000000000000000000000000000002';
    fetchApplications.mockResolvedValue({ applications: [savedApplication({ id: 'new-wallet' })] });
    view.rerender(wrap(<BorrowerDashboard />));
    await screen.findByText('Application #new-wallet');
    await act(async () => { resolveOldRequest({ applications: [oldApplication] }); });
    expect(screen.queryByText('Application #application-test')).toBeNull();
    expect(screen.getByText('Application #new-wallet')).toBeTruthy();
    state.address = undefined;
    view.rerender(wrap(<BorrowerDashboard />));
    expect(screen.queryByText('Application #new-wallet')).toBeNull();
    expect(screen.getByText('Connect your borrower wallet')).toBeTruthy();
  });

  it('keeps a failed submission open without adding a history entry', async () => {
    createApplication.mockRejectedValue(new Error('Cannot reach the application service'));
    render(wrap(<BorrowerDashboard />));
    openProperty();
    await screen.findByText('No applications submitted');
    fireEvent.click(screen.getByRole('button', { name: 'Submit new application' }));
    fireEvent.click(screen.getByRole('button', { name: 'Submit for credit review' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Cannot reach the application service'));
    expect(screen.getByLabelText('Applicant full name')).toBeTruthy();
    expect(fetchApplications).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/^Application #/)).toBeNull();
  });

  it('has no demo switch and requires a wallet before loading personal history', () => {
    state.address = undefined;
    render(wrap(<BorrowerDashboard />));
    openProperty();
    expect(screen.getByText('Connect your borrower wallet')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /demo|switch to live/i })).toBeNull();
    expect(screen.queryByText('MOCKED')).toBeNull();
    expect(fetchApplications).not.toHaveBeenCalled();
  });
});
