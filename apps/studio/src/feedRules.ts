/**
 * The pure decisions behind the Create feed's search and sort — kept free of
 * React/DOM so `test/feedRules.test.ts` can cover the actual logic directly,
 * the same split `layout/library/libraryRules.ts` makes for the library pages.
 */

import type { TreeNode } from './api.js';
import type { BriefToken } from './composer/line.js';
import { matchesQuery } from './layout/library/libraryRules.js';

export type FeedSort = 'newest' | 'oldest' | 'cost' | 'keepers';

export const FEED_SORTS: ReadonlyArray<{ id: FeedSort; label: string }> = [
  { id: 'newest', label: 'Newest first' },
  { id: 'oldest', label: 'Oldest first' },
  { id: 'cost', label: 'Highest cost' },
  { id: 'keepers', label: 'Keepers first' },
];

/** Guards a pref read: localStorage may hold a value from a future or past build. */
export function isFeedSort(v: unknown): v is FeedSort {
  return FEED_SORTS.some((s) => s.id === v);
}

/**
 * A lens narrows the place you are already in. It is not the place: a set is
 * somewhere you can be, with its own address, and "keepers" is a way of
 * looking at wherever you are — including inside that set. The two used to be
 * one control, so asking for keepers while inside a set threw you out of it.
 */
export type Lens = 'all' | 'keepers' | 'archived';

export const LENSES: ReadonlyArray<{ id: Lens; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'keepers', label: 'Keepers' },
  { id: 'archived', label: 'Archived' },
];

/** Guards a URL read. `?tab=ungrouped` was a lens once and is a place now. */
export function isLens(v: unknown): v is Lens {
  return LENSES.some((l) => l.id === v);
}

/**
 * The lens, over a place that has already been scoped.
 *
 * Both halves of the place arrive separately because archived shots are held
 * out of the live list everywhere else in the app — so "archived, inside this
 * set" is a different array, not a flag to filter on.
 */
export function applyLens(live: TreeNode[], archived: TreeNode[], lens: Lens): TreeNode[] {
  if (lens === 'archived') return archived;
  if (lens === 'keepers') return live.filter((n) => n.kept);
  return live;
}

/**
 * What each tab would actually show from here — scoped to the current place
 * and narrowed by the current search, so the numbers describe the collection
 * in front of you rather than the whole brand. This is what lets the row drop
 * its separate result count: the tabs already say it.
 */
export function countLenses(
  live: TreeNode[],
  archived: TreeNode[],
  q: string,
  textFor: (n: TreeNode) => string,
): Record<Lens, number> {
  const l = filterFeed(live, q, textFor);
  return {
    all: l.length,
    keepers: l.reduce((n, s) => n + (s.kept ? 1 : 0), 0),
    archived: filterFeed(archived, q, textFor).length,
  };
}

/** Newest first — the ordering the feed has always used. */
export const byNewest = (a: TreeNode, b: TreeNode): number => b.createdAt.localeCompare(a.createdAt);

/**
 * How a haystack builder turns brief-token ids into searchable display names.
 * A resolver returns null for an id it no longer knows (deleted catalog
 * entry), and that token simply contributes nothing.
 */
export interface TokenNames {
  product(id: string): string | null;
  person(id: string): string | null;
  scene(id: string): string | null;
}

/**
 * Everything searchable about a shot, joined into one string: the compiled
 * prompt, the display names behind its brief tokens, template field values,
 * color names/hexes, and the engine's display name. Text tokens are skipped —
 * their words are already inside the compiled prompt.
 */
export function shotSearchText(n: TreeNode, names: TokenNames, engineName?: string | null): string {
  const parts: string[] = [n.prompt];
  const brief = n.brief;
  if (brief) {
    const tokens = (brief.tokens ?? []) as BriefToken[];
    let sawTemplate = false;
    for (const t of tokens) {
      switch (t.t) {
        case 'product':
          push(parts, names.product(t.id));
          break;
        case 'character':
          push(parts, names.person(t.id));
          break;
        case 'template':
          sawTemplate = true;
          push(parts, names.scene(t.id));
          break;
        case 'color':
          push(parts, t.name);
          push(parts, t.hex);
          break;
        default:
          break;
      }
    }
    // A legacy brief carries a bare templateId with no token for it yet.
    if (brief.templateId && !sawTemplate) push(parts, names.scene(brief.templateId));
    for (const v of Object.values(brief.templateFields ?? {})) push(parts, v);
  }
  push(parts, engineName);
  return parts.join('\n');
}

function push(parts: string[], v: string | null | undefined): void {
  if (v) parts.push(v);
}

/**
 * Narrow the feed to shots matching `q`. Matching semantics (AND across
 * terms, accent folding, trailing-plural stemming) come from `matchesQuery`.
 * An empty/whitespace query returns the input array itself, so memo consumers
 * keep referential equality when no search is active.
 */
export function filterFeed(nodes: TreeNode[], q: string, textFor: (n: TreeNode) => string): TreeNode[] {
  if (!q.trim()) return nodes;
  return nodes.filter((n) => matchesQuery(textFor(n), q));
}

/**
 * A full ordering, never a nudge of the input: every sort ends in the newest
 * tiebreak so the result is stable and independent of input order. Never
 * mutates. An unknown sort falls back to newest.
 */
export function sortFeed(nodes: TreeNode[], sort: FeedSort): TreeNode[] {
  const out = [...nodes];
  switch (sort) {
    case 'oldest':
      return out.sort((a, b) => byNewest(b, a));
    case 'cost':
      return out.sort((a, b) => b.costUsd - a.costUsd || byNewest(a, b));
    case 'keepers':
      return out.sort((a, b) => Number(b.kept) - Number(a.kept) || byNewest(a, b));
    default:
      return out.sort(byNewest);
  }
}
