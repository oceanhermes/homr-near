// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { TransactionProvider } from '../context/TransactionContext';
import DashboardEntry from '../components/layout/DashboardEntry';
import { App } from '../main';

const readiness = vi.hoisted(() => ({ pending: true }));
vi.mock('../hooks/useProtocol', () => ({
  useProtocolQuery: () => ({ isPending: readiness.pending }),
  useProtocolTransaction: () => ({ transact: vi.fn(), refresh: vi.fn() })
}));

beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.requestAnimationFrame = (callback) => { callback(); return 1; };
});
afterEach(() => { cleanup(); readiness.pending = true; });

function renderRoutes(initialRoute = '/') {
  const routes = (
    <TransactionProvider>
      <MemoryRouter initialEntries={[initialRoute]}>
        <Routes>
          <Route path="/" element={<App />} />
          <Route path="/app/invest" element={<DashboardEntry role="investor"><h1>Investor ready</h1></DashboardEntry>} />
          <Route path="/app/borrow" element={<DashboardEntry role="borrower"><h1>Borrower ready</h1></DashboardEntry>} />
          <Route path="/app/admin" element={<DashboardEntry role="admin"><h1>Admin ready</h1></DashboardEntry>} />
        </Routes>
      </MemoryRouter>
    </TransactionProvider>
  );
  return render(routes);
}

describe('dashboard entry loading', () => {
  it('appears after choosing a dashboard and exits when the initial contract read settles', async () => {
    const user = userEvent.setup();
    const view = renderRoutes();
    await user.click(screen.getAllByRole('button', { name: 'Open dashboard' })[0]);
    await user.click(screen.getByRole('button', { name: /Borrower/ }));

    expect(screen.getByRole('status').textContent).toContain('Preparing your borrower dashboard');
    expect(screen.queryByRole('heading', { name: 'Borrower ready' })).toBeNull();

    readiness.pending = false;
    view.rerender(
      <TransactionProvider>
        <MemoryRouter initialEntries={['/']}>
          <Routes>
            <Route path="/" element={<App />} />
            <Route path="/app/borrow" element={<DashboardEntry role="borrower"><h1>Borrower ready</h1></DashboardEntry>} />
          </Routes>
        </MemoryRouter>
      </TransactionProvider>
    );
    expect(screen.getByRole('heading', { name: 'Borrower ready' })).toBeTruthy();
    expect(screen.queryByText('Preparing your borrower dashboard')).toBeNull();
  });

  it('opens the live dashboard once its initial query has settled', () => {
    readiness.pending = false;
    renderRoutes('/app/invest');
    expect(screen.getByRole('heading', { name: 'Investor ready' })).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();
  });
});
