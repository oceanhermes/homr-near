import React from 'react';
import { defineChain } from 'viem';
import { createConfig, http, WagmiProvider } from 'wagmi';
import { bscTestnet, localhost } from 'wagmi/chains';
import { injected } from 'wagmi/connectors';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CHAIN_CONFIG } from '../contracts/addresses';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1
    }
  }
});

const auroraTestnet = defineChain({
  id: 1313161555,
  name: 'Aurora Testnet',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['https://testnet.aurora.dev'] } },
  blockExplorers: { default: { name: 'AuroraScan', url: 'https://testnet.aurorascan.dev' } },
});

const chain = CHAIN_CONFIG.chainId === 31337
  ? { ...localhost, id: 31337 }
  : CHAIN_CONFIG.chainId === 1313161555
    ? auroraTestnet
    : bscTestnet;
if (![97, 1313161555, 31337].includes(CHAIN_CONFIG.chainId)) {
  throw new Error('Supported chains: BNB Testnet (97), Aurora Testnet (1313161555), and local development (31337).');
}

const config = createConfig({
  chains: [chain],
  connectors: [injected()],
  transports: {
    [chain.id]: http(CHAIN_CONFIG.rpcUrl, { timeout: 15000, retryCount: 1 })
  }
});

export function Web3Provider({ children }) {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    </WagmiProvider>
  );
}

export default Web3Provider;
