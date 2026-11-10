import React, { useCallback, useEffect, useState } from 'react';
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
import DataLabelChip from '../components/ui/DataLabelChip';
import InboxRow from '../components/ui/InboxRow';
import TransparencyLedger from '../components/transparency/TransparencyLedger';
import { useAuction } from '../hooks/useAuction';
import { useLoanManager } from '../hooks/useLoanManager';
import { fetchApplications, reviewApplication, fetchAdminStatus } from '../api/client';
import { fromRaw } from '../near/contracts';
import { useAccount } from '../context/NearWalletProvider';
import ChainStatus from '../components/layout/ChainStatus';

const adminNavigation = [
  { id: 'overview', icon: 'overview', label: 'Overview', meta: 'Operations', group: 'Operations' },
  { id: 'applications', icon: 'applications', label: 'Applications', meta: 'Review queue', group: 'Credit workflow' },
  { id: 'approvals', icon: 'approvals', label: 'Approvals', meta: 'Onchain limit', group: 'Credit workflow' },
  { id: 'auction', icon: 'auction', label: 'Auction', meta: 'Lifecycle', group: 'Market operations' },
  { id: 'bids', icon: 'bids', label: 'Bids', meta: 'Evaluation', group: 'Market operations' },
  { id: 'loans', icon: 'monitoring', label: 'Loans', meta: 'Active book', group: 'Market operations' },
  { id: 'audit', icon: 'audit', label: 'Audit', meta: 'Event trail', group: 'Administration' }
];

export function AdminPanel() {
  const { state: auctionState, bids, approveBorrower, startAuction, finalizeAuction,
    decimals, canStart, canFinalize, creditManager, isLoading, error, refresh, progress } = useAuction();
  const { loans, isLoading: loansLoading, error: loansError, refresh: refreshLoans } = useLoanManager();

  const [activeSection, setActiveSection] = useState('overview');
  const [borrowerAddress, setBorrowerAddress] = useState('');
  const [maxPrincipal, setMaxPrincipal] = useState('50000');
  const [propertyHash, setPropertyHash] = useState('');
  const [commitDuration, setCommitDuration] = useState('3600');
  const [revealDuration, setRevealDuration] = useState('3600');
  const [statusMsg, setStatusMsg] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [applications, setApplications] = useState([]);
  const [adminStatus, setAdminStatus] = useState(null);
  const [dataStatus, setDataStatus] = useState('loading');
  const { address } = useAccount();
  useEffect(() => { setStatusMsg(null); }, [address]);

  const loadData = useCallback(async () => {
    setDataStatus('loading');
    try {
      const [applicationsResponse, statusResponse] = await Promise.all([
        fetchApplications(),
        fetchAdminStatus().catch(() => null)
      ]);
      if (applicationsResponse?.applications) setApplications(applicationsResponse.applications);
      if (statusResponse) setAdminStatus(statusResponse);
      setDataStatus('ready');
    } catch {
      setDataStatus('error');
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

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

  const handleApproveSubmit = async (event) => {
    event.preventDefault();
    const completed = await withProcessing(
      'Granting credit approval onchain...',
      () => approveBorrower(borrowerAddress, maxPrincipal, propertyHash),
      `Granted a ${maxPrincipal} mUSDC limit to ${borrowerAddress.slice(0, 8)}...`,
      'Approval failed.'
    );
    if (completed) loadData();
  };

  const handleReviewApplication = async (application) => {
    const completed = await withProcessing(
      'Submitting the review decision through the Admin API...',
      () => reviewApplication(application.id, {
        decision: 'APPROVED',
        maxPrincipal: application.requestedAmount.toString(),
        reviewedBy: 'Credit Manager Admin',
        reviewNote: `Approved for property collateral ${application.propertyHash.slice(0, 16)}...`
      }),
      `Application #${application.id.slice(0, 8)} approved.`,
      'Application review failed.'
    );
    if (completed) { loadData(); refresh(); }
  };

  const handleStartAuction = async () => {
    await withProcessing(
      'Starting a new credit auction onchain...',
      () => startAuction(commitDuration, revealDuration),
      'Auction started. The commit phase is active.',
      'Auction start failed.'
    );
  };

  const handleFinalizeAuction = async () => {
    await withProcessing(
      'Finalizing revealed bids and creating the allocated loan...',
      finalizeAuction,
      'Auction finalized. Any funded loan is now available in loan monitoring.',
      'Auction finalization failed.'
    );
  };

  const pendingApplications = applications.filter((application) => application.status === 'PENDING');
  const activeLoans = loans.filter((loan) => loan.isActive);
  const auctionStep = ({ Created: 0, CommitPhase: 1, RevealPhase: 2, AwaitingFinalization: 3, Finalized: 4 })[auctionState] ?? 0;

  const nextAction = pendingApplications.length > 0
    ? { section: 'applications', label: 'Review pending applications', detail: `${pendingApplications.length} application${pendingApplications.length === 1 ? '' : 's'} need a credit decision.` }
    : auctionState === 'RevealPhase'
      ? { section: 'auction', label: 'Review auction controls', detail: 'The reveal phase is active. Finalize only after the phase is complete.' }
      : { section: 'bids', label: 'Monitor current bids', detail: 'Review submitted bids and the current auction state.' };

  const prefillApproval = (application) => {
    setBorrowerAddress(application.applicant?.accountId || '');
    setMaxPrincipal(fromRaw(application.requestedAmount, 6));
    setPropertyHash(application.propertyHash);
    setActiveSection('approvals');
  };

  return (
    <AppLayout
      roleLabel="Credit Manager"
      navItems={adminNavigation}
      activeSection={activeSection}
      onSectionChange={setActiveSection}
      workflowLabel={`Auction: ${auctionState}`}
      workflowDetail={nextAction.detail}
    >
      <ChainStatus loading={isLoading || loansLoading} error={error || loansError} refresh={() => { refresh(); refreshLoans(); }} progress={progress} />
      {!isLoading && !creditManager && <Notice>Onchain credit approval requires a wallet with CREDIT_MANAGER_ROLE. Auction controls require AUCTION_MANAGER_ROLE.</Notice>}
      {statusMsg && <Notice type={statusMsg.type}>{statusMsg.text}</Notice>}

      {activeSection === 'overview' && (
        <>
          <PageIntro
            eyebrow="Credit operations"
            title="Platform overview"
            description="A concise view of the review queue, auction lifecycle, active loan book, and next operational action."
            chipType="onchain"
          />

          {adminStatus && (
      <Notice>Admin signer {adminStatus.adminAddress} · {adminStatus.balanceNative} native token · Chain ID {adminStatus.chainId}</Notice>
          )}

          <SummaryGrid>
            <PrimarySummary eyebrow="Operational queue" value={dataStatus === 'ready' ? pendingApplications.length : dataStatus === 'loading' ? 'Loading' : 'Unavailable'} unit="applications awaiting review" detail={dataStatus === 'ready' ? `${applications.length} total applications in the credit database` : 'Open Applications to check or retry the API connection.'} />
            <Metric label="Auction state" value={auctionState} unit="current lifecycle" tone="accent" />
            <Metric label="Revealed bids" value={isLoading || error ? 'Unavailable' : bids.length} unit="current auction" />
            <Metric label="Active loans" value={loansLoading || loansError ? 'Unavailable' : activeLoans.length} unit="monitored" tone="success" />
          </SummaryGrid>

          <div className="dashboard-split dashboard-split--wide">
            <Panel title="Auction workflow" description="The current cycle and completed phases.">
              <Workflow
                current={auctionStep}
                steps={[
                  { label: 'Configure auction', detail: 'Set commit and reveal durations.' },
                  { label: 'Commit phase', detail: 'Approved borrowers submit sealed commitments.' },
                  { label: 'Reveal phase', detail: 'Borrowers reveal parameters for validation.' },
                  { label: 'Allocation', detail: 'Finalize valid bids and create the winning loan.' }
                ]}
              />
            </Panel>
            <Panel title="Recommended next action" description="The highest-priority operational task." className="dashboard-panel--accent">
              <p className="dashboard-action-copy">{nextAction.detail}</p>
              <button className="dashboard-primary-button" type="button" onClick={() => setActiveSection(nextAction.section)}>{nextAction.label}</button>
            </Panel>
          </div>
        </>
      )}

      {activeSection === 'applications' && (
        <>
          <PageIntro eyebrow="Credit workflow" title="Borrower applications" description="Review financing requests from the offchain credit database before granting an onchain limit." chipType="offchain" chipLabel="Private review queue" />
          <Panel title="Application queue" description="Application details remain offchain until a separate credit approval is granted.">
            {dataStatus === 'loading' ? (
              <Notice>Loading applications...</Notice>
            ) : dataStatus === 'error' ? (
              <Notice type="error">Applications could not be loaded. <button type="button" className="dashboard-secondary-button" onClick={loadData}>Retry applications</button></Notice>
            ) : applications.length === 0 ? (
              <EmptyState title="No applications in the queue" detail="New borrower applications will appear here for review." />
            ) : (
              <div className="dashboard-application-list">
                {applications.map((application) => (
                  <article className="dashboard-application-row" key={application.id}>
                    <div>
                      <div className="dashboard-application-row__title">
                        <strong>{application.applicant?.displayName || 'Applicant'}</strong>
                        <DataLabelChip type={application.status === 'APPROVED' ? 'onchain' : application.status === 'REJECTED' ? 'offchain' : 'pending'} label={application.status} />
                      </div>
                      <p>{application.applicant?.accountId}</p>
                      <small>Property: {application.propertyHash} · Requested {fromRaw(application.requestedAmount, 6)} mUSDC at {application.requestedRate / 100}%</small>
                    </div>
                    {application.status === 'PENDING' && (
                      <div className="dashboard-row-actions">
                        <button className="dashboard-secondary-button" type="button" disabled={decimals === undefined} onClick={() => prefillApproval(application)}>Prepare wallet approval</button>
                        <button className="dashboard-primary-button" type="button" disabled={isProcessing || !adminStatus} onClick={() => handleReviewApplication(application)}>Approve with API signer</button>
                      </div>
                    )}
                  </article>
                ))}
              </div>
            )}
          </Panel>
        </>
      )}

      {activeSection === 'approvals' && (
        <>
          <PageIntro eyebrow="Credit workflow" title="Credit approvals" description="Grant the verified borrower account a maximum principal tied to the reviewed property reference." chipType="onchain" chipLabel="Contract write" />
          <Panel title="Grant borrower limit" description="Use values from a completed offchain assessment. This preserves the existing approval transaction.">
            <form className="dashboard-form" onSubmit={handleApproveSubmit}>
              <Field label="Borrower NEAR account ID"><input type="text" value={borrowerAddress} onChange={(event) => setBorrowerAddress(event.target.value)} placeholder="borrower.testnet" /></Field>
              <div className="dashboard-form-grid dashboard-form-grid--two">
                <Field label="Maximum approved principal (mUSDC)"><input type="number" value={maxPrincipal} onChange={(event) => setMaxPrincipal(event.target.value)} /></Field>
                <Field label="Verified property hash / registry ID"><input type="text" value={propertyHash} onChange={(event) => setPropertyHash(event.target.value)} /></Field>
              </div>
              <button className="dashboard-primary-button" type="submit" disabled={isProcessing || !creditManager}>{isProcessing ? 'Granting approval...' : 'Grant credit approval onchain'}</button>
            </form>
          </Panel>
        </>
      )}

      {activeSection === 'auction' && (
        <>
          <PageIntro eyebrow="Market operations" title="Auction control" description="Configure and advance the existing commit-reveal auction lifecycle." chipType="onchain" chipLabel={`State: ${auctionState}`} />
          <div className="dashboard-split">
            <Panel title="Phase configuration" description="Durations are submitted in seconds when a new cycle starts.">
              <div className="dashboard-form-grid dashboard-form-grid--two">
                <Field label="Commit duration (seconds)"><input type="number" value={commitDuration} onChange={(event) => setCommitDuration(event.target.value)} /></Field>
                <Field label="Reveal duration (seconds)"><input type="number" value={revealDuration} onChange={(event) => setRevealDuration(event.target.value)} /></Field>
              </div>
              <button className="dashboard-primary-button" type="button" disabled={isProcessing || !canStart} onClick={handleStartAuction}>{isProcessing ? 'Starting...' : 'Start new auction cycle'}</button>
            </Panel>
            <Panel title="Finalize allocation" description="Finalize revealed bids and create the allocated loan through Loan Manager." className="dashboard-panel--accent">
              <p className="dashboard-action-copy">Current phase: {auctionState}. Finalization preserves the existing deterministic allocation flow.</p>
              <button className="dashboard-primary-button" type="button" disabled={isProcessing || !canFinalize} onClick={handleFinalizeAuction}>{isProcessing ? 'Finalizing...' : 'Finalize auction and allocate capital'}</button>
            </Panel>
          </div>
        </>
      )}

      {activeSection === 'bids' && (
        <>
          <PageIntro eyebrow="Market operations" title="Bid monitoring" description="Monitor commitments and revealed terms for the current auction." chipType="onchain" />
          <Panel title="Bid evaluation queue" description="Revealed bids read directly from the current auction. Sealed commitments are not enumerable in this contract.">
            {isLoading || error ? <p>Waiting for auction data.</p> : bids.length === 0 ? (
              <EmptyState title="No revealed bids" detail="Bid terms appear here after a borrower reveals them onchain." />
            ) : (
              <div className="dashboard-row-list">
                {bids.map((bid, index) => (
                  <InboxRow key={`${bid.borrower}-${index}`} statusDotColor="var(--primary)" title={`${bid.borrower.slice(0, 10)}... · $${bid.amount} at ${bid.rate}% APR`} subtitle={`Property: ${bid.property} · Term: ${bid.term} months`} dataType="onchain" customRight={<span className="dashboard-row-status">{bid.status}</span>} />
                ))}
              </div>
            )}
          </Panel>
        </>
      )}

      {activeSection === 'loans' && (
        <>
          <PageIntro eyebrow="Market operations" title="Loan monitoring" description="Track loans created after auction allocation without changing servicing logic." chipType="onchain" />
          <Panel title="Active loan book" description="Principal, borrower, pricing, and maturity for monitored loans.">
            {loansLoading || loansError ? <p>Waiting for loan data.</p> : activeLoans.length === 0 ? (
              <EmptyState title="No active loans" detail="Loans will appear here when an auction allocation creates them." />
            ) : (
              <div className="dashboard-row-list">
                {activeLoans.map((loan) => (
                  <InboxRow key={loan.id} statusDotColor="var(--badge-success)" title={`Loan #${loan.id} · ${loan.borrower.slice(0, 10)}...`} subtitle={`Principal $${loan.principal} · ${loan.rate}% APR · ${loan.term} months`} dataType="onchain" customRight={<span className="dashboard-row-status">{loan.maturityDate ? `Matures ${loan.maturityDate}` : 'Maturity not recorded'}</span>} />
                ))}
              </div>
            )}
          </Panel>
        </>
      )}

      {activeSection === 'audit' && (
        <>
          <PageIntro eyebrow="Administration" title="Administrative audit" description="Contract events, credit decisions, and workflow evidence in one traceable record." />
          <TransparencyLedger embedded />
        </>
      )}
    </AppLayout>
  );
}

export default AdminPanel;
