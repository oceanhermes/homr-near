import React, { useState } from 'react';
import { useNearWallet } from '../../context/NearWalletProvider';
import { useTransactionState } from '../../context/TransactionContext';

/**
 * NEAR wallet connect button (replaces the wagmi ConnectButton).
 * Keeps the existing `.wallet-controls` / `.wallet-account` classes so the
 * layout and styling are unchanged.
 */
export function WalletConnectButton() {
  const { isTransacting } = useTransactionState();
  const { address, isConnected, connect, disconnect, isConnecting, ready, error } = useNearWallet();
  const [actionError, setActionError] = useState(null);

  const handleConnect = async () => {
    setActionError(null);
    try {
      await connect();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'Could not open the NEAR wallet selector.');
    }
  };

  const handleDisconnect = async () => {
    setActionError(null);
    try {
      await disconnect();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'Could not disconnect the wallet.');
    }
  };

  const fatal = actionError || (error ? error.message : null);

  return (
    <div className="wallet-controls">
      {isConnected ? (
        <button type="button" onClick={handleDisconnect} disabled={isTransacting} className="wallet-account">
          <span className="wallet-control__dot wallet-control__dot--connected" />
          <span>{`${address.slice(0, 6)}...${address.slice(-4)}`}</span>
        </button>
      ) : (
        <button type="button" onClick={handleConnect} className="wallet-account" disabled={isConnecting || !ready}>
          {isConnecting ? 'Connecting...' : ready ? 'Connect NEAR Wallet' : 'Loading wallets...'}
        </button>
      )}
      {fatal && <span role="alert">{fatal}</span>}
    </div>
  );
}

export default WalletConnectButton;
