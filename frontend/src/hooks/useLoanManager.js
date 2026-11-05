import { useAccount } from 'wagmi';
import { sameAddress } from '../contracts/protocol';
import { useProtocolQuery, useProtocolTransaction } from './useProtocol';

export function useLoanManager({ borrowerOnly = false } = {}) {
  const { address } = useAccount();
  const query = useProtocolQuery('loans');
  const { transact, progress } = useProtocolTransaction();
  const loans = query.data?.loans || [];
  return {
    loans: borrowerOnly ? loans.filter((loan) => sameAddress(loan.borrower, address)) : loans,
    nextLoanId: query.data?.nextLoanId,
    isLoading: query.isPending, error: query.error, refresh: query.refetch, progress,
    repayLoan: (id) => transact('repayLoan', id)
  };
}

export default useLoanManager;
