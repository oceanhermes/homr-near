import React, { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'motion/react';
import './risk-globe.css';

const Globe3D = lazy(() => import('./ui/Globe3D'));

export default function RiskGlobe() {
  const section = useRef(null);
  const reducedMotion = useReducedMotion();
  const [visible, setVisible] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [ready, setReady] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [paused, setPaused] = useState(false);
  const [pageVisible, setPageVisible] = useState(true);
  const onReady = useCallback(() => setReady(true), []);
  const onUnavailable = useCallback(() => setUnavailable(true), []);

  useEffect(() => {
    if (!window.IntersectionObserver) return;
    const observer = new IntersectionObserver(([entry]) => {
      setVisible(entry.isIntersecting);
      if (entry.isIntersecting) setLoaded(true);
    }, { rootMargin: '150px' });
    observer.observe(section.current);
    const onVisibility = () => setPageVisible(!document.hidden);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      observer.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  return (
    <section ref={section} className="risk-globe-section" id="risiko" aria-labelledby="risk-title">
      <div className="risk-globe-panel">
        <div className="risk-globe-copy">
          <p className="section-eyebrow">Visible limits</p>
          <h2 id="risk-title">Transparency does not eliminate risk.</h2>
          <p className="risk-globe-body">
            HOMR shows LTV, concentration, maturity, loan status, and transaction records.
            This prototype does not verify real collateral and has not been audited.
          </p>
          <div className="risk-globe-actions">
            <a className="risk-globe-primary" href="#transparansi">View transaction records</a>
            <a className="risk-globe-secondary" href="#top">Back to top</a>
          </div>
        </div>
        <div className="risk-globe-visual" aria-hidden="true">
          {(!ready || unavailable) && <div className="globe-static" />}
          {loaded && !unavailable && (
            <Suspense fallback={null}>
              <Globe3D
                rotating={visible && pageVisible && !paused && !reducedMotion}
                onReady={onReady}
                onUnavailable={onUnavailable}
              />
            </Suspense>
          )}
        </div>
        {ready && !unavailable && !reducedMotion && (
          <button
            className="risk-globe-pause"
            type="button"
            aria-pressed={paused}
            onClick={() => setPaused(!paused)}
          >
            {paused ? 'Resume rotation' : 'Pause rotation'}
          </button>
        )}
      </div>
    </section>
  );
}
