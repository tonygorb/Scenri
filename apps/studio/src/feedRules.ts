/**
 * The pure decisions the Create feed is addressed by: its sorts, its lenses,
 * and the query string that asks the server for a page. Free of React and DOM
 * so `test/feedRules.test.ts` covers the logic directly, the same split
 * `layout/library/libraryRules.ts` makes for the library pages.
 *
 * Searching itself is not here: the feed's search is an indexed query on the
 * server (`packages/core/src/searchRules.ts`), and nothing matches on the
 * client any more.
 */

import type { FeedNode, FeedQuery } from './api.js';

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

/** The query string the route reads; nothing is sent for a default. */
export function feedSearchParams(q: FeedQuery): string {
  const p = new URLSearchParams();
  if (q.lens && q.lens !== 'all') p.set('lens', q.lens);
  if (q.set) p.set('set', q.set);
  if (q.ungrouped) p.set('ungrouped', '1');
  if (q.lineage) p.set('lineage', q.lineage);
  if (q.token) p.set('token', q.token);
  if (q.q?.trim()) p.set('q', q.q.trim());
  if (q.sort && q.sort !== 'newest') p.set('sort', q.sort);
  if (q.limit) p.set('limit', String(q.limit));
  if (q.cursor) p.set('cursor', q.cursor);
  const s = p.toString();
  return s ? `?${s}` : '';
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
