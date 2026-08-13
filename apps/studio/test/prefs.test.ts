import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createElement, act, type FunctionComponent } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PREF, useLocalPref, useRecipeSetting } from '../src/prefs.js';

/**
 * Two of these hooks are alive at once in the real app — the composer is
 * mounted in the dock and again inside an open shot — so the cases that matter
 * are about what one copy does to the other, and about a recipe borrowing a
 * setting without keeping it. Both need a renderer, so this drives React
 * directly rather than reaching for a testing library the app does not carry.
 */

// React only treats act() as authoritative when it is told it is in a test
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
const roots: Root[] = [];

beforeEach(() => {
  localStorage.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => {
    for (const r of roots.splice(0)) r.unmount();
  });
  container.remove();
});

/** Mount a hook and return a live handle on its latest return value. */
function mount<T>(useHook: () => T): { current: T } {
  const handle = { current: undefined as unknown as T };
  const Probe: FunctionComponent = () => {
    handle.current = useHook();
    return null;
  };
  const host = document.createElement('div');
  container.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  act(() => root.render(createElement(Probe)));
  return handle;
}

describe('useLocalPref', () => {
  it('remembers what it was given', () => {
    const a = mount(() => useLocalPref(PREF.count, 2));
    act(() => a.current[1](4));
    expect(a.current[0]).toBe(4);
    expect(localStorage.getItem(PREF.count)).toBe('4');
  });

  it('starts from what was stored, not the fallback', () => {
    localStorage.setItem(PREF.quality, '"high"');
    const a = mount(() => useLocalPref(PREF.quality, 'standard'));
    expect(a.current[0]).toBe('high');
  });

  it('carries a change to the other copy in the same tab', () => {
    // localStorage's own storage event only fires in *other* tabs, so before
    // this the dock and the overlay drifted apart until one of them remounted
    const dock = mount(() => useLocalPref(PREF.quality, 'standard'));
    const overlay = mount(() => useLocalPref(PREF.quality, 'standard'));

    act(() => overlay.current[1]('high'));
    expect(dock.current[0]).toBe('high');
    expect(overlay.current[0]).toBe('high');
  });

  it('leaves a different key alone', () => {
    const count = mount(() => useLocalPref(PREF.count, 2));
    const format = mount(() => useLocalPref(PREF.format, 'square'));
    act(() => count.current[1](3));
    expect(format.current[0]).toBe('square');
  });
});

describe('useRecipeSetting', () => {
  it('shows the borrowed value without writing it down', () => {
    const s = mount(() => useRecipeSetting(PREF.count, 2));
    act(() => s.current[2](4));
    expect(s.current[0]).toBe(4);
    // the machine's own default is untouched: looking at a 4-variant example
    // is not a decision about what every later shot should cost
    expect(localStorage.getItem(PREF.count)).toBe('2');
  });

  it('hands the pref back when the borrowing ends', () => {
    const s = mount(() => useRecipeSetting(PREF.count, 2));
    act(() => s.current[2](4));
    act(() => s.current[2](null));
    expect(s.current[0]).toBe(2);
  });

  it('picking by hand writes the pref and drops the borrowed value', () => {
    const s = mount(() => useRecipeSetting(PREF.count, 2));
    act(() => s.current[2](4));
    act(() => s.current[1](3));
    expect(s.current[0]).toBe(3);
    expect(localStorage.getItem(PREF.count)).toBe('3');
  });

  it('does not push a borrowed value onto the other copy', () => {
    const dock = mount(() => useRecipeSetting(PREF.count, 2));
    const overlay = mount(() => useRecipeSetting(PREF.count, 2));
    act(() => overlay.current[2](4));
    expect(overlay.current[0]).toBe(4);
    expect(dock.current[0]).toBe(2);
  });
});
