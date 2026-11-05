import { useMemo, useState } from 'react';
import { useAccount, useConfig, usePublicClient, useSwitchChain, useWriteContract } from 'wagmi';
import { getAccount } from 'wagmi/actions';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTransactionState } from '../context/TransactionContext';
import { CHAIN_CONFIG, CONTRACT_ADDRESSES } from '../contracts/addresses';
import { createProtocol, sameAddress } from '../contracts/protocol';

export const protocolKey = ['protocol', CHAIN_CONFIG.chainId, ...Object.values(CONTRACT_ADDRESSES)];

export function useProtocolQuery(resource, personal = false) {
  const { address } = useAccount();
  const client = usePublicClient({ chainId: CHAIN_CONFIG.chainId });
  const protocol = useMemo(() => client && createProtocol(client, CONTRACT_ADDRESSES, CHAIN_CONFIG.chainId), [client]);
  return useQuery({
    queryKey: [...protocolKey, resource, personal ? address?.toLowerCase() || null : null],
    queryFn: () => protocol[resource](personal ? address : undefined),
    enabled: Boolean(protocol),
    staleTime: 5000,
    refetchInterval: resource === 'recentEvents' ? 30000 : 10000,
    retry: 1
  });
}

export function useProtocolTransaction() {
  const { isTransacting, setIsTransacting } = useTransactionState();
  const config = useConfig();
  const { address, isConnected, chainId } = useAccount();
  const client = usePublicClient({ chainId: CHAIN_CONFIG.chainId });
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const cache = useQueryClient();
  const [progress, setProgress] = useState('');
  const transact = async (action, ...args) => {
    if (isTransacting) throw new Error('Wait for the current transaction to finish.');
    if (!isConnected || !address) throw new Error('Connect your wallet to submit a transaction.');
    if (!client) throw new Error('The configured RPC is unavailable.');
    setIsTransacting(true);
    try {
      if (chainId !== CHAIN_CONFIG.chainId) {
        setProgress(`Switch your wallet to ${CHAIN_CONFIG.chainName}.`);
        await switchChainAsync({ chainId: CHAIN_CONFIG.chainId });
      }
      const protocol = createProtocol(client, CONTRACT_ADDRESSES, CHAIN_CONFIG.chainId);
      const hash = await protocol.actions(address, (request) => {
        const current = getAccount(config);
        if (!sameAddress(current.address, address) || current.chainId !== CHAIN_CONFIG.chainId) {
          throw new Error('Wallet or network changed during this action. Please start again.');
        }
        return writeContractAsync({ ...request, chainId: CHAIN_CONFIG.chainId });
      }, setProgress)[action](...args);
      await cache.invalidateQueries({ queryKey: protocolKey });
      return hash;
    } finally { setProgress(''); setIsTransacting(false); }
  };
  return { transact, progress, refresh: () => cache.invalidateQueries({ queryKey: protocolKey }) };
}
