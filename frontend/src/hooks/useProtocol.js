import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTransactionState } from '../context/TransactionContext';
import { useNearWallet } from '../context/NearWalletProvider';
import { NEAR_CONFIG, CONTRACT_ADDRESSES } from '../contracts/addresses';
import { createProtocol } from '../contracts/protocol';

export const protocolKey = [
  'protocol',
  NEAR_CONFIG.networkId,
  ...Object.values(CONTRACT_ADDRESSES),
];

export function useProtocolQuery(resource, personal = false) {
  const { accountId } = useNearWallet();
  const protocol = useMemo(() => createProtocol(accountId, null), [accountId]);
  return useQuery({
    queryKey: [...protocolKey, resource, personal ? accountId || null : null],
    queryFn: () => protocol[resource](personal ? accountId : undefined),
    staleTime: 5000,
    refetchInterval: resource === 'recentEvents' ? 30000 : 10000,
    retry: 1,
  });
}

export function useProtocolTransaction() {
  const { isTransacting, setIsTransacting } = useTransactionState();
  const { accountId, isConnected, ready, signAndSendTransaction } = useNearWallet();
  const cache = useQueryClient();
  const [progress, setProgress] = useState('');

  const transact = async (action, ...args) => {
    if (isTransacting) throw new Error('Wait for the current transaction to finish.');
    if (!ready) throw new Error('The NEAR wallet selector is still loading.');
    if (!isConnected || !accountId) throw new Error('Connect your NEAR wallet to submit a transaction.');

    setIsTransacting(true);
    try {
      const signer = { signAndSendTransaction };
      const protocol = createProtocol(accountId, signer, setProgress);
      const hash = await protocol.actions(accountId, signer, setProgress)[action](...args);
      await cache.invalidateQueries({ queryKey: protocolKey });
      return hash;
    } finally {
      setProgress('');
      setIsTransacting(false);
    }
  };

  return { transact, progress, refresh: () => cache.invalidateQueries({ queryKey: protocolKey }) };
}
