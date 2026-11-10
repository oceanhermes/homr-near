import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { setupWalletSelector } from '@near-wallet-selector/core';
import { setupMyNearWallet } from '@near-wallet-selector/my-near-wallet';
import { setupHereWallet } from '@near-wallet-selector/here-wallet';
import { setupModal } from '@near-wallet-selector/modal-ui';
import '@near-wallet-selector/modal-ui/styles.css';
import { CHAIN_CONFIG, NEAR_CONFIG } from '../contracts/addresses';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

/**
 * NEAR Wallet Selector provider.
 *
 * Replaces the previous wagmi/EVM provider. It exposes the same convenience
 * surface the dashboards already consume (`useAccount`, `useConnect`,
 * `useDisconnect`) plus the raw selector for submitting transactions through
 * `signAndSendTransaction`.
 */
export const NearWalletContext = createContext({
  account: null,
  address: null,
  isConnected: false,
  isConnecting: false,
  ready: false,
  error: null,
  selector: null,
  modal: null,
  connect: () => {},
  disconnect: () => {},
  signAndSendTransaction: async () => {
    throw new Error('NEAR wallet is not ready yet.');
  },
  network: NEAR_CONFIG.networkId,
});

export function useNearWallet() {
  return useContext(NearWalletContext);
}

/** Backwards-compatible shape used by the dashboards. */
export function useAccount() {
  const { account, accountId, isConnected } = useContext(NearWalletContext);
  return {
    address: accountId || account,
    account: accountId || account,
    isConnected,
    chain: { id: CHAIN_CONFIG.chainId, name: CHAIN_CONFIG.chainName },
  };
}

export function useConnect() {
  const { connect, error, isConnecting, ready } = useContext(NearWalletContext);
  return {
    connect: () => connect(),
    connectors: ready ? [{ id: 'near-wallet-selector', name: 'NEAR Wallet Selector' }] : [],
    error,
    isPending: isConnecting,
  };
}

export function useDisconnect() {
  const { disconnect } = useContext(NearWalletContext);
  return { disconnect };
}

export function NearWalletProvider({ children }) {
  const [selector, setSelector] = useState(null);
  const [modal, setModal] = useState(null);
  const [accountId, setAccountId] = useState(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    let subscription = null;

    (async () => {
      try {
        const instance = await setupWalletSelector({
          network: NEAR_CONFIG.networkId,
          debug: false,
          modules: [setupMyNearWallet(), setupHereWallet()],
        });
        if (cancelled) return;

        const modalInstance = setupModal(instance, {
          contractId: NEAR_CONFIG.contractId,
          description: 'Connect a NEAR wallet to deposit, bid, and repay on HOMR.',
        });

        const sync = () => {
          const state = instance.store.getState();
          const active = state.accounts.find((entry) => entry.active);
          setAccountId(active ? active.accountId : null);
        };

        sync();
        subscription = instance.store.observable.subscribe(sync);

        setSelector(instance);
        setModal(modalInstance);
        setReady(true);
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause : new Error('NEAR wallet selector failed to initialise.'));
      }
    })();

    return () => {
      cancelled = true;
      if (subscription) subscription.unsubscribe();
    };
  }, []);

  const connect = useCallback(async () => {
    setError(null);
    if (!modal) {
      const message = 'The NEAR wallet selector is still loading. Try again in a moment.';
      setError(new Error(message));
      throw new Error(message);
    }
    setIsConnecting(true);
    try {
      await modal.show();
    } finally {
      setIsConnecting(false);
    }
  }, [modal]);

  const disconnect = useCallback(async () => {
    if (!selector) return;
    try {
      const wallet = await selector.wallet();
      await wallet.signOut();
      setAccountId(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error('Could not disconnect the NEAR wallet.'));
    }
  }, [selector]);

  const signAndSendTransaction = useCallback(async (params) => {
    if (!selector) throw new Error('The NEAR wallet selector is still loading.');
    const wallet = await selector.wallet();
    return wallet.signAndSendTransaction(params);
  }, [selector]);

  const value = useMemo(() => ({
    account: accountId,
    accountId,
    address: accountId,
    isConnected: Boolean(accountId),
    isConnecting,
    ready,
    error,
    selector,
    modal,
    connect,
    disconnect,
    signAndSendTransaction,
    network: NEAR_CONFIG.networkId,
  }), [accountId, isConnecting, ready, error, selector, modal, connect, disconnect, signAndSendTransaction]);

  return (
    <NearWalletContext.Provider value={value}>
      <QueryClientProvider client={queryClient}>
        {children}
        <div id="near-wallet-selector-modal" />
      </QueryClientProvider>
    </NearWalletContext.Provider>
  );
}

export default NearWalletProvider;
