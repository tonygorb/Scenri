import { thumbOf, thumbUrl } from '../../apiUploads.js';
import type { FeedNode } from '../../api.js';
import { attachableMarks, markLabel } from '../../brand/marks.js';
import { flattenPalette } from '../../brand/palette.js';
import { matchesQuery } from '../../layout/library/libraryRules.js';
import type { Candidate, IngredientKind } from '../ingredientOptions.js';
import { identityKeyOf, type SentenceToken } from '../line/tokens.js';

/**
 * The pure decisions behind the attach picker, the "+" in the composer: what
 * its tabs are and in what order, what a tile of each kind carries, which
 * tiles are already in the shot, where an arrow key goes, and what an empty
 * grid says. No React and no DOM, so `test/attachRules.test.ts` covers the
 * rules themselves.
 */

/** One order, for the tab rail and for the groups on All alike. */
export const TABS = ['All', 'Products', 'Presenters', 'Scenes', 'Colors', 'Brand', 'Shots'] as const;
export type AttachTab = (typeof TABS)[number];
export type AttachGroup = Exclude<AttachTab, 'All'>;
export const GROUPS: readonly AttachGroup[] = TABS.filter((t): t is AttachGroup => t !== 'All');

/** What the group row says. */
export const GROUP_LABEL: Record<AttachGroup, string> = {
  Products: 'Products',
  Presenters: 'Presenters',
  Scenes: 'Scenes',
  Colors: 'Brand colors',
  Brand: 'Brand marks',
  Shots: 'Recent shots',
};

/** The kind, said once before a tile's name for a screen reader: "Product: Field Watch". */
export const KIND_ONE: Record<AttachGroup, string> = {
  Products: 'Product',
  Presenters: 'Presenter',
  Scenes: 'Scene',
  Colors: 'Brand color',
  Brand: 'Brand mark',
  Shots: 'Reference shot',
};

/** The plural, for an empty grid and a search with no hits. */
export const NOUN: Record<AttachGroup, string> = {
  Products: 'products',
  Presenters: 'presenters',
  Scenes: 'scenes',
  Colors: 'brand colors',
  Brand: 'brand marks',
  Shots: 'recent shots',
};

/**
 * How a tile of each kind is drawn: every picture is a square in one grid,
 * whatever the tab, so the rhythm never changes as you switch. A scene's
 * 4:5 preview loses a little top and bottom to the square, which is what the
 * chip picker already does with it; a 4:3 box lost twice as much and cut
 * faces in half. A colour is a swatch and needs no picture at all.
 */
export type TileShape = 'square' | 'swatch';
export const SHAPE: Record<AttachGroup, TileShape> = {
  Products: 'square',
  Presenters: 'square',
  Scenes: 'square',
  Colors: 'swatch',
  Brand: 'square',
  Shots: 'square',
};

/**
 * The narrowest a tile may be, in CSS pixels. The grid is
 * `repeat(auto-fill, minmax(min, 1fr))` and reads the same number through
 * `--ap-min`, so the column count `columnsFor` predicts is the one the
 * browser draws.
 *
 * One number for every picture, sized for the thing rather than the width:
 * a face and a packshot read comfortably at 150 to 165px, and the count is
 * whatever that leaves, four across a 720px panel and six across a 1000px
 * one. Letting the width decide gave ten 88px faces on a wide screen, and a
 * different count per kind gave a grid that re-flowed on every tab.
 */
export const TILE_MIN: Record<AttachGroup, number> = {
  Products: 132,
  Presenters: 132,
  Scenes: 132,
  Colors: 0,
  Brand: 132,
  Shots: 132,
};
/** On a phone the tiles are for a thumb: three across at 375. */
export const TILE_MIN_PHONE: Record<AttachGroup, number> = {
  Products: 96,
  Presenters: 96,
  Scenes: 96,
  Colors: 0,
  Brand: 96,
  Shots: 96,
};
export const TILE_GAP = 10;

/** How many tiles of a kind fit across `width`: `auto-fill`'s own arithmetic. */
export function columnsFor(group: AttachGroup, width: number, phone: boolean): number {
  const min = (phone ? TILE_MIN_PHONE : TILE_MIN)[group];
  if (min <= 0 || width <= 0) return 1;
  return Math.max(1, Math.floor((width + TILE_GAP) / (min + TILE_GAP)));
}

/** One thing the picker can put in the shot, pre-resolved so the tile never reaches back into a catalog. */
export interface AttachCard {
  /** `identityKeyOf(token)`: the same key the brief refuses a twin on. */
  key: string;
  group: AttachGroup;
  shape: TileShape;
  label: string;
  /** A second caption line, only where the picture cannot tell two apart (a product's brand). */
  sub?: string;
  /** The whole truth, for `title=`. */
  full: string;
  /** Matched on, never shown. */
  search: string;
  thumb?: string | null;
  crop?: 'top';
  swatch?: string;
  recommended?: boolean;
  bookmarked?: boolean;
  token: SentenceToken;
}

const GROUP_OF: Record<IngredientKind, AttachGroup> = {
  product: 'Products',
  presenter: 'Presenters',
  scene: 'Scenes',
};

/** A product, presenter or scene from the shared candidate model, sized for a picker tile. */
export function fromCandidate(c: Candidate): AttachCard {
  const group = GROUP_OF[c.kind];
  return {
    key: identityKeyOf(c.token),
    group,
    shape: SHAPE[group],
    label: c.label,
    sub: c.kind === 'product' ? c.sub : undefined,
    full: c.recommended ? `${c.full} · Recommended` : c.full,
    search: c.search,
    thumb: thumbOf(c.thumb ?? null, 'small'),
    crop: c.crop,
    recommended: c.recommended,
    bookmarked: c.bookmarked,
    token: c.token,
  };
}

/**
 * The brand's own things: its marks, its colours and its finished shots.
 * These have no candidate model; the panel is the only surface that lists
 * them together. Newest shot first, already done: the workspace answer
 * carries the shelf.
 */
export function extraCards(brandJson: unknown, shots: readonly FeedNode[]): AttachCard[] {
  const marks = attachableMarks(brandJson).map((m): AttachCard => {
    const hash = m.hash as string;
    const label = markLabel(brandJson, m);
    return {
      key: `m:${hash}`,
      group: 'Brand',
      shape: 'square',
      label,
      full: `${label} · the mark itself`,
      search: label,
      thumb: thumbUrl(hash, 'micro'),
      token: { t: 'mark', imageHash: hash },
    };
  });
  const colors = flattenPalette((brandJson as { palette?: unknown } | null)?.palette).map((c): AttachCard => {
    const token: SentenceToken = { t: 'color', hex: c.hex, name: c.name };
    return {
      key: identityKeyOf(token),
      group: 'Colors',
      shape: 'swatch',
      label: c.name,
      full: `${c.name} · ${c.hex}`,
      search: `${c.name} ${c.hex}`,
      swatch: c.hex,
      token,
    };
  });
  const recent = shots.filter((s) => s.status === 'done' && s.images.length > 0).slice(0, 12);
  const refs = recent.map((s, i): AttachCard => {
    const label = `Shot ${recent.length - i}`;
    return {
      key: `r:${s.images[0]}`,
      group: 'Shots',
      shape: 'square',
      label,
      full: `${label} · joins the shot as a reference image`,
      search: label,
      thumb: thumbUrl(s.images[0], 'micro'),
      token: { t: 'ref', imageHash: s.images[0], label: 'Shot' },
    };
  });
  return [...marks, ...colors, ...refs];
}

/** The library matcher over a card's own words, for the kinds with no candidate model. */
export const matchesCard = (card: AttachCard, q: string): boolean =>
  matchesQuery(`${card.label} ${card.sub ?? ''} ${card.search}`, q);

/**
 * What the shot already holds, as one string: the composer memoises on it,
 * because the sentence is a new array on every keystroke and a Set keyed on
 * the array would repaint every tile as you type. Text keys to nothing and
 * is left out.
 */
export function attachedKeyString(sentence: readonly SentenceToken[]): string {
  return sentence
    .map(identityKeyOf)
    .filter((k) => k.length > 0)
    .join('|');
}
export function attachedKeys(joined: string): ReadonlySet<string> {
  return new Set(joined ? joined.split('|') : []);
}

/** A run of tiles in the flat navigation order: one group's grid. `end` is inclusive. */
export interface NavGroup {
  start: number;
  end: number;
}
export type NavKey = 'ArrowRight' | 'ArrowLeft' | 'ArrowDown' | 'ArrowUp' | 'Home' | 'End';
export const NAV_KEYS: ReadonlySet<string> = new Set([
  'ArrowRight',
  'ArrowLeft',
  'ArrowDown',
  'ArrowUp',
  'Home',
  'End',
]);

/**
 * Where an arrow goes from tile `i`. Left and right walk the flat order;
 * up and down move by the focused grid's column count and, at a group's
 * edge, cross into the neighbouring group's nearest row in the same column.
 * Up off the first row goes back to the search field, so the keyboard is
 * never stranded; anything with nowhere to go answers null and the caller
 * leaves focus where it is.
 */
export function stepIndex(i: number, key: NavKey, cols: number, groups: readonly NavGroup[]): number | 'search' | null {
  const count = groups.length ? groups[groups.length - 1].end + 1 : 0;
  if (count === 0) return key === 'ArrowUp' ? 'search' : null;
  const c = Math.max(1, cols);
  const g = groups.findIndex((r) => i >= r.start && i <= r.end);
  const cur = groups[g] ?? { start: 0, end: count - 1 };
  const col = (i - cur.start) % c;
  const lastRowOf = (r: NavGroup) => r.start + Math.floor((r.end - r.start) / c) * c;
  switch (key) {
    case 'ArrowRight':
      return i + 1 < count ? i + 1 : null;
    case 'ArrowLeft':
      return i > 0 ? i - 1 : null;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    case 'ArrowDown': {
      if (i + c <= cur.end) return i + c;
      if (i < lastRowOf(cur)) return cur.end;
      const next = groups[g + 1];
      return next ? next.start + Math.min(col, next.end - next.start) : null;
    }
    case 'ArrowUp': {
      if (i - c >= cur.start) return i - c;
      const prev = groups[g - 1];
      if (!prev) return 'search';
      return Math.min(prev.end, lastRowOf(prev) + col);
    }
  }
}

/** What an empty grid says: the tab's noun, and the query when there was one. */
export function emptyCopy(tab: AttachTab, query: string): string {
  const q = query.trim();
  if (tab === 'All') return q ? `Nothing matches “${q}”.` : 'Nothing to add yet.';
  if (q) return `No matching ${NOUN[tab]}.`;
  return tab === 'Shots' ? 'No finished shots yet.' : `No ${NOUN[tab]} yet.`;
}

/** The rail's items, All first with the total. */
export function tabItems(
  counts: Record<AttachGroup, number>,
): { value: string | null; label: string; count: number }[] {
  const total = GROUPS.reduce((n, g) => n + counts[g], 0);
  return [
    { value: null, label: 'All', count: total },
    ...GROUPS.map((g) => ({ value: g, label: g, count: counts[g] })),
  ];
}
