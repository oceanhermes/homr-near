import React, { useState } from 'react';
import { Lens } from './ui/Lens';

function DecisionPreview({ allocation }) {
  return (
    <div className={`decision-preview ${allocation ? 'decision-preview--allocation' : ''}`}>
      <div className="decision-preview-heading">
        <span>{allocation ? 'Housing Credit Vault' : 'Credit review'}</span>
        <span className="decision-preview-caption">Process overview</span>
      </div>
      {allocation ? (
        <div className="allocation-flow">
          <div className="allocation-vault">Vault liquidity</div>
          <div className="allocation-stages">
            <span>Commit</span><span>Reveal</span><span>Allocation</span>
          </div>
          <p>Results & transaction references</p>
        </div>
      ) : (
        <div className="review-flow">
          {['Borrower & documents', 'Property & valuation', 'Risk limits'].map((item) => (
            <div className="review-flow-row" key={item}>
              <span>{item}</span><span>Private review</span>
            </div>
          ))}
          <div className="review-flow-result"><span>Decision</span><span>Public reference</span></div>
        </div>
      )}
      <span className="decision-preview-hint">Hover or tap to magnify</span>
    </div>
  );
}

export default function DecisionCard({ decision }) {
  const [hovering, setHovering] = useState(false);

  return (
    <article className={`decision-card decision-card--${decision.id}${hovering ? ' is-lens-hovered' : ''}`} aria-labelledby={`${decision.id}-title`}>
      <div className="decision-card-rays" aria-hidden="true" />
      <div className="decision-card-heading">
        <span className="decision-number">{decision.number}</span>
        <h3 id={`${decision.id}-title`} className="decision-kicker">{decision.kicker}</h3>
      </div>
      <Lens label={decision.kicker} hovering={hovering} setHovering={setHovering}>
        <DecisionPreview allocation={decision.id === 'allocation'} />
      </Lens>
      <div className="decision-card-copy">
        <p className="decision-title">{decision.title}</p>
        <p className="decision-copy">{decision.body}</p>
      </div>
      <span className="decision-card-state">{decision.state}</span>
    </article>
  );
}
