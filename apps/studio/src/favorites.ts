import { migrateKey } from './prefs.js';

/**
 * Favorite scenes live in localStorage, keyed per brand. Keeps the .brand
 * format untouched: taste is a studio preference, not brand truth.
 */
const key = (brandId: string) => `sc-favscenes-${brandId}`;
/** Pre-rename spelling (scenes were "looks"), moved to `key` the first time a brand is read. */
const legacyLooksKey = (brandId: string) => `sc-favlooks-${brandId}`;
/** Older still, from before that rename. */
const legacyKey = (brandId: string) => `bt-favlooks-${brandId}`;

export function favoriteScenes(brandId: string): string[] {
  try {
    const raw =
      localStorage.getItem(key(brandId)) ??
      migrateKey(legacyLooksKey(brandId), key(brandId)) ??
      migrateKey(legacyKey(brandId), key(brandId));
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function saveFavoriteScenes(brandId: string, ids: string[]): void {
  try {
    localStorage.setItem(key(brandId), JSON.stringify(ids));
  } catch {
    /* private mode */
  }
}

export function toggleFavoriteScene(brandId: string, id: string): string[] {
  const cur = favoriteScenes(brandId);
  const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
  saveFavoriteScenes(brandId, next);
  return next;
}
