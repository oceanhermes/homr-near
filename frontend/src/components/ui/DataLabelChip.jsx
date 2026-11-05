import React from 'react';

const defaultLabels = {
  onchain: 'Onchain',
  offchain: 'Verified offchain',
  pending: 'Pending review'
};

export function DataLabelChip({ type = 'onchain', label }) {
  if (type === 'onchain') return null;
  const safeType = defaultLabels[type] ? type : 'onchain';
  const displayLabel = label || defaultLabels[safeType];

  return (
    <span className={`data-chip data-chip--${safeType}`}>
      <span className="data-chip__dot" />
      {displayLabel}
    </span>
  );
}

export default DataLabelChip;
