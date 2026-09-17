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

function mount(props: Partial<CoachmarkProps>) {
  const page = document.createElement('main');
  page.innerHTML = '<input id="field" /><button id="target">Target</button><div id="surface"></div>';
  document.body.append(page);
  host = document.createElement('div');
  document.body.append(host);
  const base: CoachmarkProps = {
    id: 'step',
    voice: 'card',
    target: document.getElementById('target'),
    surfaces: [],
    side: 'bottom',
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
    expect(document.querySelector('.sc-coach-veil, .sc-coach-catch')).toBeNull();
    expect(document.querySelectorAll('[data-sc-coach-inert]')).toHaveLength(0);
    expect(document.activeElement).toBe(field);
  });

  it('a coach is a dialog over a curtain, named by its title', () => {
    mount({ voice: 'coach', surfaces: [] });
    const card = document.querySelector('.sc-coach');
    expect(card?.getAttribute('role')).toBe('dialog');
    expect(document.getElementById(card?.getAttribute('aria-labelledby') ?? '')?.textContent).toBe('A title');
    expect(document.querySelector('.sc-coach-veil')).not.toBeNull();
    expect(document.querySelector('[data-guide="catch"]')).not.toBeNull();
  });

  it('a coach whose words sit in a slot draws the curtain and no card', () => {
    mount({ voice: 'coach', target: null, title: undefined, body: undefined, surfaces: [document.body] });
    expect(document.querySelector('.sc-coach')).toBeNull();
    expect(document.querySelector('.sc-coach-veil')).not.toBeNull();
  });

  it('a card with no title leads with its sentence; Done and Back only when asked for', () => {
    mount({ voice: 'card', title: undefined, body: 'Only this.', action: 'done', canBack: false });
    expect(document.querySelector('.sc-coach-body[data-lead]')?.textContent).toBe('Only this.');
    expect(document.querySelector('.sc-coach-next')?.textContent).toBe('Done');
    expect(document.querySelector('.sc-coach-back')).toBeNull();
  });
});
