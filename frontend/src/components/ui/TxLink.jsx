import React from 'react';
import { CHAIN_CONFIG } from '../../contracts/addresses';

export function TxLink({ hash, label }) {
  if (!hash) return <span className="tx-link__empty">-</span>;

  const truncated = `${hash.slice(0, 6)}...${hash.slice(-4)}`;
  const url = `${CHAIN_CONFIG.blockExplorer}/tx/${hash}`;

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="tx-link"
      title={hash}
    >
      <span>{label || truncated}</span>
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
        <polyline points="15 3 21 3 21 9"></polyline>
        <line x1="10" y1="14" x2="21" y2="3"></line>
      </svg>
    </a>
  );
}

export default TxLink;
