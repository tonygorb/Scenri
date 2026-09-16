import { describe, it, expect } from 'vitest';

/** En and em dash, spelled by code point so no dash sits in this file. */
const DASHES = String.fromCharCode(0x2013, 0x2014);
import {
  PAUSE_SELECTOR,
  canAutoStart,
  canWelcome,
  firstOpenStop,
  pageTourId,
  tourConcept,
  tourFor,
  type AutoStartInput,
  type TourId,
  type WelcomeInput,
} from '../src/tours.js';

const PAGES: TourId[] = ['home', 'create', 'products', 'presenters', 'scenes'];

describe('the tours', () => {
  it('every page has two or three stops with unique ids and a target', () => {
    for (const page of PAGES) {
      const stops = tourFor(page, { touch: false, ownsProducts: false });
      expect(stops.length).toBeGreaterThanOrEqual(2);
      expect(stops.length).toBeLessThanOrEqual(3);
      expect(new Set(stops.map((s) => s.id)).size).toBe(stops.length);
      for (const s of stops) expect(s.targets.length).toBeGreaterThan(0);
    }
  });

  it('no copy carries a dash, an exclamation mark or the word Scenri in lowercase', () => {
    for (const page of PAGES)
      for (const touch of [true, false])
        for (const ownsProducts of [true, false])
          for (const s of tourFor(page, { touch, ownsProducts })) {
            expect(`${s.title} ${s.body}`).not.toMatch(new RegExp(`[${DASHES}!]|\\bscenri\\b`));
          }
  });

  it('Create points touch at the + and names owned products', () => {
    const [add] = tourFor('create', { touch: true, ownsProducts: true });
    expect(add.body).toBe('Tap + for your products, a presenter or a scene.');
    const [pointer] = tourFor('create', { touch: false, ownsProducts: false });
    expect(pointer.body).toBe('Press + for a product, a presenter or a scene, or type $, @ or / in the prompt.');
  });

  it('Create stops read what the composer publishes, never any chip', () => {
    const [add, prompt] = tourFor('create', { touch: false, ownsProducts: false });
    expect(add.doneWhen).toBe('[data-tour="create.prompt"][data-ingredients]');
    expect(prompt.doneWhen).toBe('[data-tour="create.prompt"][data-words]');
  });

  it('library tours fall back to the top bar + and light only Scenri cards', () => {
    for (const page of ['products', 'presenters', 'scenes'] as const) {
      const [add, ours] = tourFor(page, { touch: false, ownsProducts: false });
      expect(add.targets).toEqual(['[data-tour="library.add"]', '.sc-topbar [aria-label="Add to this brand"]']);
      expect(add.advanceOnParam).toBe('new');
      expect(ours.targets).toEqual(['[data-tour="library.ours"] .sc-lookcard']);
    }
  });

  it('the pause selector never matches the tour card itself', () => {
    expect(PAUSE_SELECTOR).toContain('[role="dialog"]:not(.sc-tour)');
  });
});

describe('pageTourId', () => {
  const none = { home: false, hub: false, ungrouped: false, products: false, presenters: false, scenes: false };
  it('maps the five pages', () => {
    expect(pageTourId({ ...none, home: true })).toBe('home');
    expect(pageTourId({ ...none, hub: true })).toBe('create');
    expect(pageTourId({ ...none, products: true })).toBe('products');
    expect(pageTourId({ ...none, presenters: true })).toBe('presenters');
    expect(pageTourId({ ...none, scenes: true })).toBe('scenes');
  });
  it('the ungrouped view and everything else have none', () => {
    expect(pageTourId({ ...none, hub: true, ungrouped: true })).toBeNull();
    expect(pageTourId(none)).toBeNull();
  });
});

describe('firstOpenStop', () => {
  const stops = tourFor('create', { touch: false, ownsProducts: false });
  const all = () => true;
  const never = () => false;
  it('starts at the first step not yet taken', () => {
    expect(firstOpenStop(stops, 0, never, all)).toBe(0);
    expect(firstOpenStop(stops, 0, (s) => s.id === 'create.add', all)).toBe(1);
    expect(firstOpenStop(stops, 0, (s) => s.id !== 'create.generate', all)).toBe(2);
  });
  it('skips what has nothing to point at, and runs out past the end', () => {
    expect(firstOpenStop(stops, 0, never, (s) => s.id === 'create.generate')).toBe(2);
    expect(firstOpenStop(stops, 0, all, all)).toBe(stops.length);
    expect(firstOpenStop(stops, 1, never, never)).toBe(stops.length);
  });
});

describe('canAutoStart', () => {
  const base: AutoStartInput = {
    page: 'products',
    eligible: true,
    learned: ['welcome'],
    paused: false,
    ready: true,
    engineReady: false,
    refining: false,
    active: false,
  };
  it('starts on a ready page for someone new who has been welcomed', () => {
    expect(canAutoStart(base)).toBe(true);
  });
  it.each<[string, Partial<AutoStartInput>]>([
    ['no tour page', { page: null }],
    ['a tour already running', { active: true }],
    ['an upgraded install', { eligible: false }],
    ['something else on screen', { paused: true }],
    ['a page still loading', { ready: false }],
    ['before the welcome', { learned: [] }],
    ['after tours were turned off', { learned: ['welcome', 'tours-off'] }],
    ['a tour already learned', { learned: ['welcome', tourConcept('products')] }],
    ['Create with no engine', { page: 'create', engineReady: false }],
    ['Create with a refine armed', { page: 'create', engineReady: true, refining: true }],
  ])('not with %s', (_why, patch) => {
    expect(canAutoStart({ ...base, ...patch })).toBe(false);
  });
  it('Create starts once an engine can generate', () => {
    expect(canAutoStart({ ...base, page: 'create', engineReady: true })).toBe(true);
  });
});

describe('canWelcome', () => {
  const base: WelcomeInput = {
    page: 'home',
    eligible: true,
    learned: [],
    ready: true,
    visible: true,
    paused: false,
    busy: false,
  };
  it('welcomes someone new on a ready, quiet page', () => {
    expect(canWelcome(base)).toBe(true);
  });
  it.each<[string, Partial<WelcomeInput>]>([
    ['off a tour page', { page: null }],
    ['an upgraded install', { eligible: false }],
    ['a second time', { learned: ['welcome'] }],
    ['a page still loading', { ready: false }],
    ['a hidden tab', { visible: false }],
    ['a dialog open', { paused: true }],
    ['work running', { busy: true }],
  ])('not for %s', (_why, patch) => {
    expect(canWelcome({ ...base, ...patch })).toBe(false);
  });
});
