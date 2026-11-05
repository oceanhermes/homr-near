import { useProtocolQuery } from './useProtocol';

export function useTransparencyEvents() {
  const query = useProtocolQuery('recentEvents');
  return {
    events: query.data?.events || [],
    isLoading: query.isPending, error: query.error,
    refresh: query.refetch, fromBlock: query.data?.fromBlock, toBlock: query.data?.toBlock
  };
}

export default useTransparencyEvents;
