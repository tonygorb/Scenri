/**
 * The pure decisions behind the Create feed's search and sort — kept free of
 * React/DOM so `test/feedRules.test.ts` can cover the actual logic directly,
 * the same split `layout/library/libraryRules.ts` makes for the library pages.
 */

import type { FeedNode } from './api.js';

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

/** Newest first — the ordering the feed has always used. The id tiebreak
 * matches the server's own (`ORDER BY created_at, id`), so two shots created
 * in the same second land in one agreed order on every surface. */
export const byNewest = (a: FeedNode, b: FeedNode): number =>
  b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id);

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
