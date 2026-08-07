/**
 * The pure decisions behind every Creative Library page (Products, Scenes,
 * Presenters) — kept free of React/DOM so `test/library.test.ts` can cover
 * the actual logic directly, without a component harness.
 */

/**
 * AND match: every whitespace-separated term of `q` must appear as a
 * substring somewhere in `haystack` (case-insensitive). Deliberately not
 * fuzzy — a library search is for "does this contain what I typed", not a
 * ranked-relevance guess. Empty/whitespace-only `q` matches everything, so
 * callers don't need a separate "no query" branch.
 */
export function matchesQuery(haystack: string, q: string): boolean {
  const terms = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const h = haystack.toLowerCase();
  return terms.every((t) => h.includes(t));
}

export type FacetMode = 'none' | 'tabs';

/**
 * Whether a facet (category, vertical…) has anything to filter. One rule,
 * one shape everywhere: real, visible tabs — the same `.sc-verticals`
 * pattern on every library page, never a popover hiding the control behind
 * a click. A single known value ("every product" plus one real category)
 * still narrows the grid when picked, so it earns a tab; below that there's
 * nothing to select between.
 */
export function facetMode(valueCount: number): FacetMode {
  return valueCount < 2 ? 'none' : 'tabs';
}

/** Load More: the first `shown` items, and how many more are waiting. */
export function pageSlice<T>(items: T[], shown: number): { visible: T[]; remaining: number } {
  return { visible: items.slice(0, shown), remaining: Math.max(0, items.length - shown) };
}
