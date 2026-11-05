import React from 'react';
import { formatUnits } from 'viem';
import { EmptyState, Notice, Panel } from '../layout/DashboardPrimitives';
import InboxRow from '../ui/InboxRow';

const statusLabels = { PENDING: 'Pending review', APPROVED: 'Approved', REJECTED: 'Rejected' };

export default function ApplicationHistory({ applications, status, error, address, onRefresh }) {
  return (
    <Panel className="application-history" title="Application history" description="Financing requests submitted by your connected wallet, newest first." chipType="offchain" chipLabel="Credit database">
      {!address ? (
        <EmptyState title="Connect your borrower wallet" detail="Your application history will appear here once your wallet is connected." />
      ) : (
        <>
          <button className="dashboard-secondary-button" type="button" onClick={onRefresh} disabled={status === 'loading'}>Refresh application history</button>
          {status === 'loading' && <Notice>Loading application history...</Notice>}
          {status === 'error' && <Notice type="error">Could not load application history. {error || 'Try refreshing it.'}{applications.length > 0 && ' Requests shown below are from the last successful load.'}</Notice>}
          {status === 'ready' && applications.length === 0 && <EmptyState title="No applications submitted" detail="Submit a financing application to start your credit review." />}
          {applications.length > 0 && <div className="dashboard-row-list">
            {applications.map((application) => (
              <InboxRow
                key={application.id}
                statusDotColor={application.status === 'APPROVED' ? 'var(--badge-success)' : application.status === 'PENDING' ? 'var(--badge-warning)' : null}
                title={`${formatUnits(BigInt(application.requestedAmount), 6)} mUSDC`}
                dataType={null}
                customRight={<span className="dashboard-row-status">{statusLabels[application.status] || application.status}</span>}
                subtitle={<>
                  <div>Application #{application.id}</div>
                  <div>Submitted {new Date(application.createdAt).toLocaleString()}</div>
                  <div>Property: {application.propertyHash}</div>
                  <div>{application.requestedRate / 100}% APR · {application.requestedTerm / (30 * 86400)} months</div>
                  {application.reviewedAt && <div>Reviewed {new Date(application.reviewedAt).toLocaleString()}</div>}
                  {application.reviewNote && <div>Review note: {application.reviewNote}</div>}
                </>}
              />
            ))}
          </div>}
        </>
      )}
    </Panel>
  );
}
