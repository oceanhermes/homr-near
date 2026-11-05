import { useProtocolQuery, useProtocolTransaction } from './useProtocol';

export function useAuction() {
  const query = useProtocolQuery('auction', true);
  const { transact, progress, refresh } = useProtocolTransaction();
  return {
    ...(query.data || { state: 'Unavailable', bids: [], userApproval: null }),
    isLoading: query.isPending, error: query.error, refresh, progress,
    commitBid: (input) => transact('commitBid', input),
    revealBid: (input) => transact('revealBid', input),
    approveBorrower: (...args) => transact('approveBorrower', ...args),
    startAuction: (...args) => transact('startAuction', ...args),
    finalizeAuction: () => transact('finalizeAuction')
  };
}

export default useAuction;
