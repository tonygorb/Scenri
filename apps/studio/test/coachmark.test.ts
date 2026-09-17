import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { createElement, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Theme } from '@radix-ui/themes';
import { Coachmark, type CoachmarkProps } from '../src/layout/Coachmark.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeAll(() => {
  // jsdom lays nothing out: these only need to exist.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  window.matchMedia ??= ((q: string) => ({
    matches: false,
    media: q,
    addEventListener() {},
    removeEventListener() {},
  })) as unknown as typeof window.matchMedia;
});

let root: Root | null = null;
let host: HTMLElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host?.remove();
  document.body.innerHTML = '';
});

const noop = () => {};

function mount(props: Partial<CoachmarkProps>, o: { inShell?: boolean } = {}) {
  const page = document.createElement('main');
  page.innerHTML =
    '<input id="field" /><button id="target">Target</button><div id="surface"></div><div id="shell"><p id="inside">x</p></div>';
  document.body.append(page);
  host = document.createElement('div');
  document.body.append(host);
  const base: CoachmarkProps = {
    id: 'step',
    voice: 'card',
    target: document.getElementById('target'),
    surfaces: [],
    live: [],
    side: 'bottom',
    container: o.inShell ? (document.getElementById('shell') as HTMLElement) : document.body,
    title: 'A title',
    body: 'One sentence.',
    canBack: false,
    action: null,
    closeLabel: 'Close guide',
    onBack: noop,
    onAction: noop,
    onClose: noop,
    onEscape: noop,
    onShown: noop,
  };
  act(() => {
    root = createRoot(host as HTMLElement);
    root.render(createElement(Theme, null, createElement(Coachmark, { ...base, ...props })));
  });
}

describe('Coachmark', () => {
  it('a card points and holds nothing: no curtain, no inert page, focus stays where it was', () => {
    const field = document.createElement('input');
    document.body.append(field);
    field.focus();
    mount({ voice: 'card' });
    const card = document.querySelector('.sc-coach');
    expect(card?.getAttribute('role')).toBe('note');
    expect(card?.getAttribute('data-voice')).toBe('card');
    expect(document.querySelector('.sc-coach-veil, .sc-coach-catch, .sc-coach-rim')).toBeNull();
    expect(document.querySelectorAll('[data-sc-coach-inert]')).toHaveLength(0);
    expect(document.activeElement).toBe(field);
  });

  it('a coach is a dialog over a curtain with its windows, rims and catch panels, named by its title', () => {
    mount({ voice: 'coach', surfaces: [] });
    const card = document.querySelector('.sc-coach');
    expect(card?.getAttribute('role')).toBe('dialog');
    expect(document.getElementById(card?.getAttribute('aria-labelledby') ?? '')?.textContent).toBe('A title');
    expect(document.querySelector('.sc-coach-veil')).not.toBeNull();
    expect(document.querySelector('.sc-coach-rim')).not.toBeNull();
    expect(document.querySelector('[data-guide="catch"]')).not.toBeNull();
  });

  it('inside a shell that owns the screen, the whole coach is drawn inside that shell', () => {
    mount({ voice: 'coach', surfaces: [], target: null, title: undefined, body: undefined }, { inShell: true });
    const shell = document.getElementById('shell') as HTMLElement;
    expect(shell.querySelector('.sc-coach-veil')).not.toBeNull();
    expect(shell.querySelector('.sc-coach-rim')).not.toBeNull();
    expect(document.querySelector('body > .sc-coach-veil')).toBeNull();
  });

  it('the one button says what it does; Back only when asked for; a card beside its target is marked narrow', () => {
    mount({ voice: 'card', action: { label: 'Continue' }, canBack: false, beside: true });
    expect(document.querySelector('.sc-coach-next')?.textContent).toBe('Continue');
    expect(document.querySelector('.sc-coach-back')).toBeNull();
    expect(document.querySelector('.sc-coach')?.hasAttribute('data-beside')).toBe(true);
  });

  it('a checklist ticks what is in, an open row takes the person to it, and Continue waits for all of it', () => {
    const asked: string[] = [];
    let acted = 0;
    mount({
      voice: 'card',
      checklist: [
        { id: 'product', label: 'Product', done: true },
        { id: 'presenter', label: 'Presenter', done: false },
      ],
      onCheck: (id) => asked.push(id),
      action: { label: 'Continue', disabled: true },
      onAction: () => acted++,
    });
    const rows = [...document.querySelectorAll('.sc-coach-item')];
    expect(rows.map((r) => r.textContent)).toEqual(['Product, added', 'Presenter, not added yet']);
    // a ticked row is a statement, not a button
    expect(rows[0].tagName).toBe('SPAN');
    act(() => (rows[1] as HTMLButtonElement).click());
    expect(asked).toEqual(['presenter']);
    const next = document.querySelector<HTMLButtonElement>('.sc-coach-next');
    expect(next?.getAttribute('aria-disabled')).toBe('true');
    act(() => next?.click());
    expect(acted).toBe(0);
  });
});
