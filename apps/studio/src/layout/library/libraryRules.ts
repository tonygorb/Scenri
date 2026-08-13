/**
 * The pure decisions behind every Creative Library page (Products, Scenes,
 * Presenters) — kept free of React/DOM so `test/library.test.ts` can cover
 * the actual logic directly, without a component harness.
 */

/**
 * Lowercase, and with combining marks stripped, so `rosé` and `Rose` are the
 * same word. Catalog copy is authored by hand and the searcher's keyboard is
 * not the author's — an accent should never be the reason a scene can't be
 * found.
 */
function fold(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

/**
 * Below this a term is too short to strip a plural from safely: dropping the
 * `s` from "as" leaves "a", which is inside almost every haystack there is.
 */
const STEM_MIN = 4;

/**
 * AND match: every whitespace-separated term of `q` must appear as a
 * substring somewhere in `haystack`, ignoring case and accents. Deliberately
 * not fuzzy — a library search is for "does this contain what I typed", not a
 * ranked-relevance guess. Empty/whitespace-only `q` matches everything, so
 * callers don't need a separate "no query" branch.
 *
 * The one concession to real typing is a trailing plural on the query:
 * "serums" also matches "serum", because catalogs are authored in the
 * singular and people search in whichever number they were thinking in. The
 * other direction already works for free — substring matching means "serum"
 * finds "Serums" without any stemming — so only the query is ever stemmed.
 */
export function matchesQuery(haystack: string, q: string): boolean {
  const terms = fold(q).trim().split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const h = fold(haystack);
  return terms.every((t) => h.includes(t) || (t.length >= STEM_MIN && t.endsWith('s') && h.includes(t.slice(0, -1))));
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

/**
 * Starred items first, catalog order preserved inside each half. Taste is a
 * lift, not a re-sort: the curated order a catalog was authored in is still
 * the right order for everything you have no opinion about yet. Array#sort is
 * stable, so that order survives the lift.
 */
export function starredFirst<T>(items: T[], isStarred: (item: T) => boolean): T[] {
  return [...items].sort((a, b) => Number(isStarred(b)) - Number(isStarred(a)));
}
