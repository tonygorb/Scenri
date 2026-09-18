/**
 * What the brand menu lists, as plain data: the menu reads it and the tests pin it.
 *
 * One list, A to Z, and a finder that searches all of it once the list is long
 * enough to reach into rather than read.
 */

interface BrandLike {
  slug: string;
}

/** A to Z by the name a person reads; the slug settles two brands that share one. */
export function byName<T extends BrandLike>(brands: readonly T[], name: (b: T) => string): T[] {
  return [...brands].sort(
    (a, b) => name(a).localeCompare(name(b), undefined, { sensitivity: 'base' }) || a.slug.localeCompare(b.slug),
  );
}

/** Every brand whose name or slug holds the query, A to Z. An empty query holds them all. */
export function findBrands<T extends BrandLike>(brands: readonly T[], query: string, name: (b: T) => string): T[] {
  const q = query.trim().toLowerCase();
  const hits = q ? brands.filter((b) => name(b).toLowerCase().includes(q) || b.slug.toLowerCase().includes(q)) : brands;
  return byName(hits, name);
}
