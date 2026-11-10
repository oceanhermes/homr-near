import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { claimFaucetToken, fetchFaucetInfo } from '../api/faucet';
import { useNearWallet } from '../context/NearWalletProvider';
import { CHAIN_CONFIG, NEAR_CONFIG } from '../contracts/addresses';
import './faucet.css';

/** NEP-141 distribution account (testnet). */
const FAUCET_NETWORK = CHAIN_CONFIG.chainName;
const tokens = [
  { id: 'usdc', label: 'mUSDC', kind: 'TEST TOKEN', detail: 'Try depositing into the Housing Credit Vault.', amountKey: 'dripUsdc', suffix: 'mUSDC' }
];

/** Implicit accounts (64 hex chars) or named accounts such as `alice.testnet`. */
const ACCOUNT_ID_PATTERN = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;

function isValidAccountId(value) {
  const text = String(value || '');
  return text.length >= 2 && text.length <= 64 && ACCOUNT_ID_PATTERN.test(text);
}

export function FaucetPage() {
  const { address, isConnected, connect, ready, isConnecting, error: connectError } = useNearWallet();
  const [targetAccount, setTargetAccount] = useState(address || '');
  const [info, setInfo] = useState(null);
  const [infoState, setInfoState] = useState('loading');
  const [infoError, setInfoError] = useState('');
  const [claiming, setClaiming] = useState(null);
  const [results, setResults] = useState({ usdc: null });

  useEffect(() => {
    if (address) setTargetAccount(address);
  }, [address]);

  async function loadInfo() {
    setInfoState('loading');
    setInfoError('');
    try {
      const data = await fetchFaucetInfo();
      setInfo(data);
      setInfoState('ready');
    } catch (error) {
      setInfo(null);
      setInfoState('error');
      setInfoError(error.message);
    }
  }

  useEffect(() => { loadInfo(); }, []);

  const validAccount = isValidAccountId(targetAccount);
  const canClaim = validAccount && infoState === 'ready' && !claiming;

  async function handleClaim(token) {
    if (!canClaim) return;
    setClaiming(token);
    setResults((current) => ({ ...current, [token]: null }));
    try {
      const data = await claimFaucetToken(token, targetAccount);
      setResults((current) => ({ ...current, [token]: { type: 'success', message: data.message, txHash: data.txHash } }));
      loadInfo();
    } catch (error) {
      setResults((current) => ({ ...current, [token]: { type: 'error', message: error.message } }));
    } finally {
      setClaiming(null);
    }
  }

  function updateAccount(value) {
    setTargetAccount(value.trim().toLowerCase());
    setResults({ usdc: null });
  }

  return (
    <div className="faucet-app">
      <a className="skip-link" href="#faucet-main">Skip to content</a>
      <div className="topbar-wrapper">
        <header className="topbar faucet-topbar">
          <Link to="/" className="brand-link" aria-label="HOMR, back to home"><span className="wordmark">HOMR<span className="wordmark-dot">.</span></span></Link>
          <nav className="faucet-nav" aria-label="Faucet navigation">
            <Link to="/">Home</Link>
            <span aria-current="page">Faucet</span>
          </nav>
          <Link to="/app/invest" className="cta-button">Open dashboard</Link>
        </header>
      </div>

      <main id="faucet-main" className="faucet-main">
        <section className="faucet-intro" aria-labelledby="faucet-title">
          <div className="hero-network">
            <span>Built on</span>
            <span className="hero-network-brand"><strong>{FAUCET_NETWORK}</strong></span>
          </div>
          <h1 id="faucet-title">Test tokens to <span className="hero-highlight">use HOMR.</span></h1>
          <p>Get mUSDC to try depositing into the HOMR vault. This token works only on testnet.</p>
          <span className="faucet-intro__note">{FAUCET_NETWORK.toUpperCase()} <span aria-hidden="true">·</span> NETWORK {NEAR_CONFIG.networkId.toUpperCase()} <span aria-hidden="true">·</span> NO MONETARY VALUE</span>
        </section>

        <div className="faucet-workspace">
          <div className="faucet-workspace__bar" aria-hidden="true">
            <span className="faucet-workspace__lights"><i /><i /><i /></span>
            <span>HOMR <span>·</span> Testnet Faucet</span>
            <span className="faucet-workspace__network">{FAUCET_NETWORK.toUpperCase()}</span>
          </div>
          <div className="faucet-layout">
          <section className="faucet-address-panel" aria-labelledby="faucet-address-title">
            <div className="faucet-panel-index">01 <span>/</span> RECIPIENT ACCOUNT</div>
            <h2 id="faucet-address-title">Send to your account.</h2>
            <p>Connect your wallet or enter a NEAR account ID manually.</p>

            <label className="faucet-address-label" htmlFor="faucet-address">NEAR account ID</label>
            <input
              id="faucet-address"
              className="faucet-address-input"
              value={targetAccount}
              onChange={(event) => updateAccount(event.target.value)}
              placeholder="you.testnet"
              autoComplete="off"
              spellCheck="false"
              disabled={Boolean(claiming)}
              aria-invalid={Boolean(targetAccount && !validAccount)}
              aria-describedby="faucet-address-help"
            />
            <p id="faucet-address-help" className={targetAccount && !validAccount ? 'faucet-field-help is-error' : 'faucet-field-help'}>
              {targetAccount && !validAccount ? 'Invalid account ID. Use lowercase letters, digits, separators, and an optional .testnet suffix.' : 'Use the account ID of the wallet you plan to connect to the dashboard.'}
            </p>

            {isConnected ? (
              <p className="faucet-wallet-state"><span aria-hidden="true" /> Connected wallet: {address}</p>
            ) : (
              <button
                type="button"
                className="faucet-secondary-button"
                onClick={() => connect()}
                disabled={!ready || isConnecting}
              >
                {isConnecting ? 'Connecting…' : ready ? 'Connect NEAR wallet' : 'Loading wallets…'}
              </button>
            )}
            {connectError && <p className="faucet-inline-error" role="alert">{connectError.message}</p>}

            <div className="faucet-next-step">
              <span>NEXT STEP</span>
              <p>After claiming, open the Investor dashboard and select Live mode to try depositing mUSDC.</p>
              <Link to="/app/invest">Open dashboard <span aria-hidden="true">↗</span></Link>
            </div>
          </section>

          <section className="faucet-claim-panel" aria-labelledby="faucet-claim-title">
            <div className="faucet-panel-index">02 <span>/</span> CLAIM TEST TOKENS</div>
            <div className="faucet-claim-heading">
              <div>
                <h2 id="faucet-claim-title">Claim test mUSDC.</h2>
                <p>Each account can claim mUSDC once per hour.</p>
              </div>
              <span className={`faucet-service-state is-${infoState}`} role="status">
                <span aria-hidden="true" />{infoState === 'ready' ? 'Faucet ready' : infoState === 'loading' ? 'Checking faucet' : 'Server unavailable'}
              </span>
            </div>

            {infoState === 'error' && (
              <div className="faucet-service-error" role="alert">
                <div>
                  <strong>Faucet temporarily unavailable</strong>
                  <p>{infoError}</p>
                </div>
                <button type="button" onClick={loadInfo}>Try again</button>
              </div>
            )}

            <div className="faucet-token-list">
              {tokens.map((token) => {
                const result = results[token.id];
                return (
                  <article className="faucet-token" key={token.id}>
                    <div className="faucet-token__symbol" aria-hidden="true">$</div>
                    <div className="faucet-token__body">
                      <div className="faucet-token__top"><span>{token.kind}</span><strong>{info ? `${info[token.amountKey]} ${token.suffix}` : 'Waiting for data'}</strong></div>
                      <h3>{token.label}</h3>
                      <p>{token.detail}</p>
                    </div>
                    <button type="button" className="faucet-claim-button" disabled={!canClaim} onClick={() => handleClaim(token.id)}>
                      {claiming === token.id ? 'Sending…' : `Claim ${token.label}`}
                    </button>
                    {result && (
                      <div className={`faucet-result is-${result.type}`} role={result.type === 'error' ? 'alert' : 'status'}>
                        <p>{result.message}</p>
                        {result.txHash && <a href={`${NEAR_CONFIG.explorerUrl}/txns/${result.txHash}`} target="_blank" rel="noopener noreferrer">View transaction on the explorer</a>}
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          </section>
          </div>
        </div>
        <p className="faucet-footer-note">This faucet is only for the HOMR simulation on {FAUCET_NETWORK}.</p>
      </main>
    </div>
  );
}

export default FaucetPage;
