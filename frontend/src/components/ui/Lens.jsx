import React, { useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import './lens.css';

export function Lens({ children, label, zoomFactor = 1.5, lensSize = 170, hovering, setHovering }) {
  const containerRef = useRef(null);
  const [localHovering, setLocalHovering] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [position, setPosition] = useState({ x: 50, y: 50 });
  const reducedMotion = useReducedMotion();
  const active = pinned || (hovering ?? localHovering);

  function updateHover(value) {
    setLocalHovering(value);
    setHovering?.(value);
  }

  function movePointer(event) {
    const rect = containerRef.current.getBoundingClientRect();
    setPosition({
      x: ((event.clientX - rect.left) / rect.width) * 100,
      y: ((event.clientY - rect.top) / rect.height) * 100,
    });
  }

  function handleKeyDown(event) {
    const directions = { ArrowLeft: [-8, 0], ArrowRight: [8, 0], ArrowUp: [0, -8], ArrowDown: [0, 8] };
    if (event.key === 'Escape') {
      setPinned(false);
      updateHover(false);
    } else if (directions[event.key]) {
      event.preventDefault();
      const [dx, dy] = directions[event.key];
      setPinned(true);
      setPosition(({ x, y }) => ({ x: Math.max(0, Math.min(100, x + dx)), y: Math.max(0, Math.min(100, y + dy)) }));
    }
  }

  const origin = `${position.x}% ${position.y}%`;

  return (
    <div
      ref={containerRef}
      className="lens"
      onPointerEnter={(event) => {
        if (event.pointerType === 'mouse') {
          movePointer(event);
          updateHover(true);
        }
      }}
      onPointerMove={(event) => {
        if (event.pointerType === 'mouse' || event.buttons) movePointer(event);
      }}
      onPointerLeave={() => updateHover(false)}
    >
      {children}
      <AnimatePresence>
        {active && (
          <motion.div
            className="lens-magnified"
            aria-hidden="true"
            inert
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reducedMotion ? 0 : 0.18 }}
            style={{
              maskImage: `radial-gradient(circle ${lensSize / 2}px at ${origin}, black 98%, transparent 100%)`,
              WebkitMaskImage: `radial-gradient(circle ${lensSize / 2}px at ${origin}, black 98%, transparent 100%)`,
            }}
          >
            <div className="lens-copy" style={{ transform: `scale(${zoomFactor})`, transformOrigin: origin }}>
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <button
        type="button"
        className="lens-control"
        aria-label={`Magnify ${label}`}
        aria-pressed={pinned}
        onClick={() => {
          setPinned(!pinned);
          updateHover(false);
        }}
        onFocus={() => setPosition({ x: 50, y: 50 })}
        onBlur={() => { setPinned(false); updateHover(false); }}
        onKeyDown={handleKeyDown}
      >
        <span className="sr-only">Press Enter to activate the lens, arrow keys to move it, and Escape to close.</span>
      </button>
    </div>
  );
}
