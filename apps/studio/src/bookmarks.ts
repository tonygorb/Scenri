import { migrateKey } from './prefs.js';

/**
 * Bookmarked scenes live in localStorage, keyed per brand. Keeps the .brand
 * format untouched: a shortlist is a studio preference, not brand truth.
 *
 * Per-brand is the point. This is not global taste — it is the handful of
 * places this client's shoot keeps coming back to.
 *
 * The stored key still spells the old name. Renaming it would need a fourth
 * `migrateKey` hop and risk a real user's list to fix a string nobody sees.
 */
const key = (brandId: string) => `sc-favscenes-${brandId}`;
/** Pre-rename spelling (scenes were "looks"), moved to `key` the first time a brand is read. */
const legacyLooksKey = (brandId: string) => `sc-favlooks-${brandId}`;
/** Older still, from before that rename. */
const legacyKey = (brandId: string) => `bt-favlooks-${brandId}`;

export function bookmarkedScenes(brandId: string): string[] {
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

/** Private: the only way in is `toggleBookmarkScene`, so a write can't skip the read-modify. */
function save(brandId: string, ids: string[]): void {
  try {
    localStorage.setItem(key(brandId), JSON.stringify(ids));
  } catch {
    /* private mode */
  }
}

export function toggleBookmarkScene(brandId: string, id: string): string[] {
  const cur = bookmarkedScenes(brandId);
  const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
  save(brandId, next);
  return next;
}
