// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import FaucetPage from '../pages/FaucetPage';
import { claimFaucetToken, fetchFaucetInfo } from '../api/faucet';

const wallet = vi.hoisted(() => ({ address: undefined, isConnected: false }));
const connect = vi.hoisted(() => vi.fn());
vi.mock('../context/NearWalletProvider', () => ({
  useNearWallet: () => ({
    address: wallet.address,
    isConnected: wallet.isConnected,
    ready: true,
    isConnecting: false,
    error: null,
    connect,
    disconnect: vi.fn()
  })
}));
vi.mock('../api/faucet', () => ({
  fetchFaucetInfo: vi.fn(),
  claimFaucetToken: vi.fn()
}));

const target = 'borrower.testnet';
const info = { success: true, dripUsdc: '1000', cooldownSeconds: 3600 };

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  Object.assign(wallet, { address: undefined, isConnected: false });
});

function renderPage() {
  return render(<MemoryRouter><FaucetPage /></MemoryRouter>);
}

describe('faucet page', () => {
  it('claims mUSDC to a manually entered NEAR account and shows the transaction', async () => {
    fetchFaucetInfo.mockResolvedValue(info);
    claimFaucetToken.mockResolvedValue({ success: true, message: 'Successfully sent 1000 mUSDC!', txHash: 'near_abc' });
    const user = userEvent.setup();
    renderPage();

    await screen.findByText('Faucet ready');
    expect(screen.queryByRole('button', { name: 'Claim BNB testnet' })).toBeNull();
    fireEvent.change(screen.getByLabelText('NEAR account ID'), { target: { value: target } });
    await user.click(screen.getByRole('button', { name: 'Claim mUSDC' }));

    expect(claimFaucetToken).toHaveBeenCalledWith('usdc', target);
    expect(await screen.findByText('Successfully sent 1000 mUSDC!')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'View transaction on the explorer' }).getAttribute('href')).toBe('https://testnet.nearblocks.io/txns/near_abc');
  });

  it('rejects an invalid NEAR account id before claiming', async () => {
    fetchFaucetInfo.mockResolvedValue(info);
    renderPage();

    await screen.findByText('Faucet ready');
    fireEvent.change(screen.getByLabelText('NEAR account ID'), { target: { value: 'invalid account!' } });
    expect(screen.getByText(/Invalid account ID/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Claim mUSDC' }).disabled).toBe(true);
  });

  it('keeps claims disabled while the service is unavailable and recovers on retry', async () => {
    fetchFaucetInfo.mockRejectedValueOnce(new Error('The faucet is temporarily unavailable. Please try again later.')).mockResolvedValue(info);
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByText('The faucet is temporarily unavailable. Please try again later.')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('NEAR account ID'), { target: { value: target } });
    expect(screen.getByRole('button', { name: 'Claim mUSDC' }).disabled).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByText('Faucet ready');
    expect(screen.getByRole('button', { name: 'Claim mUSDC' }).disabled).toBe(false);
  });

  it('offers the NEAR wallet selector to a visitor without a wallet', async () => {
    fetchFaucetInfo.mockResolvedValue(info);
    const user = userEvent.setup();
    renderPage();

    await screen.findByText('Faucet ready');
    await user.click(screen.getByRole('button', { name: 'Connect NEAR wallet' }));
    expect(connect).toHaveBeenCalled();
  });

  it('prefills the connected account and shows the cooldown error after a claim attempt', async () => {
    Object.assign(wallet, { address: 'alice.testnet', isConnected: true });
    fetchFaucetInfo.mockResolvedValue(info);
    claimFaucetToken.mockRejectedValue(new Error('Wait 1 hour before claiming mUSDC again'));
    const user = userEvent.setup();
    renderPage();

    await screen.findByText('Faucet ready');
    expect(screen.getByLabelText('NEAR account ID').value).toBe('alice.testnet');
    await user.click(screen.getByRole('button', { name: 'Claim mUSDC' }));

    expect(await screen.findByText('Wait 1 hour before claiming mUSDC again')).toBeTruthy();
  });
});
