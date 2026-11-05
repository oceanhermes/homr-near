import React from 'react';
import { Notice } from './DashboardPrimitives';

export default function ChainStatus({ loading, error, refresh, progress }) {
  return <>
    {loading && <Notice>Reading the latest contract state...</Notice>}
    {error && <Notice type="error">Contract data could not be refreshed. Any displayed values may be stale. {error.shortMessage || error.message}
      <button type="button" className="dashboard-secondary-button" onClick={refresh}>Retry contract reads</button>
    </Notice>}
    {progress && <Notice>{progress}</Notice>}
  </>;
}
