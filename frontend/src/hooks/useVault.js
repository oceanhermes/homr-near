import { useProtocolQuery, useProtocolTransaction } from './useProtocol';

export function useVault() {
  const query = useProtocolQuery('vault', true);
  const { transact, progress } = useProtocolTransaction();
  return {
    ...(query.data || {
      tvl: 'Unavailable', availableCapital: 'Unavailable', deployedCapital: 'Unavailable',
      userShares: 'Unavailable', userDeposited: 'Unavailable', sharePrice: 'Unavailable', estimatedApy: 'Not calculated'
    }),
    isLoading: query.isPending, error: query.error,
    refresh: query.refetch, progress,
    deposit: (amount) => transact('deposit', amount),
    withdraw: (shares) => transact('withdraw', shares)
  };
}
