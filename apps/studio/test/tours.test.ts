import { describe, it, expect } from 'vitest';

/** En and em dash, spelled by code point so no dash sits in this file. */
const DASHES = String.fromCharCode(0x2013, 0x2014);
import {
  PAUSE_SELECTOR,
  WELCOME,
  canAutoStart,
  canGoBack,
  canWelcome,
  firstOpenStop,
  settleIndex,
  welcomeSet,
  pageTourId,
  tourConcept,
  tourFor,
  type AutoStartInput,
  type TourId,
  type TourStop,
  type WelcomeInput,
} from '../src/tours.js';
import type { ShowcaseEntry } from '../src/apiTypes.js';

const PAGES: TourId[] = ['home', 'create', 'products', 'presenters', 'scenes'];

describe('the tours', () => {
  it('keeps every page to its stops: ids, targets and counts', () => {
    const shape = Object.fromEntries(PAGES.map((p) => [p, tourFor(p).map((s) => [s.id, s.targets[0]])]));
    expect(shape).toEqual({
      home: [
        ['home.start', '.sc-create-grid'],
        ['home.examples', '.sc-masonry[data-wall]'],
        ['home.create', '[data-tour="nav.create"]'],
      ],
      create: [
        ['create.add', '[data-tour="create.add"]'],
        ['create.prompt', '[data-tour="create.prompt"]'],
        ['create.generate', '[data-tour="create.generate"]'],
      ],
      products: [
        ['products.add', '[data-tour="library.add"]'],
        ['products.ours', '[data-tour="library.ours"] .sc-lookcard'],
      ],
      presenters: [
        ['presenters.add', '[data-tour="library.add"]'],
        ['presenters.ours', '[data-tour="library.ours"] .sc-lookcard'],
      ],
      scenes: [
        ['scenes.add', '[data-tour="library.add"]'],
        ['scenes.ours', '[data-tour="library.ours"] .sc-lookcard'],
      ],
    });
  });

  const copy = () => [...PAGES.flatMap((p) => tourFor(p).flatMap((s) => [s.title, s.body])), ...Object.values(WELCOME)];

  it('no copy carries a dash, an exclamation mark or the word Scenri in lowercase', () => {
    for (const text of copy()) expect(text).not.toMatch(new RegExp(`[${DASHES}!]|\\bscenri\\b`));
  });

  it('teaches the studio, never walks through a control', () => {
    for (const text of copy()) {
      expect(text).not.toMatch(/\b(unique|magic|credits?|compare|heatmap)\b|generate anything/i);
      expect(text).not.toMatch(/\b(press|tap|click|try one now|say what you want)\b|\+/i);
    }
  });

  it('titles never repeat the heading of the empty page beside them', () => {
    const titles = PAGES.flatMap((p) => tourFor(p).map((s) => s.title));
    for (const heading of ['Cast your own presenter', 'Build your own scene', 'Bring in a product', 'Your first shot'])
      expect(titles).not.toContain(heading);
  });

  it('bodies stay to one or two sentences', () => {
    for (const p of PAGES)
      for (const s of tourFor(p)) expect(s.body.split(/[.?]\s/).filter(Boolean).length).toBeLessThanOrEqual(2);
  });

  it('the Create stops keep the whole composer open and are never skipped as done', () => {
    for (const s of tourFor('create')) {
      expect(s.region).toBe('[data-tour="create.prompt"]');
      expect(s.doneWhen).toBeUndefined();
      expect(s.side).toBe('top');
    }
  });

  it('library tours fall back to the top bar + and light only Scenri cards', () => {
    for (const page of ['products', 'presenters', 'scenes'] as const) {
      const [add, ours] = tourFor(page);
      expect(add.targets).toEqual(['[data-tour="library.add"]', '.sc-topbar [aria-label="Add to this brand"]']);
      expect(add.advanceOnParam).toBe('new');
      expect(ours.targets).toEqual(['[data-tour="library.ours"] .sc-lookcard']);
    }
  });

  it('the pause selector never matches the tour card itself', () => {
    expect(PAUSE_SELECTOR).toContain('[role="dialog"]:not(.sc-tour)');
  });
});

describe('welcomeSet', () => {
  const entry = (id: string, product: string | null, scene: string | null, pic = true) =>
    ({
      id,
      title: id,
      category: 'x',
      width: 1,
      height: 1,
      previewUrl: pic ? `/p/${id}` : null,
      brief: {
        tokens: [...(product ? [{ t: 'product', id: product }] : []), ...(scene ? [{ t: 'template', id: scene }] : [])],
      },
    }) as ShowcaseEntry;

  it('shows the first product in wall order that appears in three different worlds', () => {
    const wall = [
      entry('a', 'serum', 'dew'),
      entry('b', 'shoe', 'ash'),
      entry('c', 'serum', 'dew'),
      entry('d', 'shoe', 'ash'),
      entry('e', 'shoe', 'dune'),
      entry('f', 'serum', 'silk'),
      entry('g', 'shoe', 'neon'),
    ];
    expect(welcomeSet(wall).map((e) => e.id)).toEqual(['b', 'e', 'g']);
  });

  it('falls back to three of one product, then to the first three pictures', () => {
    expect(
      welcomeSet([entry('a', 'x', null), entry('b', 'y', null), entry('c', 'x', null), entry('d', 'x', 's')]).map(
        (e) => e.id,
      ),
    ).toEqual(['a', 'c', 'd']);
    expect(
      welcomeSet([
        entry('a', null, null, false),
        entry('b', 'x', null),
        entry('c', 'y', null),
        entry('d', null, null),
      ]).map((e) => e.id),
    ).toEqual(['b', 'c', 'd']);
  });
});

describe('settleIndex and canGoBack', () => {
  const stops = tourFor('create');
  const all = () => true;
  it('a pinned stop is shown even when its step is taken, and gives way when its target is gone', () => {
    const done = (s: TourStop) => s.id === 'create.add';
    expect(settleIndex(stops, 0, false, done, all)).toBe(1);
    expect(settleIndex(stops, 0, true, done, all)).toBe(0);
    expect(
      settleIndex(
        stops,
        0,
        true,
        () => false,
        (s) => s.id !== 'create.add',
      ),
    ).toBe(1);
  });
  it('Back needs a stop that was shown and can still be pointed at', () => {
    expect(canGoBack([], stops, all)).toBe(false);
    expect(canGoBack([{ at: 0 }], stops, all)).toBe(true);
    expect(canGoBack([{ at: 0 }], stops, (s) => s.id !== 'create.add')).toBe(false);
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
  const stops = tourFor('create');
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
