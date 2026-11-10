import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { API_BASE } from '../api/endpoints';
import { CHAIN_CONFIG, NEAR_CONFIG } from '../contracts/addresses';
import { callNearView } from '../near/rpc';

const steps = [
  { id: 'deposit', label: 'Deposit', detail: 'Investor deposits 100,000 mUSDC into the vault.' },
  { id: 'approve', label: 'Approval', detail: 'Credit manager approves a borrower limit offchain.' },
  { id: 'commit', label: 'Commit', detail: 'Borrower submits a sealed bid commitment.' },
  { id: 'reveal', label: 'Reveal', detail: 'Borrower reveals the original bid parameters.' },
  { id: 'finalize', label: 'Allocate', detail: 'The auction creates a 50,000 mUSDC loan.' },
  { id: 'repay', label: 'Repay', detail: 'Repayment returns capital to the vault.' }
];

const EVENT_NAMES = {
  deposit: 'vault_deposit',
  approve: 'borrower_approved',
  commit: 'bid_committed',
  reveal: 'bid_revealed',
  finalize: 'auction_finalized',
  repay: 'loan_repaid'
};

function SourceBadge({ txSource }) {
  const simulated = txSource === 'SIMULATION';
  return (
    <span className={`state-chip state-chip--${simulated ? 'offchain' : 'onchain'}`}>
      {simulated ? 'SIMULATION' : 'ONCHAIN'}
    </span>
  );
}

function RegistryLookup() {
  const [kind, setKind] = useState('auction');
  const [id, setId] = useState('');
  const [result, setResult] = useState(null);
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');

  async function inspect(event) {
    event.preventDefault();
    setStatus('loading');
    setResult(null);
    setError('');
    try {
      const record = await callNearView(kind === 'auction' ? 'get_auction' : 'get_loan', {
        [kind === 'auction' ? 'auction_id' : 'loan_id']: id.trim(),
      }, NEAR_CONFIG.contractId);
      if (!record) {
        setStatus('empty');
        return;
      }
      const repayments = kind === 'loan' ? await callNearView('get_repayments', { loan_id: id.trim() }) : [];
      setResult({ record, repayments });
      setStatus('ready');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The registry could not be reached.');
      setStatus('error');
    }
  }

  return (
    <section className="demo-registry" aria-labelledby="registry-title">
      <div>
        <p className="section-eyebrow">Native NEAR registry</p>
        <h2 id="registry-title">Inspect a recorded proof</h2>
        <p>Look up an operator-submitted registry record by its auction or loan ID. A stored hash does not independently verify the source transaction or borrower facts. This check is separate from the walkthrough above.</p>
        <p className="demo-registry-account">Contract: <strong>{NEAR_CONFIG.contractId || 'Not deployed or configured'}</strong></p>
      </div>
      {NEAR_CONFIG.contractId ? (
        <form className="demo-registry-form" onSubmit={inspect}>
          <label htmlFor="registry-kind">Record type</label>
          <select id="registry-kind" value={kind} disabled={status === 'loading'} onChange={(event) => { setKind(event.target.value); setStatus('idle'); setResult(null); }}>
            <option value="auction">Auction</option>
            <option value="loan">Loan</option>
          </select>
          <label htmlFor="registry-id">{kind === 'auction' ? 'Auction ID' : 'Loan ID'}</label>
          <input id="registry-id" value={id} disabled={status === 'loading'} onChange={(event) => { setId(event.target.value); setStatus('idle'); setResult(null); }} required maxLength={128} />
          <button className="cta-button cta-button--primary" type="submit" disabled={status === 'loading'}>
            {status === 'loading' ? 'Checking registry…' : 'Check record'}
          </button>
          <div className="demo-registry-result" aria-live="polite">
            {status === 'empty' && <p>No record exists for that ID on this registry.</p>}
            {status === 'error' && <p role="alert">{error}</p>}
            {status === 'ready' && (
              <>
                <p><strong>Proof hash</strong><code>{result.record.proof_hash}</code></p>
                {kind === 'auction' && <p><strong>Source chain</strong><span>{result.record.source_chain}</span></p>}
                {kind === 'auction' && <p><strong>Total capital (raw units)</strong><span>{result.record.total_capital}</span></p>}
                {kind === 'loan' && <p><strong>Principal / repaid (raw units)</strong><span>{result.record.principal} / {result.record.total_repaid}</span></p>}
                <p><strong>Recorded by</strong><code>{result.record.recorded_by}</code></p>
                <p><strong>Recorded at</strong><span>{new Date(Number(result.record.recorded_at)).toLocaleString()}</span></p>
                {kind === 'loan' && <p><strong>Repayments</strong><span>{result.repayments.length} recorded</span></p>}
                {result.repayments.map((repayment, index) => (
                  <p key={`${repayment.proof_hash}-${index}`}><strong>Repayment {index + 1} · {repayment.amount} raw units</strong><code>{repayment.proof_hash}</code></p>
                ))}
              </>
            )}
          </div>
        </form>
      ) : <p className="demo-registry-unavailable">A team-controlled NEAR Testnet contract account is needed before live proofs can be inspected.</p>}
    </section>
  );
}

export default function DemoPage() {
  const [runs, setRuns] = useState({});
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');

  const runStep = async (step) => {
    setRunning(true);
    setError('');
    setRuns((current) => ({ ...current, [step]: { status: 'running' } }));
    try {
      const response = await fetch(`${API_BASE}/api/demo/step`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ step })
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.tx_hash) {
        throw new Error(data?.error || `Demo step failed (HTTP ${response.status}).`);
      }
      setRuns((current) => ({
        ...current,
        [step]: {
          status: 'done',
          txHash: data.tx_hash,
          blockHeight: data.block_height,
          txSource: data.txSource || 'SIMULATION',
          explorerUrl: data.explorer_url || `${NEAR_CONFIG.explorerUrl}/txns/${data.tx_hash}`,
          event: data.event?.event || EVENT_NAMES[step]
        }
      }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The demo step could not be executed.');
      setRuns((current) => ({ ...current, [step]: { status: 'error' } }));
    } finally {
      setRunning(false);
    }
  };

  const completed = Object.values(runs).filter((run) => run?.status === 'done').length;

  return (
    <div className="demo-shell">
      <a className="skip-link" href="#demo-main">Skip to content</a>
      <header className="demo-header">
        <Link to="/" className="wordmark" aria-label="HOMR home">HOMR<span className="wordmark-dot">.</span></Link>
        <span className="demo-network">{CHAIN_CONFIG.chainName} · WALLETLESS DEMO</span>
        <Link to="/app/invest" className="cta-button">Open live dashboard</Link>
      </header>

      <main id="demo-main" className="demo-main">
        <section className="demo-hero" aria-labelledby="demo-title">
          <p className="section-eyebrow">Walletless walkthrough</p>
          <h1 id="demo-title">See one complete housing-credit allocation.</h1>
          <p>Each step below calls the HOMR backend demo endpoint. The backend replays the event through the same indexer path the live chain uses, so the ledger below stays truthful about its source.</p>
          <div className="demo-disclosure" role="note">
            <strong>WALLETLESS DEMO</strong>
            <span>No wallet and no signature are required. Each response is tagged ONCHAIN or SIMULATION so simulated rows are never presented as chain state.</span>
          </div>
        </section>

        <section className="demo-summary" aria-label="Demo vault summary">
          <article><span>Vault TVL</span><strong>100,000</strong><small>mUSDC · demo</small></article>
          <article><span>Available capital</span><strong>50,000</strong><small>mUSDC · demo</small></article>
          <article><span>Allocated loan</span><strong>50,000</strong><small>mUSDC · demo</small></article>
          <article><span>Allocation rule</span><strong>Highest valid rate</strong><small>Displayed before auction</small></article>
        </section>

        <section className="demo-flow" aria-labelledby="flow-title">
          <div className="demo-flow-heading">
            <div>
              <p className="section-eyebrow">The proof path</p>
              <h2 id="flow-title">Eligibility stays private. Allocation is observable.</h2>
            </div>
            <span className="state-chip state-chip--offchain">{completed}/{steps.length} STEPS RUN</span>
          </div>

          {error && <p className="demo-inline-error" role="alert">{error}</p>}

          <ol className="demo-steps">
            {steps.map((step, index) => {
              const run = runs[step.id];
              return (
                <li key={step.id} className={run?.status === 'done' ? 'is-complete' : ''}>
                  <span className="demo-step-number">0{index + 1}</span>
                  <div>
                    <strong>{step.label}</strong>
                    <p>{step.detail}</p>
                    {run?.status === 'done' && (
                      <p className="demo-step-receipt">
                        <SourceBadge txSource={run.txSource} />
                        {run.blockHeight && <span>Block #{run.blockHeight}</span>}
                        <a href={run.explorerUrl} target="_blank" rel="noopener noreferrer">
                          {run.txHash.slice(0, 14)}…
                        </a>
                      </p>
                    )}
                    {run?.status === 'error' && <p className="demo-step-receipt">Step failed. Retry below.</p>}
                  </div>
                  <button
                    type="button"
                    className="cta-button"
                    onClick={() => runStep(step.id)}
                    disabled={running || run?.status === 'running'}
                  >
                    {run?.status === 'running' ? 'Running…' : run?.status === 'done' ? 'Run again' : 'Run step'}
                  </button>
                </li>
              );
            })}
          </ol>
        </section>

        <RegistryLookup />

        <div className="demo-actions">
          <Link to="/app/invest" className="cta-button cta-button--primary">Try the investor flow</Link>
          <Link to="/app/borrow" className="ghost-link">Try the borrower flow <span aria-hidden="true">↗</span></Link>
        </div>
      </main>
    </div>
  );
}
