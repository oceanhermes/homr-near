import React from 'react';
import { useProtocolQuery } from '../../hooks/useProtocol';

const dashboardData = {
  investor: { resource: 'vault', personal: true, title: 'investor', detail: 'Loading the latest vault position.' },
  borrower: { resource: 'auction', personal: true, title: 'borrower', detail: 'Loading the current auction phase.' },
  admin: { resource: 'auction', personal: true, title: 'admin', detail: 'Loading the latest auction status.' }
};

export default function DashboardEntry({ role, children }) {
  const { resource, personal, title, detail } = dashboardData[role];
  const { isPending } = useProtocolQuery(resource, personal);

  if (!isPending) return children;

  return (
    <main className="dashboard-entry" aria-busy="true">
      <div className="dashboard-entry__content" role="status" aria-live="polite">
        <span className="dashboard-entry__brand">HOMR.</span>
        <h1>Preparing your {title} dashboard</h1>
        <p>{detail}</p>
        <div className="dashboard-entry__track" aria-hidden="true"><span /></div>
      </div>
    </main>
  );
}
