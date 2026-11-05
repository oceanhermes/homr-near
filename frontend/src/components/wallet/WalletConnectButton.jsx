import React from 'react';
import { useAccount, useConnect, useDisconnect, useSwitchChain } from 'wagmi';
import { useTransactionState } from '../../context/TransactionContext';
import { CHAIN_CONFIG } from '../../contracts/addresses';

export function WalletConnectButton() {
  const { isTransacting } = useTransactionState();
  const { address, isConnected, chainId } = useAccount();
  const { connect, connectors, error, isPending } = useConnect();
  const { switchChain, error: switchError } = useSwitchChain();
  const { disconnect } = useDisconnect();

  return (
    <div className="wallet-controls">
      {isConnected ? (
        <button onClick={() => disconnect()} disabled={isTransacting} className="wallet-account">
          <span className="wallet-control__dot wallet-control__dot--connected" />
          <span>{`${address.slice(0, 6)}...${address.slice(-4)}`}</span>
        </button>
      ) : (
        <button
          onClick={() => {
            if (connectors && connectors.length > 0) {
              connect({ connector: connectors[0] });
            } else {
              alert('No EVM wallet extension found. Install MetaMask or another compatible wallet to connect.');
            }
          }}
          className="wallet-account"
          disabled={isPending}
        >
          {isPending ? 'Connecting...' : 'Connect Wallet'}
        </button>
      )}
      {isConnected && chainId !== CHAIN_CONFIG.chainId && <button type="button" className="wallet-account" onClick={() => switchChain({ chainId: CHAIN_CONFIG.chainId })}>Switch to {CHAIN_CONFIG.chainName}</button>}
      {(error || switchError) && <span role="alert">{(error || switchError).shortMessage || (error || switchError).message}</span>}
    </div>
  );
}

export default WalletConnectButton;
