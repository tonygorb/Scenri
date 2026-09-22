import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createElement, act, type FunctionComponent } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  ToastProvider,
  useToasts,
  durationFor,
  spokenOf,
  hasActions,
  TOAST_MAX,
  type ToastInput,
} from '../src/toasts.js';

/**
 * The toast stack: kinds, live regions, timers, pause, persist, dedup, cap.
 * The visible card is feedback only. Nothing here writes product state.
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
  vi.useRealTimers();
});

function renderStack(): (t: ToastInput) => void {
  let push: (t: ToastInput) => void = () => {};
  const Probe: FunctionComponent = () => {
    push = useToasts().push;
    return null;
  };
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(createElement(ToastProvider, null, createElement(Probe))));
  return (t) => act(() => push(t));
}

const visible = () =>
  [...document.querySelectorAll<HTMLElement>('.sc-toast')].filter((el) => !el.closest('[data-leaving]'));

describe('durationFor', () => {
  it('errors never auto-dismiss', () => {
    expect(durationFor({ kind: 'error', title: 'Could not save' })).toBe(Infinity);
  });

  it('a short success stays about four seconds', () => {
    expect(durationFor({ kind: 'success', title: 'Archived' })).toBe(4000);
  });

  it('an action gets a longer leash, not immortality', () => {
    const ms = durationFor({ kind: 'success', title: 'Archived', action: { label: 'Undo', onClick: () => {} } });
    expect(ms).toBeGreaterThanOrEqual(9000);
    expect(ms).toBeLessThan(Infinity);
  });

  it('scales with length and caps', () => {
    const long = durationFor({
      kind: 'info',
      title: 'That shot is no longer available to refine',
      detail: 'Making a new shot from what is left of the brief, because the original is gone.',
    });
    expect(long).toBeGreaterThan(4000);
    expect(long).toBeLessThanOrEqual(8000);
  });
});

describe('spokenOf / hasActions', () => {
  it('names the count for a grouped card', () => {
    expect(spokenOf('Could not save the brand', 'Try again', 3)).toBe('Could not save the brand (3 times) Try again');
  });

  it('hasActions reads both shapes', () => {
    expect(hasActions({ action: { label: 'Undo', onClick: () => {} } })).toBe(true);
    expect(hasActions({ actions: [{ label: 'View', onClick: () => {} }] })).toBe(true);
    expect(hasActions({})).toBe(false);
  });
});

describe('ToastProvider', () => {
  it('renders the four kinds with the right marks', () => {
    const push = renderStack();
    push({ kind: 'info', title: 'Guide closed' });
    push({ kind: 'success', title: 'Archived' });
    push({ kind: 'warning', title: 'Logo added, but it is small' });
    expect(document.querySelector('.sc-toast[data-kind="info"] .sc-toast-ic')).toBeNull();
    expect(document.querySelector('.sc-toast[data-kind="success"] .sc-toast-ic')).toBeTruthy();
    expect(document.querySelector('.sc-toast[data-kind="warning"] .sc-toast-ic')).toBeTruthy();
    push({ kind: 'error', title: 'Could not save' });
    expect(document.querySelector('.sc-toast[data-kind="error"] .sc-toast-ic')).toBeTruthy();
    expect(document.querySelector('.sc-toast[data-kind="info"]')).toBeNull();
  });

  it('announces through persistent live regions and never moves focus', () => {
    const before = document.activeElement;
    const push = renderStack();
    push({ kind: 'success', title: 'Archived' });
    push({ kind: 'error', title: 'Could not delete this shot' });
    const polite = document.querySelector('[role="status"][aria-live="polite"]');
    const assertive = document.querySelector('[aria-live="assertive"]');
    expect(polite?.textContent).toBe('Archived');
    expect(assertive?.textContent).toBe('Could not delete this shot');
    // An empty alert on every page would read as a failure that is not there.
    expect(document.querySelector('[role="alert"]')).toBeNull();
    expect(document.querySelector('.sc-toasts')?.tagName).toBe('SECTION');
    expect(document.activeElement).toBe(before);
  });

  it('skips the live region when asked (a shot failure already spoken on the feed)', () => {
    const push = renderStack();
    push({ kind: 'error', title: 'Shot failed', quiet: true });
    expect(document.querySelector('[aria-live="assertive"]')?.textContent).toBe('');
    expect(document.querySelector('.sc-toast')?.textContent).toContain('Shot failed');
  });

  it('auto-dismisses an ephemeral toast and keeps an error', () => {
    vi.useFakeTimers();
    const push = renderStack();
    push({ kind: 'success', title: 'Archived' });
    push({ kind: 'error', title: 'Could not save' });
    expect(visible()).toHaveLength(2);
    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(visible().some((el) => el.getAttribute('data-kind') === 'success')).toBe(false);
    expect(visible().some((el) => el.getAttribute('data-kind') === 'error')).toBe(true);
    act(() => {
      vi.advanceTimersByTime(20_000);
    });
    expect(visible().some((el) => el.getAttribute('data-kind') === 'error')).toBe(true);
  });

  it('pauses the clock while a control inside is focused, and while the tab is hidden', () => {
    vi.useFakeTimers();
    const push = renderStack();
    push({ kind: 'info', title: 'Guide closed' });
    const x = document.querySelector<HTMLButtonElement>('.sc-toast-x')!;
    act(() => x.focus());
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(visible()).toHaveLength(1);
    act(() => x.blur());
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(visible()).toHaveLength(1);
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(visible()).toHaveLength(0);
  });

  it('groups identical actionless events on one card', () => {
    const push = renderStack();
    push({ kind: 'warning', title: 'Only images can be attached here' });
    push({ kind: 'warning', title: 'Only images can be attached here' });
    push({ kind: 'warning', title: 'Only images can be attached here' });
    expect(visible()).toHaveLength(1);
    expect(document.querySelector('.sc-toast-n')?.textContent).toBe('×3');
  });

  it('never merges two Undos or two distinct errors', () => {
    const push = renderStack();
    push({ kind: 'success', title: 'Archived', detail: 'One', action: { label: 'Undo', onClick: () => {} } });
    push({ kind: 'success', title: 'Archived', detail: 'Two', action: { label: 'Undo', onClick: () => {} } });
    expect(visible()).toHaveLength(2);
    act(() => {
      for (const btn of document.querySelectorAll<HTMLButtonElement>('.sc-toast-x')) btn.click();
    });
    push({ kind: 'error', title: 'Could not save the brand' });
    push({ kind: 'error', title: 'Could not delete this shot' });
    expect(visible()).toHaveLength(2);
  });

  it(`caps the stack at ${TOAST_MAX} and never drops an error or an Undo`, () => {
    const push = renderStack();
    push({ kind: 'error', title: 'Could not save' });
    push({ kind: 'success', title: 'Archived', action: { label: 'Undo', onClick: () => {} } });
    push({ kind: 'info', title: 'A' });
    push({ kind: 'info', title: 'B' });
    push({ kind: 'info', title: 'C' });
    const titles = visible().map((el) => el.querySelector('b')?.childNodes[0]?.textContent?.trim());
    expect(visible()).toHaveLength(TOAST_MAX);
    expect(titles).toContain('Could not save');
    expect(titles).toContain('Archived');
    expect(titles).toContain('C');
    expect(titles).not.toContain('A');
  });

  it('gives up an Undo before an error, oldest first, only when nothing else can go', () => {
    const push = renderStack();
    push({ kind: 'error', title: 'Could not save' });
    push({ kind: 'success', title: 'Archived', action: { label: 'Undo', onClick: () => {} } });
    push({ kind: 'error', title: 'Could not delete this shot' });
    push({ kind: 'error', title: 'Could not rename' });
    let titles = visible().map((el) => el.querySelector('b')?.childNodes[0]?.textContent?.trim());
    expect(titles).toEqual(['Could not save', 'Could not delete this shot', 'Could not rename']);
    push({ kind: 'error', title: 'Could not import' });
    titles = visible().map((el) => el.querySelector('b')?.childNodes[0]?.textContent?.trim());
    expect(titles).toEqual(['Could not delete this shot', 'Could not rename', 'Could not import']);
  });

  it('keeps a held card when the same event arrives again, and lets it go after', () => {
    vi.useFakeTimers();
    const push = renderStack();
    push({ kind: 'info', title: 'Guide closed' });
    const x = document.querySelector<HTMLButtonElement>('.sc-toast-x')!;
    act(() => x.focus());
    push({ kind: 'info', title: 'Guide closed' });
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(visible()).toHaveLength(1);
    expect(document.querySelector('.sc-toast-n')?.textContent).toBe('×2');
    act(() => x.blur());
    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(visible()).toHaveLength(0);
  });

  it('does not write any product state of its own', () => {
    const push = renderStack();
    let clicks = 0;
    push({ kind: 'success', title: 'Archived', action: { label: 'Undo', onClick: () => clicks++ } });
    expect(clicks).toBe(0);
    act(() => {
      document.querySelector<HTMLButtonElement>('.sc-toast-act')?.click();
    });
    expect(clicks).toBe(1);
  });
});
