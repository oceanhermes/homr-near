// @vitest-environment jsdom
import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import DataLabelChip from '../components/ui/DataLabelChip';

describe('DataLabelChip', () => {
  it('does not render the Onchain badge', () => {
    const { container } = render(<DataLabelChip type="onchain" />);
    expect(container.firstChild).toBeNull();
  });

  it('renders Verified offchain label correctly', () => {
    render(<DataLabelChip type="offchain" />);
    expect(screen.getByText('Verified offchain')).toBeTruthy();
  });

  it('renders Pending review label correctly', () => {
    render(<DataLabelChip type="pending" />);
    expect(screen.getByText('Pending review')).toBeTruthy();
  });

});
