import React from 'react';
import DataLabelChip from '../ui/DataLabelChip';

export function PageIntro({ eyebrow, title, description, chipType, chipLabel, action }) {
  return (
    <header className="dashboard-page-intro">
      <div>
        <p className="dashboard-eyebrow">{eyebrow}</p>
        <div className="dashboard-title-row">
          <h1>{title}</h1>
          {chipType && <DataLabelChip type={chipType} label={chipLabel} />}
        </div>
        <p className="dashboard-page-description">{description}</p>
      </div>
      {action && <div className="dashboard-page-action">{action}</div>}
    </header>
  );
}

export function Panel({ title, description, chipType, chipLabel, children, className = '' }) {
  return (
    <section className={`dashboard-panel ${className}`.trim()}>
      {(title || chipType) && (
        <header className="dashboard-panel__header">
          <div>
            {title && <h2>{title}</h2>}
            {description && <p>{description}</p>}
          </div>
          {chipType && <DataLabelChip type={chipType} label={chipLabel} />}
        </header>
      )}
      {children}
    </section>
  );
}

export function MetricGrid({ children, compact = false }) {
  return <div className={`dashboard-metrics${compact ? ' dashboard-metrics--compact' : ''}`}>{children}</div>;
}

export function SummaryGrid({ children }) {
  return <section className="dashboard-summary-grid" aria-label="Financial summary">{children}</section>;
}

export function PrimarySummary({ eyebrow, value, unit, detail, children }) {
  return (
    <div className="dashboard-primary-summary">
      <span>{eyebrow}</span>
      <strong>{value}</strong>
      {unit && <small>{unit}</small>}
      {detail && <p>{detail}</p>}
      {children && <div className="dashboard-primary-summary__footer">{children}</div>}
    </div>
  );
}

export function Metric({ label, value, unit, tone = 'default', detail }) {
  return (
    <div className={`dashboard-metric dashboard-metric--${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      {unit && <small>{unit}</small>}
      {detail && <p>{detail}</p>}
    </div>
  );
}

export function Workflow({ steps, current }) {
  return (
    <ol className="dashboard-workflow">
      {steps.map((step, index) => {
        const state = index < current ? 'complete' : index === current ? 'current' : 'pending';
        return (
          <li key={step.label} className={`is-${state}`}>
            <span className="dashboard-workflow__marker" aria-hidden="true">{index < current ? '✓' : index + 1}</span>
            <div>
              <strong>{step.label}</strong>
              <p>{step.detail}</p>
            </div>
            <small>{state === 'complete' ? 'Completed' : state === 'current' ? 'In progress' : 'Pending'}</small>
          </li>
        );
      })}
    </ol>
  );
}

export function Notice({ type = 'info', children }) {
  return <div className={`dashboard-notice dashboard-notice--${type}`} role={type === 'error' ? 'alert' : 'status'}>{children}</div>;
}

export function EmptyState({ title, detail }) {
  return (
    <div className="dashboard-empty">
      <strong>{title}</strong>
      <p>{detail}</p>
    </div>
  );
}

export function Field({ label, children }) {
  return (
    <label className="dashboard-field">
      <span>{label}</span>
      {children}
    </label>
  );
}
