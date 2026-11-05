import React from 'react';
import InboxRow from '../ui/InboxRow';
import TxLink from '../ui/TxLink';
import { useTransparencyEvents } from '../../hooks/useTransparencyEvents';
import ChainStatus from '../layout/ChainStatus';

export function TransparencyLedger({ embedded = false }) {
  const { events, isLoading, error, refresh, fromBlock, toBlock } = useTransparencyEvents();

  return (
    <section className={`transparency-ledger${embedded ? ' transparency-ledger--embedded' : ''}`}>
      <header className="transparency-ledger__header">
        <div>
          <h2>Transparency ledger</h2>
          <p>{`Latest 50 events in the last 2,000 blocks${fromBlock ? ` (${fromBlock} to ${toBlock})` : ''}. Older history is available on the block explorer.`}</p>
        </div>
        <span className="transparency-ledger__count">{events.length} events</span>
      </header>

      <ChainStatus loading={isLoading} error={error} refresh={refresh} />
      {!isLoading && !error && events.length === 0 ? (
        <div className="dashboard-empty">
          <strong>No activity in this window</strong>
          <p>New contract events will appear here after confirmation.</p>
        </div>
      ) : (
        <div className="dashboard-row-list">
          {events.map((event) => (
            <InboxRow
              key={event.id}
              statusDotColor={event.dataType === 'onchain' ? 'var(--badge-success)' : event.dataType === 'offchain' ? 'var(--badge-warning)' : 'var(--primary)'}
              title={event.title}
              subtitle={`${event.detail} · ${event.timestamp}`}
              dataType={event.dataType}
              customRight={event.txHash ? <TxLink hash={event.txHash} /> : null}
            />
          ))}
        </div>
      )}
    </section>
  );
}

export default TransparencyLedger;
