/**
 * Favorite looks live in localStorage, keyed per brand. Keeps the .brand
 * format untouched: taste is a studio preference, not brand truth.
 */
const key = (brandId: string) => `bt-favlooks-${brandId}`;

export function favoriteLooks(brandId: string): string[] {
  try {
    const raw = localStorage.getItem(key(brandId));
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function saveFavoriteLooks(brandId: string, ids: string[]): void {
  try {
    localStorage.setItem(key(brandId), JSON.stringify(ids));
  } catch {
    /* private mode */
  }
}

export function toggleFavoriteLook(brandId: string, id: string): string[] {
  const cur = favoriteLooks(brandId);
  const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
  saveFavoriteLooks(brandId, next);
  return next;
}
