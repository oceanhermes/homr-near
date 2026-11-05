// HOMR App Design Tokens - Colors from DESIGN_DECISIONS.md
export const colors = {
  // Surfaces
  canvas: '#0B0B0D',       // Deepest background
  base: '#131316',         // Section background
  card: '#1A1A1E',         // Elevated card / row background
  cardHover: '#232329',    // Row hover background
  border: '#26262E',       // Hairline border
  hairline: '#1E1E24',     // Section divider

  // Accent (used sparingly for focus, active tab, status dot)
  accent: '#7C7CFF',       // Electric-violet
  accentGlow: 'rgba(124, 124, 255, 0.15)',

  // State Chips & Status Tokens (JetBrains Mono font)
  state: {
    onchain: {
      color: '#7CFFB2',
      bg: 'rgba(124, 255, 178, 0.08)',
      border: 'rgba(124, 255, 178, 0.25)',
      label: 'Onchain'
    },
    offchain: {
      color: '#FFD66B',
      bg: 'rgba(255, 214, 107, 0.08)',
      border: 'rgba(255, 214, 107, 0.25)',
      label: 'Verified offchain'
    },
    pending: {
      color: '#90CAF9',
      bg: 'rgba(144, 202, 249, 0.08)',
      border: 'rgba(144, 202, 249, 0.25)',
      label: 'Pending review'
    }
  },

  // Typography Ink Colors (Inverted dark mode opacities)
  ink: {
    primary: 'rgba(255, 255, 255, 0.94)',
    secondary: 'rgba(255, 255, 255, 0.68)',
    tertiary: 'rgba(255, 255, 255, 0.44)',
    quaternary: 'rgba(255, 255, 255, 0.24)',
  }
};
