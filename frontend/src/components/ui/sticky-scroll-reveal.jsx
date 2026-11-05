import React, { useRef, useSyncExternalStore } from 'react';
import { motion, useMotionValueEvent, useReducedMotion, useScroll } from 'motion/react';
import './sticky-scroll-reveal.css';

const compactQuery = '(max-width: 1024px), (max-height: 640px)';
function subscribeCompact(callback) {
  const query = window.matchMedia?.(compactQuery);
  if (!query) return () => {};
  query.addEventListener('change', callback);
  return () => query.removeEventListener('change', callback);
}

export function StickyScroll({ content, activeId, onActiveChange, children }) {
  const trackRef = useRef(null);
  const reducedMotion = useReducedMotion();
  const compact = useSyncExternalStore(subscribeCompact, () => window.matchMedia?.(compactQuery).matches ?? false, () => false);
  const activeIndex = Math.max(0, content.findIndex((item) => item.id === activeId));
  const { scrollYProgress } = useScroll({
    target: trackRef,
    offset: ['start center', 'end center'],
  });

  useMotionValueEvent(scrollYProgress, 'change', (progress) => {
    const index = Math.min(content.length - 1, Math.max(0, Math.floor(progress * content.length)));
    if (content[index] && content[index].id !== activeId) onActiveChange(content[index].id);
  });

  if (!content.length) return null;

  return (
    <div className={`sticky-scroll${compact ? ' sticky-scroll--compact' : ''}`}>
      <div className="sticky-scroll-layout">
        <div className="sticky-scroll-track" ref={trackRef}>
          {content.map((item, index) => (
            <article
              key={item.id}
              aria-labelledby={`journey-heading-${item.id}`}
              className={`sticky-scroll-story${activeIndex === index ? ' is-active' : ''}`}
            >
              <div className="sticky-scroll-story-body">
                <p className="sticky-scroll-position">0{index + 1} / 0{content.length}</p>
                <h2 className="sticky-scroll-title" id={`journey-heading-${item.id}`}>{item.title}</h2>
                <p className="sticky-scroll-description">{item.description}</p>
                {compact && <div className="sticky-scroll-inline-detail">{item.content}{children}</div>}
              </div>
            </article>
          ))}
        </div>
        {!compact && <div className="sticky-scroll-preview" id="journey-detail" role="region" aria-label={`${content[activeIndex].title} journey details`}>
          <div className="sticky-scroll-preview-panels">
            {content.map((item, index) => (
              <motion.div
                key={item.id}
                className="sticky-scroll-preview-panel"
                aria-hidden={activeIndex !== index}
                inert={activeIndex !== index}
                initial={false}
                animate={{ opacity: activeIndex === index ? 1 : 0, y: reducedMotion || activeIndex === index ? 0 : 8 }}
                transition={{ duration: reducedMotion ? 0 : 0.4, ease: [0.22, 1, 0.36, 1] }}
              >
                {item.content}
              </motion.div>
            ))}
          </div>
          {children}
        </div>}
      </div>
    </div>
  );
}
