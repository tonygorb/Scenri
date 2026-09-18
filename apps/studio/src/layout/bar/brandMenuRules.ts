/**
 * What the brand menu lists, as plain data: the menu reads it and the tests pin it.
 *
 * Past six brands the menu stops being a list you read and becomes one you reach
 * into, so it leads with the few you actually move between and keeps every other
 * brand, A to Z, under them in the same scroller.
 */

/** How many recent brands follow the one you are in at the head of the list. */
export const RECENT_SHOWN = 4;

interface BrandLike {
  id: string;
  slug: string;
  updatedAt: string;
}

/** A to Z by the name a person reads; the slug settles two brands that share one. */
export function byName<T extends BrandLike>(brands: readonly T[], name: (b: T) => string): T[] {
  return [...brands].sort(
    (a, b) => name(a).localeCompare(name(b), undefined, { sensitivity: 'base' }) || a.slug.localeCompare(b.slug),
  );
}

/**
 * The brands to lead with, never the one you are in: the ones this browser
 * opened most recently, then, while it has no such history yet (a fresh install,
 * or the first visit after this shipped), the ones edited most recently, so the
 * section is never empty on a first look. An id with no brand behind it any more
 * is skipped rather than leaving a gap.
 */
export function recentOthers<T extends BrandLike>(
  brands: readonly T[],
  recent: readonly string[],
  currentId: string,
  n = RECENT_SHOWN,
): T[] {
  const others = brands.filter((b) => b.id !== currentId);
  const byId = new Map(others.map((b) => [b.id, b]));
  const picked = new Set<T>();
  for (const id of recent) {
    const b = byId.get(id);
    if (b) picked.add(b);
    if (picked.size === n) return [...picked];
  }
  // Timestamps are ISO-shaped strings, so they order as text; parsing them
  // would only add a way for one malformed date to scramble the sort.
  const edited = others.filter((b) => !picked.has(b)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return [...picked, ...edited].slice(0, n);
}

/** Every brand whose name or slug holds the query, A to Z. An empty query holds them all. */
export function findBrands<T extends BrandLike>(brands: readonly T[], query: string, name: (b: T) => string): T[] {
  const q = query.trim().toLowerCase();
  const hits = q ? brands.filter((b) => name(b).toLowerCase().includes(q) || b.slug.toLowerCase().includes(q)) : brands;
  return byName(hits, name);
}
