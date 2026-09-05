import { describe, expect, it } from 'vitest';
import {
  GROUPS,
  TABS,
  attachedKeyString,
  attachedKeys,
  columnsFor,
  emptyCopy,
  extraCards,
  shotCards,
  fromCandidate,
  matchesCard,
  stepIndex,
  tabItems,
  type NavGroup,
} from '../src/composer/attach/attachRules.js';
import type { Candidate } from '../src/composer/ingredientOptions.js';
import { identityKeyOf, type SentenceToken } from '../src/composer/line/tokens.js';

const HASH = 'a'.repeat(32);
const HASH2 = 'b'.repeat(32);

describe('the tabs', () => {
  it('lists All first and the groups in the same order as the rail', () => {
    expect(TABS[0]).toBe('All');
    expect(GROUPS).toEqual(TABS.slice(1));
    const items = tabItems({ Products: 2, Presenters: 3, Scenes: 0, Colors: 1, Brand: 0, Shots: 4 });
    expect(items.map((i) => i.label)).toEqual([...TABS]);
    expect(items[0]).toEqual({ value: null, label: 'All', count: 10 });
    expect(items[2]).toEqual({ value: 'Presenters', label: 'Presenters', count: 3 });
  });
});

describe('cards', () => {
  const product: Candidate = {
    kind: 'product',
    id: 'cup',
    label: 'Cup',
    full: 'Cup · Acme · Tin',
    sub: 'Acme',
    search: 'cup acme tin',
    thumb: `/api/images/${HASH}/thumb?w=640`,
    source: 'brand',
    token: { t: 'product', id: 'cup' },
  };
  const presenter: Candidate = {
    kind: 'presenter',
    id: 'astrid',
    label: 'Astrid',
    full: 'Astrid · Cool minimal',
    sub: 'Cool minimal',
    search: 'astrid cool minimal',
    thumb: '/api/presenter-avatars/astrid.jpg?v=9',
    source: 'catalog',
    recommended: true,
    token: { t: 'character', id: 'astrid' },
  };

  it('keys a candidate the way the brief refuses a twin, and sizes its picture for a tile', () => {
    const p = fromCandidate(product);
    expect(p.key).toBe(identityKeyOf({ t: 'product', id: 'cup', angle: 'macro' }));
    expect(p.group).toBe('Products');
    expect(p.shape).toBe('square');
    expect(p.sub).toBe('Acme');
    expect(p.thumb).toBe(`/api/images/${HASH}/thumb?w=320`);
    const a = fromCandidate(presenter);
    expect(a.key).toBe('h:astrid');
    // the descriptor is for the title, not a second line: it truncates to nothing at this size
    expect(a.sub).toBeUndefined();
    expect(a.full).toContain('Recommended');
    expect(a.thumb).toBe('/api/presenter-avatars/astrid.jpg?v=9&w=320');
  });

  it('draws the brand marks and its colours', () => {
    const json = {
      logos: [{ file: `asset:${HASH}`, role: 'primary' }],
      palette: { primary: { hex: '#388DDD', name: 'Primary' } },
    };
    const cards = extraCards(json);
    expect(cards.map((c) => c.group)).toEqual(['Brand', 'Colors']);
    expect(cards[0].token).toEqual({ t: 'mark', imageHash: HASH });
    expect(cards[0].thumb).toBe(`/api/images/${HASH}/thumb?w=160`);
    expect(cards[0].shape).toBe('square');
    expect(cards[1].shape).toBe('swatch');
    expect(cards[1].swatch).toBe('#388DDD');
    expect(cards[1].key).toBe(identityKeyOf({ t: 'color', hex: '#388DDD', name: 'Primary' }));
    expect(matchesCard(cards[1], '388d')).toBe(true);
  });

  it('numbers the finished shots from the brand count, newest first, across pages', () => {
    const shots = [
      { id: 'n1', status: 'done', images: [HASH2] },
      { id: 'n2', status: 'done', images: [HASH] },
    ] as any[];
    const cards = shotCards(shots, 463);
    expect(cards.map((c) => c.label)).toEqual(['Shot 463', 'Shot 462']);
    expect(cards[0].token).toEqual({ t: 'ref', imageHash: HASH2, label: 'Shot' });
    expect(cards[0].thumb).toBe(`/api/images/${HASH2}/thumb?w=160`);
    expect(matchesCard(cards[0], 'shot')).toBe(true);
    expect(matchesCard(cards[0], 'mark')).toBe(false);
    // a count that lags the page never goes below one
    expect(shotCards(shots, 1).map((c) => c.label)).toEqual(['Shot 1', 'Shot 1']);
  });
});

describe('what is already in the shot', () => {
  it('keys every chip and no prose, and reads back as a set', () => {
    const sentence: SentenceToken[] = [
      { t: 'text', v: 'hero shot ' },
      { t: 'product', id: 'cup', angle: 'macro' },
      { t: 'character', id: 'astrid' },
      { t: 'template', id: 'linen' },
      { t: 'ref', imageHash: HASH, label: 'Shot' },
      { t: 'mark', imageHash: HASH2 },
      { t: 'color', hex: '#388DDD', name: 'Primary' },
    ];
    const joined = attachedKeyString(sentence);
    expect(joined).toBe(`p:cup|h:astrid|t:linen|r:${HASH}|m:${HASH2}|c:#388DDD|Primary`);
    const keys = attachedKeys(joined);
    expect(keys.has('p:cup')).toBe(true);
    expect(keys.has('t:linen')).toBe(true);
    // the same rule as the brief's own twin check: a colour renamed since it
    // was attached is a different key there too, so it neither ticks nor refuses
    expect(keys.has('c:#388DDD|Brand blue')).toBe(false);
    expect(attachedKeys('').size).toBe(0);
  });
});

describe('arrow keys', () => {
  // two groups of five over four columns: [0..4] and [5..9]
  const groups: NavGroup[] = [
    { start: 0, end: 4 },
    { start: 5, end: 9 },
  ];
  it('walks the flat order sideways and stops at the ends', () => {
    expect(stepIndex(0, 'ArrowRight', 4, groups)).toBe(1);
    expect(stepIndex(4, 'ArrowRight', 4, groups)).toBe(5);
    expect(stepIndex(9, 'ArrowRight', 4, groups)).toBeNull();
    expect(stepIndex(0, 'ArrowLeft', 4, groups)).toBeNull();
    expect(stepIndex(5, 'ArrowLeft', 4, groups)).toBe(4);
    expect(stepIndex(7, 'Home', 4, groups)).toBe(0);
    expect(stepIndex(2, 'End', 4, groups)).toBe(9);
  });
  it('moves by a row inside a group and lands on the last tile of a short row', () => {
    expect(stepIndex(0, 'ArrowDown', 4, groups)).toBe(4);
    expect(stepIndex(2, 'ArrowDown', 4, groups)).toBe(4);
    expect(stepIndex(4, 'ArrowUp', 4, groups)).toBe(0);
  });
  it('crosses into the next group in the same column, and back', () => {
    expect(stepIndex(4, 'ArrowDown', 4, groups)).toBe(5);
    expect(stepIndex(1, 'ArrowDown', 4, groups)).toBe(4);
    expect(stepIndex(6, 'ArrowUp', 4, groups)).toBe(4);
    expect(stepIndex(5, 'ArrowUp', 4, groups)).toBe(4);
    expect(stepIndex(9, 'ArrowDown', 4, groups)).toBeNull();
  });
  it('goes back to the search field above the first row, even with nothing to navigate', () => {
    expect(stepIndex(1, 'ArrowUp', 4, groups)).toBe('search');
    expect(stepIndex(0, 'ArrowUp', 4, [])).toBe('search');
    expect(stepIndex(0, 'ArrowDown', 4, [])).toBeNull();
  });
});

describe('the grid', () => {
  it('predicts auto-fill: how many tiles fit across a width', () => {
    expect(columnsFor('Presenters', 696, false)).toBe(4);
    expect(columnsFor('Presenters', 976, false)).toBe(6);
    // one grid whatever the kind: the count never changes between tabs
    expect(columnsFor('Products', 696, false)).toBe(4);
    expect(columnsFor('Scenes', 696, false)).toBe(4);
    expect(columnsFor('Shots', 696, false)).toBe(4);
    expect(columnsFor('Presenters', 347, true)).toBe(3);
    expect(columnsFor('Scenes', 347, true)).toBe(3);
    expect(columnsFor('Colors', 696, false)).toBe(4);
    expect(columnsFor('Presenters', 0, false)).toBe(1);
  });
});

describe('an empty grid', () => {
  it('names the tab and the query', () => {
    expect(emptyCopy('Presenters', '')).toBe('No presenters yet.');
    expect(emptyCopy('Presenters', 'zed')).toBe('No matching presenters.');
    expect(emptyCopy('Shots', '')).toBe('No finished shots yet.');
    expect(emptyCopy('Colors', '')).toBe('No brand colors yet.');
    expect(emptyCopy('All', ' zed ')).toBe('Nothing matches “zed”.');
    expect(emptyCopy('All', '')).toBe('Nothing to add yet.');
  });
});
