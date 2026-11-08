import React, { createContext, useContext, useState, useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NEAR_CONFIG, CHAIN_CONFIG } from '../contracts/addresses';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

export const NearWalletContext = createContext({
  account: null,
  address: null,
  isConnected: false,
  connect: () => {},
  disconnect: () => {},
  network: NEAR_CONFIG.networkId,
});

export function useAccount() {
  const { account, isConnected } = useContext(NearWalletContext);
  return {
    address: account,
    account,
    isConnected,
    chain: { id: CHAIN_CONFIG.chainId, name: CHAIN_CONFIG.chainName },
  };
}

export function useConnect() {
  const { connect } = useContext(NearWalletContext);
  return { connect, connectors: [{ id: 'my-near-wallet', name: 'MyNearWallet' }] };
}

export function useDisconnect() {
  const { disconnect } = useContext(NearWalletContext);
  return { disconnect };
}

export function Web3Provider({ children }) {
  const [account, setAccount] = useState(() => {
    return localStorage.getItem('homr_near_account') || null;
  });

  const connect = (accountId) => {
    const acc = typeof accountId === 'string' && accountId ? accountId : 'investor.homr.testnet';
    setAccount(acc);
    localStorage.setItem('homr_near_account', acc);
  };

  const disconnect = () => {
    setAccount(null);
    localStorage.removeItem('homr_near_account');
  };

  const value = {
    account,
    address: account,
    isConnected: Boolean(account),
    connect,
    disconnect,
    network: NEAR_CONFIG.networkId,
  };

  return (
    <NearWalletContext.Provider value={value}>
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    </NearWalletContext.Provider>
  );
}

export default Web3Provider;
