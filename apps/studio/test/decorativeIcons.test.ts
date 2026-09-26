import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

/**
 * Every Phosphor glyph in the studio is decoration: a control that is only an
 * icon names itself with its own aria-label. Unhidden, each svg was an
 * unnamed image to a screen reader, thirty to fifty of them a screen. The
 * entry installs the default once, and the svg keeps Phosphor's own size and
 * colour, which a provider replaces rather than merges.
 */

const seen = vi.hoisted(() => ({ tree: null as ReactNode }));

vi.mock('react-dom/client', () => ({
  createRoot: () => ({
    render: (tree: ReactNode) => {
      seen.tree = tree;
    },
  }),
}));
vi.mock('../src/router.js', () => ({ router: {} }));
// The app under the providers, reduced to one icon with no props of its own.
vi.mock('react-router', async () => {
  const { X } = await import('@phosphor-icons/react');
  return { RouterProvider: () => createElement(X) };
});
vi.mock('../src/theme.js', () => ({ ThemeProvider: ({ children }: { children: ReactNode }) => children }));
vi.mock('../src/toasts.js', () => ({ ToastProvider: ({ children }: { children: ReactNode }) => children }));

describe('icons at the root of the studio', () => {
  it('are hidden from assistive technology and keep their default size and colour', async () => {
    // a saved theme, so the entry never asks jsdom for matchMedia
    localStorage.setItem('sc-theme', 'dark');
    await import('../src/main.js');
    const svg = renderToStaticMarkup(seen.tree as never);
    expect(svg).toMatch(/^<svg /);
    expect(svg).toContain('aria-hidden="true"');
    expect(svg).toContain('width="1em"');
    expect(svg).toContain('height="1em"');
    expect(svg).toContain('fill="currentColor"');
  });
});
