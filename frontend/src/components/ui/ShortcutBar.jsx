import React from 'react';
import { colors } from '../../theme/colors';
import { tokens } from '../../theme/tokens';

export function ShortcutBar({ shortcuts = [] }) {
  const defaultShortcuts = [
    { key: 'J / K', label: 'Navigate' },
    { key: 'Enter', label: 'Select / Confirm' },
    { key: '⌘ K', label: 'Command Menu' }
  ];

  const items = shortcuts.length > 0 ? shortcuts : defaultShortcuts;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '16px',
        padding: '8px 16px',
        backgroundColor: 'rgba(255, 255, 255, 0.02)',
        borderRadius: tokens.radii.sm,
        border: `1px solid ${colors.border}`,
        fontSize: '11px',
        fontFamily: tokens.fonts.mono,
        color: colors.ink.tertiary
      }}
    >
      <span style={{ color: colors.ink.secondary, fontWeight: 500 }}>Shortcuts:</span>
      {items.map((s, idx) => (
        <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <kbd
            style={{
              padding: '2px 6px',
              backgroundColor: 'rgba(255, 255, 255, 0.06)',
              borderRadius: '4px',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              color: colors.ink.primary,
              fontWeight: 600
            }}
          >
            {s.key}
          </kbd>
          <span>{s.label}</span>
        </div>
      ))}
    </div>
  );
}

export default ShortcutBar;
