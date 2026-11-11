import React, { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Link, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import './styles.css';

import NearWalletProvider from './context/NearWalletProvider';
import { TransactionProvider } from './context/TransactionContext';
import InvestorDashboard from './pages/InvestorDashboard';
import BorrowerDashboard from './pages/BorrowerDashboard';
import AdminPanel from './pages/AdminPanel';
import FaucetPage from './pages/FaucetPage';
import DashboardEntry from './components/layout/DashboardEntry';
import DecisionCard from './components/DecisionCard';
import RiskGlobe from './components/RiskGlobe';
import BorderGlow from './components/ui/BorderGlow';
import { StickyScroll } from './components/ui/sticky-scroll-reveal';
import { API_BASE, fetchVault, fetchLoans, fetchEvents } from './api/client';
import { CHAIN_CONFIG, NEAR_CONFIG } from './contracts/addresses';
import DemoPage from './pages/DemoPage';

const networkName = CHAIN_CONFIG.chainName;
const networkLabel = networkName.replace(' Smart Chain', '').replace(' Testnet', '').toUpperCase();
const nearNetworkName = `NEAR ${NEAR_CONFIG.networkId === 'testnet' ? 'Testnet' : NEAR_CONFIG.networkId}`;

const proofItems = [
  { label: 'Vault', value: 'Housing Credit Vault', state: 'ONCHAIN' },
  { label: 'NEAR registry', value: NEAR_CONFIG.contractId || 'Awaiting testnet deployment', state: NEAR_CONFIG.contractId ? 'CONFIGURED' : 'PENDING' },
  { label: 'Applications', value: 'Credit database', state: 'OFFCHAIN' },
  { label: 'Collateral review', value: 'Private reference', state: 'VERIFIED OFFCHAIN' },
];

const proofGlow = {
  glowColor: '260 90 85',
  backgroundColor: '#120F17',
  borderRadius: 28,
  glowRadius: 40,
  glowIntensity: 0.85,
  coneSpread: 25,
  colors: ['#cbb7fb', '#a884e5', '#8caaf0'],
  fillOpacity: 0.18,
};

const API_ENDPOINTS = {
  vault: `${API_BASE}/api/vault`,
  loans: `${API_BASE}/api/loans`,
  events: `${API_BASE}/api/events`,
};

const decisions = [
  {
    id: 'eligibility',
    number: '01',
    kicker: 'Credit eligibility',
    title: 'Reviews that keep sensitive data private.',
    body:
      'A credit manager reviews the borrower, property, valuation, and risk limits. Only the decision and its references enter the public process.',
    state: 'VERIFIED OFFCHAIN',
    stateKey: 'offchain',
  },
  {
    id: 'allocation',
    number: '02',
    kicker: 'Capital allocation',
    title: 'Sealed-bid auctions with auditable results.',
    body:
      'Approved borrowers submit commitments, reveal their bids, and receive allocations determined by fixed rules based on vault liquidity and limits.',
    state: 'ONCHAIN',
    stateKey: 'onchain',
  },
];

const journeys = {
  investor: {
    eyebrow: 'Investor journey',
    title: 'One vault, traceable allocations.',
    copy: 'Deposit mock USDC, receive vault shares, and track how capital is allocated and repaid.',
    steps: ['Deposit mock USDC', 'Receive vault shares', 'Track loans and repayments'],
  },
  borrower: {
    eyebrow: 'Borrower journey',
    title: 'Compete for capital while keeping sensitive documents private.',
    copy: 'Approved borrowers take part in sealed-bid auctions. The smart contract validates revealed bids and determines allocations.',
    steps: ['Get approved', 'Commit and reveal your bid', 'Receive your allocation results'],
  },
};

const proofStats = [
  { id: 'eligibility', label: 'Eligibility', detail: 'offchain review' },
  { id: 'allocation', label: 'Allocation', detail: 'onchain auction' },
  { id: 'proof', label: 'Proof', detail: NEAR_CONFIG.contractId ? 'registry configured' : 'registry pending' },
];

const shortcuts = [
  { keys: ['J', 'K'], label: 'navigate' },
  { keys: ['Enter'], label: 'open' },
  { keys: ['⌘', 'K'], label: 'command bar' },
];

function Kbd({ children }) {
  return <kbd className="kbd">{children}</kbd>;
}

function ShortcutRow({ keys: keysList, label }) {
  return (
    <span className="shortcut">
      {keysList.map((key) => (
        <Kbd key={key}>{key}</Kbd>
      ))}
      <span className="shortcut-label">{label}</span>
    </span>
  );
}

function Wordmark() {
  return (
    <span className="wordmark" aria-hidden="true">
      HOMR<span className="wordmark-dot">.</span>
    </span>
  );
}

function HeroAppPreview() {
  return (
    <div className="hero-app-container">
      <div className="hero-app-window">
        <div className="hero-app-header">
          <div className="hero-app-controls">
            <span className="control-dot close" />
            <span className="control-dot minimize" />
            <span className="control-dot maximize" />
          </div>
          <div className="hero-app-title">
            <span className="wordmark-mini">HOMR</span>
            <span className="topbar-divider">·</span>
            <span>Housing Credit Vault ({networkName})</span>
          </div>
          <span className="state-chip state-chip--onchain">{networkLabel}</span>
        </div>
        <div className="hero-app-body">
          <div className="hero-app-sidebar">
            <div className="sidebar-item is-active">
              <span className="sidebar-icon">❖</span>
              <span>Vault Overview</span>
            </div>
            <div className="sidebar-item">
              <span className="sidebar-icon">⟁</span>
              <span>Commit-Reveal Bids</span>
            </div>
            <div className="sidebar-item">
              <span className="sidebar-icon">🛡</span>
              <span>Underwriting Proof</span>
            </div>
          </div>
          <div className="hero-app-main">
            <LiveVaultPanel />
            <LiveLoansPanel />
          </div>
        </div>
      </div>
    </div>
  );
}

function useSafeNavigate() {
  try {
    return useNavigate();
  } catch (e) {
    return (path) => {
      if (typeof window !== 'undefined' && window.location) {
        window.location.href = path;
      }
    };
  }
}

/**
 * Live landing-page panels.
 *
 * These read the indexer API, but the page mounts each panel twice (hero
 * preview + transparency section) and React StrictMode runs mount effects
 * twice, so a plain `useEffect(() => load(), [])` fired the same request four
 * times per visit. `loadOnce` collapses those callers onto one in-flight
 * promise; a failed read settles into `status === 'error'` and stops there
 * until the user presses "Try again".
 */
const inFlightLive = new Map();

function loadOnce(key, run) {
  const pending = inFlightLive.get(key);
  if (pending) return pending;
  const request = run().finally(() => inFlightLive.delete(key));
  inFlightLive.set(key, request);
  return request;
}

function describeLiveError(resource, error) {
  const detail = error?.message || 'Unknown error';
  if (/429|rate limit|too many requests/i.test(detail)) {
    return `Failed to load ${resource}. The data service is rate limiting requests, so loading stopped instead of retrying in a loop. Try again in a moment. (${detail})`;
  }
  return `Failed to load ${resource}. Please check that the contracts are deployed and the indexer API is reachable. (${detail})`;
}

function useLiveResource(key, loader, resource) {
  const [state, setState] = useState({ status: 'loading', data: null, error: null });

  const load = useCallback(() => {
    setState((previous) => ({ status: 'loading', data: previous.data, error: null }));
    return loadOnce(key, loader).then(
      (data) => setState({ status: 'ok', data, error: null }),
      (error) => setState({ status: 'error', data: null, error: describeLiveError(resource, error) }),
    );
  }, [key, loader, resource]);

  // `load` is stable (constant key + module-level loader), so this runs once on
  // mount and never re-fires because of a state update it performed itself.
  useEffect(() => { load(); }, [load]);

  return { ...state, reload: load };
}

const formatUsdc = (value) => {
  const amount = Number(value);
  return Number.isFinite(amount) ? (amount / 1e6).toFixed(2) : '—';
};

/**
 * LiveVaultPanel
 * Baca state vault langsung dari backend dan kontrak testnet.
 * Data vault dibaca dari API yang terhubung ke kontrak testnet.
 */
function LiveVaultPanel() {
  const { status, data: vault, error, reload } = useLiveResource('vault', fetchVault, 'vault data');

  return (
    <div className="live-panel">
      <header className="live-panel-header">
        <div>
          <span className="live-panel-label">Housing Credit Vault</span>
          <span className="live-panel-sublabel">{networkName} · read-only</span>
        </div>
        <span className={`state-chip state-chip--${status === 'ok' ? 'onchain' : status === 'error' ? 'error' : 'offchain'}`}>
          {status === 'ok' && 'LIVE ONCHAIN'}
          {status === 'error' && 'ERROR'}
          {status !== 'ok' && status !== 'error' && 'LOADING'}
        </span>
      </header>

      {status === 'ok' && vault && (
        <div className="live-panel-stats">
          <div className="live-stat">
            <span className="live-stat-label">Total Assets</span>
            <span className="live-stat-value">{formatUsdc(vault.totalAssets)}</span>
            <span className="live-stat-unit">mock USDC</span>
          </div>
          <div className="live-stat">
            <span className="live-stat-label">Available</span>
            <span className="live-stat-value">{formatUsdc(vault.availableCapital)}</span>
            <span className="live-stat-unit">mock USDC</span>
          </div>
          <div className="live-stat">
            <span className="live-stat-label">Deployed</span>
            <span className="live-stat-value">{formatUsdc(vault.deployedCapital)}</span>
            <span className="live-stat-unit">mock USDC</span>
          </div>
          <div className="live-stat">
            <span className="live-stat-label">Total Shares</span>
            <span className="live-stat-value">{vault.totalShares ?? '—'}</span>
            <span className="live-stat-unit">hvSHARE</span>
          </div>
        </div>
      )}

      {status === 'error' && (
        <div className="live-panel-error">
          <p>{error}</p>
          <button type="button" className="live-panel-retry" onClick={reload}>
            Try again
          </button>
        </div>
      )}

      {status === 'ok' && vault && (
        <footer className="live-panel-footer">
          <span className="live-panel-address">
            {vault?.vaultAddress
              ? `${vault.vaultAddress.slice(0, 6)}…${vault.vaultAddress.slice(-4)}`
              : "Unknown Address"}
          </span>
          <a
            className="live-panel-link"
            href={vault.explorerUrl}
            target="_blank"
            rel="noreferrer"
          >
            View on explorer →
          </a>
        </footer>
      )}
    </div>
  );
}

/**
 * LiveLoansPanel
 * List loan dari backend. Kalau kosong, tampilkan pesan jujur.
 */
function LiveLoansPanel() {
  const { status, data, error, reload } = useLiveResource('loans', fetchLoans, 'loan data');
  const loans = data?.loans || [];

  if (status === 'error') {
    return (
      <div className="live-panel-error">
        <p>{error}</p>
        <button type="button" className="live-panel-retry" onClick={reload}>
          Try again
        </button>
      </div>
    );
  }

  if (status !== 'ok') return <p className="live-empty">Loading loans…</p>;

  if (loans.length === 0) {
    return (
      <p className="live-empty">
        No active loans yet. Loans will appear once an auction is finalized.
      </p>
    );
  }

  return (
    <ul className="live-loans">
      {loans.map((loan) => (
        <li key={loan.id} className="live-loan-row">
          <span className="live-loan-id">#{loan.onchainLoanId}</span>
          <span className="live-loan-principal">
            {formatUsdc(loan.principal)} USDC
          </span>
          <span className="live-loan-rate">{loan.rate} bps</span>
          <span className={`state-chip state-chip--${loan.status === 'ACTIVE' ? 'onchain' : 'offchain'}`}>
            {loan.status}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function App() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [journey, setJourney] = useState('investor');
  const navigate = useSafeNavigate();
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    if (!dialogOpen) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setDialogOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [dialogOpen]);

  const chooseJourney = (nextJourney) => {
    setJourney(nextJourney);
    setDialogOpen(false);
    requestAnimationFrame(() => document.querySelector('#journeys')?.scrollIntoView({ behavior: 'smooth' }));
    if (nextJourney === 'investor') {
      navigate('/app/invest');
    } else if (nextJourney === 'borrower') {
      navigate('/app/borrow');
    } else if (nextJourney === 'admin') {
      navigate('/app/admin');
    }
  };

  const activeJourney = journeys[journey] || journeys.investor;

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">Skip to content</a>

      <div className="topbar-wrapper">
        <header className="topbar">
          <button
            className="menu-button"
            type="button"
            aria-label={menuOpen ? 'Close' : 'Menu'}
            aria-expanded={menuOpen}
            aria-controls="site-nav"
            onClick={() => setMenuOpen((value) => !value)}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden="true" focusable="false">
              <path d={menuOpen ? 'M6 6l12 12M6 18L18 6' : 'M4 6h16M4 12h16M4 18h16'} />
            </svg>
          </button>
          <a className="brand-link" href="#top" aria-label="HOMR, back to top">
            <Wordmark />
          </a>
          <nav
            id="site-nav"
            className={menuOpen ? 'nav-links is-open' : 'nav-links'}
            aria-label="Main navigation"
          >
            <a href="#cara-kerja" onClick={() => setMenuOpen(false)}>How it works</a>
            <a href="#journeys" onClick={() => setMenuOpen(false)}>Journeys</a>
            <a href="#transparansi" onClick={() => setMenuOpen(false)}>Transparency</a>
            <a href="#risiko" onClick={() => setMenuOpen(false)}>Risks</a>
          </nav>
          <div className="topbar-actions">
            <button className="cta-button" type="button" onClick={() => setDialogOpen(true)}>
              Open dashboard
            </button>
          </div>
        </header>
      </div>

      <main id="main">
        <section className="hero" id="top" aria-labelledby="hero-title">
          <div className="hero-network">
            <span>Native proof layer</span>
            <span className="hero-network-brand">
              <strong>{nearNetworkName}</strong>
            </span>
          </div>
          <h1 id="hero-title" className="hero-title">
            Capital for housing,<br />
            allocated <span className="hero-highlight">openly.</span>
          </h1>
          <p className="hero-copy">
            HOMR connects stablecoin investors with vetted property borrowers
            through a simple vault and verifiable auctions.
          </p>
          <div className="hero-actions">
            <button className="cta-button cta-button--primary" type="button" onClick={() => setDialogOpen(true)}>
              Open dashboard
              <span aria-hidden="true" className="cta-arrow">›</span>
            </button>
            <a className="ghost-link" href="#cara-kerja">
              See how it works
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
                <path d="M12 5v14m-6-6 6 6 6-6" />
              </svg>
            </a>
          </div>
          <p className="hero-disclosure">The native {nearNetworkName} credit contracts are {NEAR_CONFIG.contractId ? 'configured for proof lookups' : 'awaiting deployment'}. All allocation logic runs on NEAR.</p>
          <div className="hero-demo-link">
            <Link className="ghost-link" to="/demo">View the walletless demo <span aria-hidden="true">↗</span></Link>
          </div>

          <HeroAppPreview />

          <div className="proof-strip" aria-label="Protocol status summary">
            {proofStats.map((stat) => (
              <div className="proof-stat" key={stat.id}>
                <span className="proof-stat-label">{stat.label}</span>
                <span className="proof-stat-detail">{stat.detail}</span>
              </div>
            ))}
          </div>

          <div className="shortcut-strip" aria-label="Keyboard shortcuts">
            {shortcuts.map((shortcut) => (
              <ShortcutRow key={shortcut.label} {...shortcut} />
            ))}
          </div>
        </section>

        <section className="decisions" id="cara-kerja" aria-labelledby="decision-title">
          <header className="section-header">
            <p className="section-eyebrow">Two decisions, two layers</p>
            <h2 id="decision-title" className="section-title">
              People assess credit.<br />
              Contracts allocate capital.
            </h2>
          </header>
          <ul className="decision-list">
            {decisions.map((decision) => (
              <li key={decision.id}>
                <DecisionCard decision={decision} />
              </li>
            ))}
          </ul>
        </section>

        <section className="journeys" id="journeys" aria-label={activeJourney.title}>
          <StickyScroll
            activeId={journey}
            onActiveChange={setJourney}
            content={Object.entries(journeys).map(([id, item]) => ({
              id,
              title: id === 'investor' ? 'Investor' : 'Borrower',
              description: item.copy,
              content: (
                <>
                  <p className="section-eyebrow">{item.eyebrow}</p>
                  <h3 className="section-title section-title--md">{item.title}</h3>
                  <ol className="journey-steps">
                    {item.steps.map((step, index) => (
                      <li className="journey-step" key={step}>
                        <span className="journey-step-number">0{index + 1}</span>
                        <span className="journey-step-label">{step}</span>
                      </li>
                    ))}
                  </ol>
                </>
              ),
            }))}
          >
            <p className="sticky-scroll-notice">
              <strong>{networkName}</strong>
              <span>Connect your wallet to submit transactions.</span>
            </p>
          </StickyScroll>
        </section>

        <section className="transparency" id="transparansi" aria-labelledby="transparency-title">
          <header className="section-header">
            <p className="section-eyebrow">Evidence before claims</p>
            <h2 id="transparency-title" className="section-title">
              Trace onchain activity and offchain reviews.
            </h2>
          </header>

          {/* Live data dari backend dan kontrak testnet */}
          <div className="live-grid">
            <BorderGlow {...proofGlow} className="proof-glow">
              <LiveVaultPanel />
            </BorderGlow>
            <BorderGlow {...proofGlow} className="proof-glow">
              <div className="live-panel live-panel--loans">
                <header className="live-panel-header">
                  <div>
                    <span className="live-panel-label">Active Loans</span>
                    <span className="live-panel-sublabel">From the onchain LoanManager</span>
                  </div>
                </header>
                <LiveLoansPanel />
              </div>
            </BorderGlow>
          </div>

          {/* Sumber data per field, terpisah dari status fetch panel live. */}
          <BorderGlow {...proofGlow} className="proof-glow proof-glow--ledger">
            <div className="ledger" role="list">
              <div className="ledger-head" aria-hidden="true">
                <span>Field</span>
                <span>Value</span>
                <span>State</span>
              </div>
              {proofItems.map((item) => {
                const stateKey = item.state.toLowerCase().replace(' ', '-');
                return (
                  <div className="ledger-row" key={item.label} role="listitem">
                    <span className="ledger-label">{item.label}</span>
                    <strong className="ledger-value">{item.value}</strong>
                    <span className={`state-chip state-chip--${stateKey}`}>{item.state}</span>
                  </div>
                );
              })}
            </div>
          </BorderGlow>
        </section>

        <RiskGlobe />
      </main>

      <footer className="site-footer">
        <Wordmark />
        <p>Finance &amp; Commerce track · Indonesia Web3 Hackathon 2026</p>
        <div className="footer-meta">
          <Link to="/faucet" className="footer-faucet-link">Faucet</Link>
          <span>v0.1 · testnet</span>
        </div>
      </footer>

      <AnimatePresence>
        {dialogOpen && (
          <motion.div
            className="dialog-backdrop"
            role="presentation"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reducedMotion ? 0 : 0.18 }}
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) setDialogOpen(false);
            }}
          >
            <motion.div
              className="journey-dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby="dialog-title"
              initial={{ opacity: 0, y: reducedMotion ? 0 : 10, scale: reducedMotion ? 1 : 0.985 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: reducedMotion ? 0 : 6, scale: reducedMotion ? 1 : 0.99 }}
              transition={{ duration: reducedMotion ? 0 : 0.2, ease: [0.22, 1, 0.36, 1] }}
            >
              <div className="dialog-header">
                <p className="section-eyebrow">CHOOSE YOUR DASHBOARD</p>
                <button
                  className="dialog-close"
                  type="button"
                  aria-label="Close dashboard selection"
                  onClick={() => setDialogOpen(false)}
                >
                  <span aria-hidden="true">×</span>
                </button>
              </div>
              <h2 id="dialog-title" className="dialog-title">
                How would you like to experience HOMR?
              </h2>
              <div className="dialog-options">
                <button
                  type="button"
                  className="dialog-option"
                  onClick={() => chooseJourney('investor')}
                >
                  <span className="dialog-option-label">Investor</span>
                  <span className="dialog-option-detail">Deposit and monitor the vault</span>
                  <span className="dialog-option-arrow" aria-hidden="true">›</span>
                </button>

                <button
                  type="button"
                  className="dialog-option"
                  onClick={() => chooseJourney('borrower')}
                >
                  <span className="dialog-option-label">Borrower</span>
                  <span className="dialog-option-detail">Commit and reveal your bid</span>
                  <span className="dialog-option-arrow" aria-hidden="true">›</span>
                </button>

                <button
                  type="button"
                  className="dialog-option"
                  onClick={() => chooseJourney('admin')}
                >
                  <span className="dialog-option-label">Credit Manager / Admin</span>
                  <span className="dialog-option-detail">Underwrite & manage auctions</span>
                  <span className="dialog-option-arrow" aria-hidden="true">›</span>
                </button>
              </div>
              <p className="dialog-fineprint">
                View live testnet data. Connect your wallet to submit applications and transactions.
                <span className="dialog-hint">
                  Press <Kbd>ESC</Kbd> to close.
                </span>
              </p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

const rootElement = document.getElementById('root');

if (rootElement) {
  createRoot(rootElement).render(
    <React.StrictMode>
      <NearWalletProvider>
        <TransactionProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/" element={<App />} />
              <Route path="/app/invest" element={<DashboardEntry role="investor"><InvestorDashboard /></DashboardEntry>} />
              <Route path="/app/borrow" element={<DashboardEntry role="borrower"><BorrowerDashboard /></DashboardEntry>} />
              <Route path="/app/admin" element={<DashboardEntry role="admin"><AdminPanel /></DashboardEntry>} />
              <Route path="/faucet" element={<FaucetPage />} />
              <Route path="/demo" element={<DemoPage />} />
            </Routes>
          </BrowserRouter>
        </TransactionProvider>
      </NearWalletProvider>
    </React.StrictMode>,
  );
}
