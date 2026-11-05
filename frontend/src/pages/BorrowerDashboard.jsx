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
  SummaryGrid,
  Workflow
} from '../components/layout/DashboardPrimitives';
import InboxRow from '../components/ui/InboxRow';
import TransparencyLedger from '../components/transparency/TransparencyLedger';
import { useAuction } from '../hooks/useAuction';
import { useLoanManager } from '../hooks/useLoanManager';
import { createApplication, fetchApplications } from '../api/client';
import ApplicationHistory from '../components/borrower/ApplicationHistory';
import { bidValues, parseAmount } from '../contracts/protocol';
import { CHAIN_CONFIG, CONTRACT_ADDRESSES } from '../contracts/addresses';
import ChainStatus from '../components/layout/ChainStatus';

const borrowerNavigation = [
  { id: 'overview', icon: 'overview', label: 'Overview', meta: 'Status', group: 'Your financing' },
  { id: 'credit', icon: 'property', label: 'Property', meta: 'Application', group: 'Your financing' },
  { id: 'auction', icon: 'auction', label: 'Auction', meta: 'Commit / reveal', group: 'Borrowing process' },
  { id: 'loans', icon: 'loan', label: 'Loan', meta: 'Terms', group: 'Loan management' },
  { id: 'repayment', icon: 'repayment', label: 'Repay', meta: 'Payment', group: 'Loan management' },
  { id: 'activity', icon: 'activity', label: 'Activity', meta: 'Audit trail', group: 'Records' }
];

export function BorrowerDashboard() {
  const { state: auctionState, userApproval, commitBid, revealBid, canCommit, canReveal,
    commitDeadline, revealDeadline, commitment, alreadyRevealed, decimals, isLoading, error, refresh, progress } = useAuction();
  const { loans, repayLoan, isLoading: loansLoading, error: loansError, refresh: refreshLoans, progress: repayProgress } = useLoanManager({ borrowerOnly: true });
  const { address } = useAccount();

  const [activeSection, setActiveSection] = useState('overview');
  const [auctionAction, setAuctionAction] = useState('commit');
  const [showAppForm, setShowAppForm] = useState(false);
  const [appName, setAppName] = useState('');
  const [appProperty, setAppProperty] = useState('');
  const [appAmount, setAppAmount] = useState('50000');
  const [appRate, setAppRate] = useState('9.5');
  const [appTerm, setAppTerm] = useState('12');
  const [bidAmount, setBidAmount] = useState('50000');
  const [bidRate, setBidRate] = useState('9.5');
  const [bidTerm, setBidTerm] = useState('12');
  const [bidSalt, setBidSalt] = useState(() => Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, '0')).join(''));
  const [statusMsg, setStatusMsg] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [bidStorageWarning, setBidStorageWarning] = useState('');
  const [applicationRevision, setApplicationRevision] = useState(0);
  const [applicationHistory, setApplicationHistory] = useState({ wallet: null, items: [], status: 'idle' });
  const applicationWallet = address ? address.toLowerCase() : null;
  const applications = applicationWallet && applicationHistory.wallet === applicationWallet ? applicationHistory.items : [];
  const applicationsStatus = !applicationWallet ? 'idle' : applicationHistory.wallet === applicationWallet ? applicationHistory.status : 'loading';
  const applicationsError = applicationHistory.wallet === applicationWallet ? applicationHistory.error : '';
  const refreshApplications = () => setApplicationRevision((revision) => revision + 1);
  const bidStorageKey = address && commitDeadline
    ? `homr-bid:${CHAIN_CONFIG.chainId}:${CONTRACT_ADDRESSES.CreditAuction.toLowerCase()}:${address.toLowerCase()}:${commitDeadline}` : null;

  useEffect(() => {
    setBidAmount('50000'); setBidRate('9.5'); setBidTerm('12');
    setBidSalt(Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, '0')).join(''));
    setBidStorageWarning('');
    if (!bidStorageKey) return;
    try {
      const record = JSON.parse(localStorage.getItem(bidStorageKey) || 'null');
      const saved = record?.entries?.[commitment] || record?.latest;
      if (saved) { setBidAmount(saved.amount); setBidRate(saved.rate); setBidTerm(saved.term); setBidSalt(saved.salt); }
    } catch { setBidStorageWarning('This browser cannot restore your bid. Enter the exact original terms and salt before revealing.'); }
  }, [bidStorageKey, commitment]);

  useEffect(() => { setStatusMsg(null); }, [address]);

  useEffect(() => {
    if (!applicationWallet) {
      setApplicationHistory({ wallet: null, items: [], status: 'idle' });
      return;
    }
    let cancelled = false;
    setApplicationHistory((previous) => ({
      wallet: applicationWallet,
      items: previous.wallet === applicationWallet ? previous.items : [],
      status: 'loading',
    }));
    fetchApplications().then((response) => {
      if (!Array.isArray(response?.applications)) throw new Error('Invalid application history response');
      const items = response.applications
        .filter((application) => application.applicant?.walletAddress?.toLowerCase() === applicationWallet)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      if (!cancelled) setApplicationHistory({ wallet: applicationWallet, items, status: 'ready' });
    }).catch((error) => {
      if (!cancelled) setApplicationHistory((previous) => ({ ...previous, status: 'error', error: error.message }));
    });
    return () => { cancelled = true; };
  }, [applicationWallet, applicationRevision]);

  const activeLoans = loans.filter((loan) => loan.isActive);
  const isApproved = Boolean(userApproval?.isApproved);
  const hasPendingApplication = applications.some((application) => application.status === 'PENDING');
  const workflowStage = activeLoans.length > 0 ? 3 : isApproved ? 2 : hasPendingApplication ? 1 : 0;
  const approvalStatus = isLoading ? 'Loading' : error ? 'Unavailable' : !address ? 'Connect wallet' : isApproved ? 'Approved' : 'Not approved';
  const outstandingPrincipal = activeLoans.reduce((total, loan) => total + parseFloat(String(loan.principal).replace(/,/g, '')), 0);

  const withProcessing = async (loadingText, action, successText, fallbackText) => {
    setIsProcessing(true);
    setStatusMsg({ type: 'info', text: loadingText });
    try {
      await action();
      setStatusMsg({ type: 'success', text: successText });
      return true;
    } catch (error) {
      setStatusMsg({ type: 'error', text: error.message || fallbackText });
      return false;
    } finally {
      setIsProcessing(false);
    }
  };

  const handleApplicationSubmit = async (event) => {
    event.preventDefault();
    const submitted = await withProcessing(
      'Submitting application to the credit database...',
      () => {
        if (!address) throw new Error('Connect your borrower wallet before applying.');
        if (decimals === undefined) throw new Error('Wait for the token configuration to load.');
        return createApplication({
        walletAddress: address,
        displayName: appName,
        propertyHash: appProperty,
        requestedAmount: parseAmount(appAmount, 6).toString(),
        requestedRate: Number(parseAmount(appRate, 2, true)),
        requestedTerm: Number(parseAmount(appTerm, 0)) * 30 * 86400
      }); },
      'Financing application submitted. A Credit Manager will review the property documents.',
      'Application submission failed.'
    );
    if (submitted) {
      setShowAppForm(false);
      refreshApplications();
    }
  };

  const handleCommitSubmit = async (event) => {
    event.preventDefault();
    await withProcessing(
      'Submitting commitment hash onchain...',
      async () => {
        const input = { amount: bidAmount, rate: bidRate, term: bidTerm, salt: bidSalt };
        if (bidStorageKey) {
          const { hash } = bidValues(input, decimals, address);
          try {
            const previous = JSON.parse(localStorage.getItem(bidStorageKey) || '{}');
            localStorage.setItem(bidStorageKey, JSON.stringify({
              entries: { ...previous.entries, [hash]: input }, latest: input
            }));
          }
          catch { throw new Error('Bid could not be saved in this browser. Enable local storage before committing.'); }
        }
        return commitBid(input);
      },
      'Bid commitment submitted.',
      'Commit bid failed.'
    );
  };

  const handleRevealSubmit = async (event) => {
    event.preventDefault();
    await withProcessing(
      'Revealing bid parameters to the auction contract...',
      () => revealBid({ amount: bidAmount, rate: bidRate, term: bidTerm, salt: bidSalt }),
      'Bid parameters revealed and validated.',
      'Reveal bid failed.'
    );
  };

  const handleRepaySubmit = async (event, loanId, principal) => {
    event.preventDefault();
    await withProcessing(
      'Processing principal repayment...',
      () => repayLoan(loanId, principal),
      `Loan #${loanId} repayment submitted.`,
      'Loan repayment failed.'
    );
  };

  const nextAction = !isApproved
    ? hasPendingApplication
      ? { label: 'View submitted application', section: 'credit', detail: 'Your application is awaiting a Credit Manager decision. Check its status in your application history.' }
      : { label: 'Complete credit application', section: 'credit', detail: 'Submit the property reference and requested financing terms for review.' }
    : auctionState === 'CommitPhase'
      ? { label: 'Commit borrowing bid', section: 'auction', detail: 'Your credit is approved. Commit your bid before the current window closes.' }
      : auctionState === 'RevealPhase'
        ? { label: 'Reveal borrowing bid', section: 'auction', detail: 'Reveal the exact values used in your commitment for contract validation.' }
        : { label: 'Review active loan', section: 'loans', detail: 'The auction is finalized. Review the resulting loan terms and repayment status.' };

  return (
    <AppLayout
      roleLabel="Borrower"
      navItems={borrowerNavigation}
      activeSection={activeSection}
      onSectionChange={setActiveSection}
      workflowLabel={isApproved ? auctionState : 'Credit review'}
      workflowDetail={nextAction.detail}
    >
      <ChainStatus loading={isLoading || loansLoading} error={error || loansError} refresh={() => { refresh(); refreshLoans(); }} progress={progress || repayProgress} />
      {statusMsg && <Notice type={statusMsg.type}>{statusMsg.text}</Notice>}

      {activeSection === 'overview' && (
        <>
          <PageIntro
            eyebrow="Borrower workspace"
            title="Loan overview"
            description="A focused view of your approval, borrowing stage, active financing, and next required action."
            chipType="onchain"
          />

          <SummaryGrid>
            <PrimarySummary eyebrow="Approved borrowing limit" value={isApproved ? `$${userApproval.maxPrincipal}` : approvalStatus} unit={isApproved ? 'mUSDC available for auction' : 'Onchain approval status'} detail={userApproval?.propertyHash || 'No approved property reference loaded'} />
            <Metric label="Outstanding" value={loansLoading || loansError ? 'Unavailable' : !address ? 'Connect wallet' : `$${outstandingPrincipal.toLocaleString('en-US', { minimumFractionDigits: 2 })}`} unit="active principal" />
            <Metric label="Auction phase" value={auctionState} unit="current cycle" tone="accent" />
            <Metric label="Property approval" value={approvalStatus} unit="recorded approval" tone={isApproved ? 'success' : 'warning'} />
          </SummaryGrid>

          <div className="dashboard-split dashboard-split--wide">
            <Panel title="Financing progress" description="Completed stages and the step currently in progress.">
              <Workflow
                current={workflowStage}
                steps={[
                  { label: 'Submit application', detail: 'Send borrower and property information for review.' },
                  { label: 'Credit assessment', detail: 'Property and credit limit are verified offchain.' },
                  { label: 'Borrowing auction', detail: 'Approved terms are committed and revealed onchain.' },
                  { label: 'Active loan', detail: 'Allocated principal becomes an active loan.' },
                  { label: 'Repayment complete', detail: 'Principal returns to the shared vault.' }
                ]}
              />
            </Panel>

            <Panel title="Recommended next action" description="The most relevant action for the current stage." className="dashboard-panel--accent">
              <p className="dashboard-action-copy">{nextAction.detail}</p>
              <button className="dashboard-primary-button" type="button" onClick={() => {
                if (nextAction.section === 'auction') setAuctionAction(auctionState === 'RevealPhase' ? 'reveal' : 'commit');
                setActiveSection(nextAction.section);
              }}>
                {nextAction.label}
              </button>
            </Panel>
          </div>
        </>
      )}

      {activeSection === 'credit' && (
        <>
          <PageIntro
            eyebrow="Financing / credit"
            title="Credit & property"
            description="Review the property reference, approval status, and financing request kept in the offchain credit workflow."
            chipType="offchain"
            chipLabel="Private review"
            action={<button className="dashboard-primary-button" type="button" onClick={() => setShowAppForm((value) => !value)}>{showAppForm ? 'Close application' : 'Submit new application'}</button>}
          />

          <Panel title="Credit approval" description="Only the approval result and property reference move into the auction workflow." chipType={isApproved ? 'onchain' : 'pending'}>
            <MetricGrid compact>
              <Metric label="Approval status" value={approvalStatus} tone={isApproved ? 'success' : 'warning'} />
              <Metric label="Maximum principal" value={isApproved ? `$${userApproval.maxPrincipal}` : 'Not available'} unit="mUSDC" />
              <Metric label="Property reference" value={userApproval?.propertyHash || 'No approved reference'} detail="Reference recorded with approval" />
            </MetricGrid>
          </Panel>

          {showAppForm && (
            <Panel title="Financing application" description="Submit the existing application fields for Credit Manager review." chipType="offchain" chipLabel="Credit database">
              <form className="dashboard-form" onSubmit={handleApplicationSubmit}>
                <div className="dashboard-form-grid dashboard-form-grid--two">
                  <Field label="Applicant full name"><input type="text" value={appName} onChange={(event) => setAppName(event.target.value)} /></Field>
                  <Field label="Property / deed reference"><input type="text" value={appProperty} onChange={(event) => setAppProperty(event.target.value)} /></Field>
                </div>
                <div className="dashboard-form-grid dashboard-form-grid--three">
                  <Field label="Requested principal (mUSDC)"><input type="number" value={appAmount} onChange={(event) => setAppAmount(event.target.value)} /></Field>
                  <Field label="Requested rate (% APR)"><input type="number" step="0.1" value={appRate} onChange={(event) => setAppRate(event.target.value)} /></Field>
                  <Field label="Requested term (months)"><input type="number" value={appTerm} onChange={(event) => setAppTerm(event.target.value)} /></Field>
                </div>
                <button className="dashboard-primary-button" type="submit" disabled={isProcessing}>{isProcessing ? 'Submitting...' : 'Submit for credit review'}</button>
              </form>
            </Panel>
          )}
          <ApplicationHistory applications={applications} status={applicationsStatus} error={applicationsError} address={address} onRefresh={refreshApplications} />
        </>
      )}

      {activeSection === 'auction' && (
        <>
          <PageIntro
            eyebrow="Borrowing process"
            title="Borrowing auction"
            description="Commit private bid terms first, then reveal those same values during the reveal window."
            chipType="onchain"
            chipLabel={`Phase: ${auctionState}`}
          />

          <Panel title="Auction action" description="Only the selected phase form is visible.">
            {commitDeadline && <Notice>Commit deadline: {new Date(commitDeadline).toLocaleString()}. Reveal deadline: {new Date(revealDeadline).toLocaleString()}.</Notice>}
            {alreadyRevealed && <Notice>This contract retains your previous reveal. This wallet cannot reveal another bid, even in a later cycle.</Notice>}
            {bidStorageWarning && <Notice type="error">{bidStorageWarning}</Notice>}
            <div className="dashboard-tabs" role="tablist" aria-label="Auction action">
              <button type="button" role="tab" aria-selected={auctionAction === 'commit'} className={auctionAction === 'commit' ? 'is-active' : ''} onClick={() => setAuctionAction('commit')}>1. Commit bid</button>
              <button type="button" role="tab" aria-selected={auctionAction === 'reveal'} className={auctionAction === 'reveal' ? 'is-active' : ''} onClick={() => setAuctionAction('reveal')}>2. Reveal terms</button>
            </div>

            {auctionAction === 'commit' ? (
              <form key="commit" className="dashboard-form dashboard-tab-panel" onSubmit={handleCommitSubmit}>
                <Notice>Keep a private copy of these terms and salt. They are saved in this browser before committing; clearing browser data removes them.</Notice>
                <div className="dashboard-form-grid dashboard-form-grid--three">
                  <Field label="Principal amount (mUSDC)"><input type="number" value={bidAmount} onChange={(event) => setBidAmount(event.target.value)} /></Field>
                  <Field label="Interest rate (% APR)"><input type="number" step="0.1" value={bidRate} onChange={(event) => setBidRate(event.target.value)} /></Field>
                  <Field label="Term (months)"><input type="number" value={bidTerm} onChange={(event) => setBidTerm(event.target.value)} /></Field>
                </div>
                <Field label="Secret salt phrase"><input type="text" value={bidSalt} onChange={(event) => setBidSalt(event.target.value)} /></Field>
                <button className="dashboard-primary-button" type="submit" disabled={isProcessing || !canCommit}>{isProcessing ? 'Committing...' : 'Commit bid hash'}</button>
              </form>
            ) : (
              <form key="reveal" className="dashboard-form dashboard-tab-panel" onSubmit={handleRevealSubmit}>
                <Field label="Original principal (mUSDC)"><input value={bidAmount} onChange={(event) => setBidAmount(event.target.value)} /></Field>
                <Field label="Original rate (% APR)"><input value={bidRate} onChange={(event) => setBidRate(event.target.value)} /></Field>
                <Field label="Original term (months)"><input value={bidTerm} onChange={(event) => setBidTerm(event.target.value)} /></Field>
                <Field label="Original secret salt"><input value={bidSalt} onChange={(event) => setBidSalt(event.target.value)} /></Field>
                <div className="dashboard-review-list">
                  <span><small>Amount</small><strong>${bidAmount} mUSDC</strong></span>
                  <span><small>Rate</small><strong>{bidRate}% APR</strong></span>
                  <span><small>Term</small><strong>{bidTerm} months</strong></span>
                </div>
                <button className="dashboard-primary-button" type="submit" disabled={isProcessing || !canReveal}>{isProcessing ? 'Verifying...' : 'Reveal and verify bid'}</button>
              </form>
            )}
          </Panel>
        </>
      )}

      {activeSection === 'loans' && (
        <>
          <PageIntro eyebrow="Loan management" title="Active loan" description="Review principal, borrowing terms, collateral reference, and maturity for each active loan." chipType="onchain" />
          <Panel title="Current financing" description="Loans created after auction allocation.">
            {loansLoading || loansError ? <p>Waiting for loan data.</p> : activeLoans.length === 0 ? (
              <EmptyState title="No active loan" detail="An active loan will appear after your borrowing auction is finalized." />
            ) : (
              <div className="dashboard-row-list">
                {activeLoans.map((loan) => (
                  <InboxRow key={loan.id} statusDotColor="var(--badge-success)" title={`Active loan #${loan.id}`} subtitle={`Principal $${loan.principal} · ${loan.rate}% APR · ${loan.term} months · Collateral ${loan.propertyHash}`} dataType="onchain" customRight={<span className="dashboard-row-status">{loan.maturityDate ? `Matures ${loan.maturityDate}` : 'Maturity not recorded'}</span>} />
                ))}
              </div>
            )}
          </Panel>
        </>
      )}

      {activeSection === 'repayment' && (
        <>
          <PageIntro eyebrow="Loan management" title="Repayment" description="Select an active loan and submit principal repayment through the existing Loan Manager flow." chipType="onchain" />
          {loansLoading || loansError ? <p>Waiting for loan data.</p> : activeLoans.length === 0 ? (
            <EmptyState title="Nothing to repay" detail="Repayment becomes available when a loan is active." />
          ) : activeLoans.map((loan) => (
            <Panel key={loan.id} title={`Loan #${loan.id}`} description={`Outstanding principal: $${loan.principal} mUSDC`} chipType="onchain">
              <form className="dashboard-inline-form" onSubmit={(event) => handleRepaySubmit(event, loan.id, loan.principal)}>
                <Field label="Full principal repayment (mUSDC)"><input value={loan.principal} readOnly /></Field>
                <button className="dashboard-primary-button" type="submit" disabled={isProcessing}>{isProcessing ? 'Processing...' : 'Submit repayment'}</button>
              </form>
            </Panel>
          ))}
        </>
      )}

      {activeSection === 'activity' && (
        <>
          <PageIntro eyebrow="Records" title="Activity & proof" description="Approval, auction, and repayment events associated with the financing workflow." />
          <ApplicationHistory applications={applications} status={applicationsStatus} error={applicationsError} address={address} onRefresh={refreshApplications} />
          <TransparencyLedger embedded />
        </>
      )}
    </AppLayout>
  );
}

export default BorrowerDashboard;
