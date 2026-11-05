// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import Web3Provider from '../context/Web3Provider';
import { TransactionProvider } from '../context/TransactionContext';
import InvestorDashboard from '../pages/InvestorDashboard';
import BorrowerDashboard from '../pages/BorrowerDashboard';
import AdminPanel from '../pages/AdminPanel';

vi.mock('../hooks/useProtocol', () => ({
  useProtocolQuery: () => ({ refetch: vi.fn(), isPending: false }),
  useProtocolTransaction: () => ({ transact: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('../api/client', () => ({
  fetchApplications: vi.fn(async () => ({ applications: [] })),
  fetchAdminStatus: vi.fn(async () => null),
  createApplication: vi.fn(),
  reviewApplication: vi.fn(),
}));

beforeAll(() => {
  window.requestAnimationFrame = (callback) => {
    callback();
    return 1;
  };
});

afterEach(cleanup);

function renderDashboard(Component) {
  return render(
    <Web3Provider>
      <TransactionProvider>
        <MemoryRouter>
          <Component />
        </MemoryRouter>
      </TransactionProvider>
    </Web3Provider>
  );
}

describe('role dashboard information architecture', () => {
  it('opens and closes the compact mobile navigation drawer', async () => {
    const user = userEvent.setup();
    renderDashboard(InvestorDashboard);

    await user.click(screen.getByRole('button', { name: 'Open navigation menu' }));
    expect(screen.getByRole('button', { name: 'Close navigation menu' }).getAttribute('aria-expanded')).toBe('true');
    await user.click(screen.getByRole('button', { name: 'Close navigation' }));
    expect(screen.getByRole('button', { name: 'Open navigation menu' }).getAttribute('aria-expanded')).toBe('false');
  });

  it('shows only the selected investor section', async () => {
    const user = userEvent.setup();
    renderDashboard(InvestorDashboard);
    const main = screen.getByRole('main');

    expect(within(main).getByRole('heading', { name: 'Portfolio overview' })).toBeTruthy();
    expect(within(main).queryByRole('heading', { name: 'Capital actions' })).toBeNull();

    await user.click(screen.getByRole('button', { name: /Capital.*Deposit/ }));
    expect(within(main).getByRole('heading', { name: 'Capital actions' })).toBeTruthy();
    expect(within(main).queryByRole('heading', { name: 'Portfolio overview' })).toBeNull();

    await user.click(screen.getByRole('tab', { name: 'Redeem shares' }));
    expect(screen.getByLabelText('Shares to redeem (hvSHARE)')).toBeTruthy();
  });

  it('keeps the borrower application form inside its dedicated section', async () => {
    const user = userEvent.setup();
    renderDashboard(BorrowerDashboard);
    const main = screen.getByRole('main');

    expect(within(main).getByRole('heading', { name: 'Loan overview' })).toBeTruthy();
    expect(screen.queryByLabelText('Applicant full name')).toBeNull();

    await user.click(screen.getByRole('button', { name: /Property.*Application/ }));
    expect(within(main).getByRole('heading', { name: 'Credit & property' })).toBeTruthy();
    expect(screen.queryByLabelText('Applicant full name')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Submit new application' }));
    expect(screen.getByLabelText('Applicant full name')).toBeTruthy();
  });

  it('gives credit managers separate monitoring workspaces', async () => {
    const user = userEvent.setup();
    renderDashboard(AdminPanel);
    const main = screen.getByRole('main');

    await user.click(screen.getByRole('button', { name: /Bids.*Evaluation/ }));
    expect(within(main).getByRole('heading', { name: 'Bid monitoring' })).toBeTruthy();
    expect(within(main).queryByRole('heading', { name: 'Loan monitoring' })).toBeNull();

    await user.click(screen.getByRole('button', { name: /Loans.*Active book/ }));
    expect(within(main).getByRole('heading', { name: 'Loan monitoring' })).toBeTruthy();
    expect(within(main).queryByRole('heading', { name: 'Bid monitoring' })).toBeNull();
  });
});
