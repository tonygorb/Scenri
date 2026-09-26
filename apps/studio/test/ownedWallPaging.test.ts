import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { Theme } from '@radix-ui/themes';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PresentersView } from '../src/views/Presenters.js';
import { ScenesView } from '../src/views/Scenes.js';

/**
 * The brand's own half of the Presenters and Scenes walls mounted every card
 * it had: a thousand of your own was a thousand cards in the DOM, and opening
 * a studio over the wall re-rendered all of them. It pages the way the
 * catalog half and Products already do, sixty at a time.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const OWNED = 1000;
const owned = vi.hoisted(() => ({ presenters: [] as unknown[], scenes: [] as unknown[] }));

vi.mock('../src/brandAssets.js', async (actual) => ({
  ...(await actual<typeof import('../src/brandAssets.js')>()),
  customPresentersOf: () => owned.presenters,
  customScenesOf: () => owned.scenes,
}));
vi.mock('../src/api.js', async (actual) => {
  const real = await actual<typeof import('../src/api.js')>();
  return { ...real, api: { ...real.api, presenterDrafts: () => Promise.resolve({ drafts: [] }) } };
});
vi.mock('../src/app/AppShell.js', () => ({
  useAppData: () => ({
    presenters: [],
    presenterCategories: [],
    presentersLoaded: true,
    presentersError: null,
    scenes: [],
    collections: [],
    verticals: [],
    loaded: true,
    error: null,
    refetch: () => {},
    refetchPresenters: () => {},
    applyBrand: () => {},
    refreshBrands: async () => {},
  }),
}));
vi.mock('../src/app/BrandLayout.js', () => ({ useBrand: () => ({ brand: { id: 'b1', slug: 'b', json: {} } }) }));
vi.mock('../src/app/TaskCenter.js', () => ({
  useTaskCenter: () => ({ tasks: [], builds: [], studio: [], poke: () => {} }),
}));
vi.mock('../src/create/AssetCreateHost.js', () => ({ useCreateAsset: () => () => {} }));
vi.mock('../src/app/useApplyPresenter.js', () => ({ useApplyPresenter: () => () => {} }));
vi.mock('../src/app/useApplyScene.js', () => ({ useApplyScene: () => () => {} }));

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  window.matchMedia ??= ((q: string) => ({
    matches: false,
    media: q,
    addEventListener() {},
    removeEventListener() {},
  })) as unknown as typeof window.matchMedia;
  for (const name of ['IntersectionObserver', 'ResizeObserver']) {
    vi.stubGlobal(
      name,
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
  }
  owned.presenters = Array.from({ length: OWNED }, (_, i) => ({
    id: `p${i}`,
    name: `Person ${i}`,
    suitableCategories: [],
    suitableStyles: [],
  }));
  owned.scenes = Array.from({ length: OWNED }, (_, i) => ({
    id: `s${i}`,
    name: `Place ${i}`,
    verticals: [],
    collections: [],
  }));
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

function mount(view: () => JSX.Element) {
  act(() => {
    root.render(createElement(MemoryRouter, null, createElement(Theme, null, createElement(view))));
  });
}

const ownedCards = () => host.querySelectorAll('.sc-owned .sc-lookcard').length;
const more = () =>
  [...host.querySelectorAll<HTMLButtonElement>('.sc-owned .sc-lib-more button')].find((b) =>
    b.textContent?.startsWith('Show'),
  );

describe.each([
  ['presenters', PresentersView, 'Person 0'],
  ['scenes', ScenesView, 'Place 0'],
])('your own %s', (_, view, head) => {
  it('mount the first page of a thousand and grow a page at a time', () => {
    mount(view);
    expect(ownedCards()).toBe(60);
    // the head of the list, where something just made lands (newest first)
    expect(host.querySelector('.sc-owned .sc-lookcard')?.textContent).toContain(head);
    expect(more()?.textContent).toBe('Show 60 more');
    act(() => more()?.click());
    expect(ownedCards()).toBe(120);
  });
});
