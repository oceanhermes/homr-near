import React from 'react';
import { Link } from 'react-router-dom';
import WalletConnectButton from '../wallet/WalletConnectButton';

export function AppNavbar({ roleLabel, menuOpen, onMenuToggle }) {
  return (
    <header className="dashboard-topbar">
      <div className="dashboard-topbar__brand">
        <button
          type="button"
          className="dashboard-menu-button"
          aria-expanded={menuOpen}
          aria-controls="dashboard-sidebar"
          aria-label={menuOpen ? 'Close navigation menu' : 'Open navigation menu'}
          onClick={onMenuToggle}
        >
          <span className="dashboard-menu-button__icon" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
        </button>
        <Link to="/" className="dashboard-wordmark" aria-label="HOMR landing page">
          HOMR<span>.</span>
        </Link>
        <span className="dashboard-topbar__divider" aria-hidden="true" />
        <span className="dashboard-role-label">{roleLabel}</span>
      </div>

      <div className="dashboard-topbar__actions">
        <WalletConnectButton />
      </div>
    </header>
  );
}

export default AppNavbar;
