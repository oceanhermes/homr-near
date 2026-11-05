import React, { useEffect, useState } from 'react';
import { useAccount } from 'wagmi';
import AppLayout from '../components/layout/AppLayout';
import {
  EmptyState,
  Field,
  Metric,
  MetricGrid,
  Notice,
  PageIntro,
  Panel,
  PrimarySummary,
  SummaryGrid
} from '../components/layout/DashboardPrimitives';
import InboxRow from '../components/ui/InboxRow';
import TransparencyLedger from '../components/transparency/TransparencyLedger';
import { useVault } from '../hooks/useVault';
import { useLoanManager } from '../hooks/useLoanManager';
import ChainStatus from '../components/layout/ChainStatus';

const investorNavigation = [
  { id: 'overview', icon: 'overview', label: 'Overview', meta: 'Position', group: 'Portfolio' },
  { id: 'capital', icon: 'capital', label: 'Capital', meta: 'Deposit / redeem', group: 'Portfolio' },
  { id: 'investments', icon: 'investments', label: 'Investments', meta: 'Loans', group: 'Investments' },
  { id: 'activity', icon: 'activity', label: 'History', meta: 'Audit trail', group: 'Records' }
];

export function InvestorDashboard() {
  const {
    tvl,
    sharePrice,
    deployedCapital,
    availableCapital,
    userShares,
    userDeposited,
    estimatedApy,
    deposit,
    withdraw, isLoading, error, refresh, progress
  } = useVault();
  const { loans, isLoading: loansLoading, error: loansError, refresh: refreshLoans } = useLoanManager();

  const [activeSection, setActiveSection] = useState('overview');
  const [capitalAction, setCapitalAction] = useState('deposit');
  const [depositAmount, setDepositAmount] = useState('');
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [statusMsg, setStatusMsg] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const { address } = useAccount();
  useEffect(() => { setStatusMsg(null); }, [address]);

  const handleDepositSubmit = async (event) => {
    event.preventDefault();
    const value = parseFloat(depositAmount);
    if (Number.isNaN(value) || value <= 0) {
      setStatusMsg({ type: 'error', text: 'Deposit amount must be greater than 0.' });
      return;
    }
    setIsProcessing(true);
    setStatusMsg({ type: 'info', text: 'Processing deposit...' });
    try {
      await deposit(depositAmount);
      setStatusMsg({ type: 'success', text: `Deposited ${value} mUSDC into the vault.` });
      setDepositAmount('');
    } catch (error) {
      setStatusMsg({ type: 'error', text: error.message || 'Deposit failed.' });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleWithdrawSubmit = async (event) => {
    event.preventDefault();
    const value = parseFloat(withdrawAmount);
    if (Number.isNaN(value) || value <= 0) {
      setStatusMsg({ type: 'error', text: 'Redemption shares must be greater than 0.' });
      return;
    }
    setIsProcessing(true);
    setStatusMsg({ type: 'info', text: 'Processing share redemption...' });
    try {
      await withdraw(withdrawAmount);
      setStatusMsg({ type: 'success', text: `Redeemed ${value} hvSHARE.` });
      setWithdrawAmount('');
    } catch (error) {
      setStatusMsg({ type: 'error', text: error.message || 'Redemption failed.' });
    } finally {
      setIsProcessing(false);
    }
  };

  const activeLoans = loans.filter((loan) => loan.isActive);
  const hasPosition = parseFloat(String(userShares).replace(/,/g, '')) > 0;
  const money = (value) => /^\d/.test(String(value)) ? `$${value}` : value;
  const loanDataUnavailable = loansLoading || Boolean(loansError);

  return (
    <AppLayout
      roleLabel="Investor"
      navItems={investorNavigation}
      activeSection={activeSection}
      onSectionChange={setActiveSection}
      workflowLabel={hasPosition ? 'Capital deployed' : 'Ready to fund'}
      workflowDetail={hasPosition ? 'Monitor active loans and repayment activity.' : 'Deposit mUSDC to mint your first vault shares.'}
    >
      <ChainStatus loading={isLoading || loansLoading} error={error || loansError} refresh={() => { refresh(); refreshLoans(); }} progress={progress} />
      {activeSection === 'overview' && (
        <>
          <PageIntro
            eyebrow="Investor workspace"
            title="Portfolio overview"
            description="Your vault position, capital allocation, and the next action that needs attention."
            chipType="onchain"
          />

          <SummaryGrid>
            <PrimarySummary eyebrow="Your portfolio" value={money(userDeposited)} unit="mUSDC invested" detail={/^\d/.test(String(userShares)) ? `${userShares} hvSHARE at $${sharePrice} per share` : 'Connect a wallet to read your vault position.'} />
            <Metric label="Available capital" value={money(availableCapital)} unit="USDC in vault" tone="success" />
            <Metric label="Active positions" value={loanDataUnavailable ? 'Unavailable' : activeLoans.length} unit="funded loans" />
            <Metric label="Projected APY" value={estimatedApy} unit="Contract does not accrue interest" tone="warning" />
          </SummaryGrid>

          <div className="dashboard-split dashboard-split--wide">
            <Panel title="Active portfolio" description="The loans currently carrying deployed vault capital." chipType="onchain">
              {loanDataUnavailable ? <p>Waiting for loan data.</p> : activeLoans.length === 0 ? (
                <EmptyState title="No active investments" detail="Funded loans will appear after an auction is finalized." />
              ) : (
                <div className="dashboard-row-list">
                  {activeLoans.slice(0, 3).map((loan) => (
                    <InboxRow key={loan.id} statusDotColor="var(--badge-success)" title={`Loan #${loan.id} · $${loan.principal}`} subtitle={`${loan.rate}% APR · ${loan.term} months`} dataType="onchain" customRight={<span className="dashboard-row-status">{loan.maturityDate || 'Maturity not recorded'}</span>} />
                  ))}
                </div>
              )}
              <div className="dashboard-inline-stats">
                <span><small>Vault TVL</small><strong>{money(tvl)}</strong></span>
                <span><small>Deployed</small><strong>{money(deployedCapital)}</strong></span>
              </div>
            </Panel>

            <Panel title="Recommended next action" description="Based on the current portfolio state." className="dashboard-panel--accent">
              <p className="dashboard-action-copy">
                {hasPosition
                  ? 'Review the active investments funded by the vault and monitor their maturity status.'
                  : 'Add capital to the vault to mint hvSHARE and participate in loan allocation.'}
              </p>
              <button className="dashboard-primary-button" type="button" onClick={() => setActiveSection(hasPosition ? 'investments' : 'capital')}>
                {hasPosition ? 'Review active investments' : 'Open capital actions'}
              </button>
            </Panel>
          </div>
        </>
      )}

      {activeSection === 'capital' && (
        <>
          <PageIntro
            eyebrow="Portfolio / capital"
            title="Capital actions"
            description="Deposit mUSDC into the vault or redeem the shares already in your wallet."
            chipType="onchain"
          />

          <div className="dashboard-split">
            <Panel title="Your vault balance" description="Current position before this transaction.">
              <MetricGrid compact>
                <Metric label="Position value" value={userDeposited} unit="mUSDC" />
                <Metric label="Share balance" value={userShares} unit="hvSHARE" tone="accent" />
              </MetricGrid>
            </Panel>

            <Panel title="Submit transaction" description="Choose one action. Only its relevant form is shown.">
              <div className="dashboard-tabs" role="tablist" aria-label="Capital action">
                <button type="button" role="tab" aria-selected={capitalAction === 'deposit'} className={capitalAction === 'deposit' ? 'is-active' : ''} onClick={() => setCapitalAction('deposit')}>Deposit capital</button>
                <button type="button" role="tab" aria-selected={capitalAction === 'withdraw'} className={capitalAction === 'withdraw' ? 'is-active' : ''} onClick={() => setCapitalAction('withdraw')}>Redeem shares</button>
              </div>

              {statusMsg && <Notice type={statusMsg.type}>{statusMsg.text}</Notice>}

              {capitalAction === 'deposit' ? (
                <form key="deposit" className="dashboard-form dashboard-tab-panel" onSubmit={handleDepositSubmit}>
                  <Field label="Deposit amount (mUSDC)">
                    <input type="number" step="any" value={depositAmount} onChange={(event) => setDepositAmount(event.target.value)} placeholder="10000" />
                  </Field>
                  <button className="dashboard-secondary-button dashboard-quick-value" type="button" onClick={() => setDepositAmount('10000')}>Use 10,000 mUSDC</button>
                  <button className="dashboard-primary-button" type="submit" disabled={isProcessing}>{isProcessing ? 'Confirming...' : 'Deposit and mint shares'}</button>
                </form>
              ) : (
                <form key="withdraw" className="dashboard-form dashboard-tab-panel" onSubmit={handleWithdrawSubmit}>
                  <Field label="Shares to redeem (hvSHARE)">
                    <input type="number" step="any" value={withdrawAmount} onChange={(event) => setWithdrawAmount(event.target.value)} placeholder="5000" />
                  </Field>
                  <button className="dashboard-primary-button" type="submit" disabled={isProcessing}>{isProcessing ? 'Processing...' : 'Request share redemption'}</button>
                </form>
              )}
            </Panel>
          </div>
        </>
      )}

      {activeSection === 'investments' && (
        <>
          <PageIntro
            eyebrow="Investments"
            title="Active investments"
            description="Loans currently funded by the shared housing credit vault."
            chipType="onchain"
          />
          <Panel title="Funded loan portfolio" description="Active principal, rate, term, and maturity status.">
            {loanDataUnavailable ? <p>Waiting for loan data.</p> : activeLoans.length === 0 ? (
              <EmptyState title="No active investments" detail="Funded loans will appear here after an auction is finalized." />
            ) : (
              <div className="dashboard-row-list">
                {activeLoans.map((loan) => (
                  <InboxRow
                    key={loan.id}
                    statusDotColor="var(--badge-success)"
                    title={`Loan #${loan.id} · ${loan.borrower.slice(0, 8)}...`}
                    subtitle={`Principal $${loan.principal} · ${loan.rate}% APR · ${loan.term} months`}
                    dataType="onchain"
                    customRight={<span className="dashboard-row-status">{loan.maturityDate ? `Matures ${loan.maturityDate}` : 'Maturity not recorded'}</span>}
                  />
                ))}
              </div>
            )}
          </Panel>
        </>
      )}

      {activeSection === 'activity' && (
        <>
          <PageIntro eyebrow="Records" title="Transaction history" description="Contract events and verifiable activity associated with the platform workflow." />
          <TransparencyLedger embedded />
        </>
      )}
    </AppLayout>
  );
}

export default InvestorDashboard;
