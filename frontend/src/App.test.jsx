// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { App } from './main';

beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.requestAnimationFrame = (callback) => {
    callback();
    return 1;
  };
});

afterEach(cleanup);

describe('HOMR landing page interactions', () => {
  it('opens the journey dialog and closes it with Escape', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><App /></MemoryRouter>);

    const ctaButtons = screen.getAllByRole('button', { name: 'Open dashboard' });
    await user.click(ctaButtons[0]);
    expect(screen.getByRole('dialog')).toBeTruthy();

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('chooses the borrower dashboard and updates its journey', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><App /></MemoryRouter>);

    await user.click(screen.getAllByRole('button', { name: 'Open dashboard' })[0]);
    await user.click(screen.getByRole('button', { name: /Borrower/ }));

    expect(screen.getByText('Get approved')).toBeTruthy();
    expect(within(screen.getByRole('region', { name: 'Compete for capital while keeping sensitive documents private.' })).getByText('Commit and reveal your bid')).toBeTruthy();
    expect(window.HTMLElement.prototype.scrollIntoView).toHaveBeenCalled();
  });

  it('uses scroll-only journeys and toggles the mobile menu state', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><App /></MemoryRouter>);

    expect(screen.queryByRole('tablist', { name: 'Choose a journey' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Investor', exact: true })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Borrower', exact: true })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Menu' }));
    expect(screen.getByRole('button', { name: 'Close' }).getAttribute('aria-expanded')).toBe('true');
    await user.click(screen.getByRole('link', { name: 'Risks' }));
    expect(screen.getByRole('button', { name: 'Menu' }).getAttribute('aria-expanded')).toBe('false');
  });
});
