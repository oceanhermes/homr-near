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

const REFRESH_INTERVAL_MS = 10000;
const LEDGER_REFRESH_INTERVAL_MS = 30000;
const MAX_RETRIES = 1;

const RESOURCE_LABEL = {
  vault: 'vault data',
  loans: 'loan data',
  auction: 'auction data',
  recentEvents: 'the event ledger',
};

/**
 * Turns a transport failure into a message the UI can show as-is.
 * `error.code` comes from `NearRpcError` in `near/rpc.js`.
 */
export function describeProtocolError(resource, error) {
  const label = RESOURCE_LABEL[resource] || 'contract data';
  const detail = error?.message || 'Unknown error';
  if (error?.code === 'CONTRACT_UNAVAILABLE') {
    return `Failed to load ${label}. The contract is not deployed on NEAR ${NEAR_CONFIG.networkId} yet. (${detail})`;
  }
  if (error?.code === 'RATE_LIMITED') {
    return `Failed to load ${label}. The NEAR RPC is rate limiting reads, so polling is paused. Press retry in a moment. (${detail})`;
  }
  return `Failed to load ${label}. ${detail}`;
}

/**
 * Retrying a rate-limited or undeployed contract read only deepens the
 * problem: the breaker already failed it fast, so let the query settle into
 * its error state and wait for an explicit user retry.
 */
function shouldRetry(failureCount, error) {
  if (error?.code === 'RATE_LIMITED' || error?.code === 'CONTRACT_UNAVAILABLE') return false;
  if (/rate limit|too many requests|429/i.test(error?.message || '')) return false;
  return failureCount < MAX_RETRIES;
}

function toProtocolError(resource, error) {
  const wrapped = new Error(describeProtocolError(resource, error));
  wrapped.code = error?.code || 'RPC_FAILED';
  wrapped.cause = error;
  return wrapped;
}

export function useProtocolQuery(resource, personal = false) {
  const { accountId } = useNearWallet();
  const protocol = useMemo(() => createProtocol(accountId, null), [accountId]);
  const interval = resource === 'recentEvents' ? LEDGER_REFRESH_INTERVAL_MS : REFRESH_INTERVAL_MS;

  return useQuery({
    queryKey: [...protocolKey, resource, personal ? accountId || null : null],
    queryFn: async () => {
      try {
        return await protocol[resource](personal ? accountId : undefined);
      } catch (error) {
        throw toProtocolError(resource, error);
      }
    },
    staleTime: 5000,
    // Poll only while healthy. Once a read fails the interval stops, so a 429
    // or a missing contract cannot turn into an endless refetch loop; the
    // Retry button calls `refetch()` and re-arms polling on success.
    refetchInterval: (query) => (query.state.status === 'error' ? false : interval),
    refetchOnWindowFocus: false,
    // Without this, React Query parks the retry in `fetchStatus: 'paused'`
    // while the tab is in the background, which leaves the dashboard on its
    // loading skeleton forever instead of showing the error.
    networkMode: 'always',
    retry: shouldRetry,
    // A query that already failed must not refetch just because the component
    // remounted — that is how a failing read becomes a request storm.
    retryOnMount: false,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
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
