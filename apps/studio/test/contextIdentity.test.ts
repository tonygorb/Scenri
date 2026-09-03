import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createElement, act, useState, type FunctionComponent } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ToastProvider, useToasts } from '../src/toasts.js';

/**
 * A provider's value must keep its identity across a render that changed
 * nothing in it. Every consumer of a context re-renders when the value object
 * is new, so an inline `value={{ ... }}` turns one parent render into a
 * re-render of every subscriber. These probes hold the line for the providers
 * that own no data of their own.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
const roots: Root[] = [];

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => {
    for (const r of roots.splice(0)) r.unmount();
  });
  container.remove();
});

describe('context value identity', () => {
  it('useToasts() is the same object after an unrelated parent re-render', () => {
    const seen: unknown[] = [];
    let bump: (() => void) | null = null;
    const Probe: FunctionComponent = () => {
      seen.push(useToasts());
      return null;
    };
    const Parent: FunctionComponent = () => {
      const [n, setN] = useState(0);
      bump = () => setN((x) => x + 1);
      return createElement(ToastProvider, null, createElement(Probe, { key: n }));
    };
    const root = createRoot(container);
    roots.push(root);
    act(() => root.render(createElement(Parent)));
    act(() => bump?.());
    expect(seen.length).toBe(2);
    expect(seen[1]).toBe(seen[0]);
  });
});
