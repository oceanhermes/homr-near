import React, { useCallback, useEffect, useRef } from 'react';
import './BorderGlow.css';

const POSITIONS = ['80% 55%', '69% 34%', '8% 6%', '41% 38%', '86% 85%', '82% 18%', '51% 4%'];
const COLOR_MAP = [0, 1, 2, 0, 1, 2, 1];

function glowVariables(color, intensity) {
  const values = color.trim().match(/^(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)%?\s+(\d+(?:\.\d+)?)%?$/);
  const [, h, s, l] = values || ['', 40, 80, 80];
  return Object.fromEntries([100, 60, 50, 40, 30, 20, 10].map(opacity => [
    `--glow-color${opacity === 100 ? '' : `-${opacity}`}`,
    `hsl(${h}deg ${s}% ${l}% / ${Math.max(0, Math.min(opacity * intensity, 100))}%)`,
  ]));
}

export default function BorderGlow({
  children,
  className = '',
  edgeSensitivity = 30,
  glowColor = '40 80 80',
  backgroundColor = '#120F17',
  borderRadius = 28,
  glowRadius = 40,
  glowIntensity = 1,
  coneSpread = 25,
  animated = false,
  colors = ['#c084fc', '#f472b6', '#38bdf8'],
  fillOpacity = 0.5,
}) {
  const cardRef = useRef(null);
  const palette = colors.length ? colors : ['#c084fc', '#f472b6', '#38bdf8'];

  const handlePointerMove = useCallback(event => {
    if (event.pointerType === 'touch') return;
    const card = cardRef.current;
    const { left, top, width, height } = card.getBoundingClientRect();
    if (!width || !height) return;
    const dx = event.clientX - left - width / 2;
    const dy = event.clientY - top - height / 2;
    const edge = Math.min(1, Math.max(Math.abs(dx) / (width / 2), Math.abs(dy) / (height / 2)));
    const angle = (Math.atan2(dy, dx) * 180 / Math.PI + 450) % 360;
    card.style.setProperty('--edge-proximity', (edge * 100).toFixed(3));
    card.style.setProperty('--cursor-angle', `${angle.toFixed(3)}deg`);
  }, []);

  useEffect(() => {
    if (!animated || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const card = cardRef.current;
    let frame;
    let start;
    card.classList.add('sweep-active');
    const tick = time => {
      start ??= time;
      const progress = Math.min((time - start) / 4000, 1);
      const strength = Math.min(progress * 8, 1, (1 - progress) * 3);
      card.style.setProperty('--edge-proximity', `${strength * 100}`);
      card.style.setProperty('--cursor-angle', `${110 + 355 * progress}deg`);
      if (progress < 1) frame = requestAnimationFrame(tick);
      else card.classList.remove('sweep-active');
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      card.classList.remove('sweep-active');
      card.style.setProperty('--edge-proximity', '0');
    };
  }, [animated]);

  return (
    <div
      ref={cardRef}
      className={`border-glow-card ${className}`}
      onPointerMove={handlePointerMove}
      onPointerLeave={() => cardRef.current.style.setProperty('--edge-proximity', '0')}
      style={{
        '--card-bg': backgroundColor,
        '--edge-sensitivity': Math.max(0, Math.min(79, edgeSensitivity)),
        '--border-radius': `${borderRadius}px`,
        '--glow-padding': `min(${glowRadius}px, 4vw)`,
        '--cone-spread': Math.max(5, Math.min(45, coneSpread)),
        '--fill-opacity': fillOpacity,
        ...glowVariables(glowColor, glowIntensity),
        ...Object.fromEntries(POSITIONS.map((position, index) => [
          `--gradient-${index}`,
          `radial-gradient(at ${position}, ${palette[COLOR_MAP[index] % palette.length]} 0px, transparent 50%)`,
        ])),
        '--gradient-base': `linear-gradient(${palette[0]} 0 100%)`,
      }}
    >
      <span className="edge-light" aria-hidden="true" />
      <div className="border-glow-inner">{children}</div>
    </div>
  );
}
