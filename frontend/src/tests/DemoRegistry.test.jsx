// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import DemoPage from '../pages/DemoPage';
import { callNearView } from '../near/rpc';

vi.mock('../contracts/addresses', () => ({
  CHAIN_CONFIG: { chainName: 'BNB Smart Chain Testnet' },
  NEAR_CONFIG: { contractId: 'registry.testnet' },
}));
vi.mock('../near/rpc', () => ({ callNearView: vi.fn() }));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

it('keeps the simulated walkthrough separate from a live registry lookup', async () => {
  callNearView.mockResolvedValueOnce({ proof_hash: 'loan-proof', recorded_by: 'operator.testnet', recorded_at: 1700000000000 })
    .mockResolvedValueOnce([{ proof_hash: 'repayment-proof' }]);
  const user = userEvent.setup();
  render(<MemoryRouter><DemoPage /></MemoryRouter>);

  expect(screen.getByText('No funds move. No credit decision is being made.')).toBeTruthy();
  await user.selectOptions(screen.getByLabelText('Record type'), 'loan');
  await user.type(screen.getByLabelText('Loan ID'), 'loan-1');
  await user.click(screen.getByRole('button', { name: 'Check record' }));

  expect(await screen.findByText('loan-proof')).toBeTruthy();
  expect(screen.getByText('repayment-proof')).toBeTruthy();
  expect(callNearView).toHaveBeenCalledWith('get_loan', { loan_id: 'loan-1' });
  expect(callNearView).toHaveBeenCalledWith('get_repayments', { loan_id: 'loan-1' });
});
