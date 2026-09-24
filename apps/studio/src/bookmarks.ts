import { migrateKey } from './prefs.js';

/**
 * Keepers live in localStorage, keyed per brand. The .brand file stays
 * untouched: a shortlist is a studio preference, not brand truth.
 *
 * Per-brand is the point. This is not global taste. It is the handful of
 * scenes, presenters and products this client's shoot keeps coming back to.
 *
 * The scene key still spells the old name. Renaming it would need another
 * `migrateKey` hop and risk a real user's list to fix a string nobody sees.
 * Presenters and products are new lists, so they spell what they are.
 */
export type ShortlistKind = 'scene' | 'presenter' | 'product';

const sceneKey = (brandId: string) => `sc-favscenes-${brandId}`;
/** Pre-rename spelling (scenes were "looks"), moved to `sceneKey` the first time a brand is read. */
const legacyLooksKey = (brandId: string) => `sc-favlooks-${brandId}`;
/** Older still, from before that rename. */
const legacyKey = (brandId: string) => `bt-favlooks-${brandId}`;

function storageKey(kind: ShortlistKind, brandId: string): string {
  if (kind === 'presenter') return `sc-favpresenters-${brandId}`;
  if (kind === 'product') return `sc-favproducts-${brandId}`;
  return sceneKey(brandId);
}

function readList(raw: string | null): string[] {
  try {
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** Scenes, including the two older keys a real list may still be sitting under. */
export function bookmarkedScenes(brandId: string): string[] {
  try {
    const raw =
      localStorage.getItem(sceneKey(brandId)) ??
      migrateKey(legacyLooksKey(brandId), sceneKey(brandId)) ??
      migrateKey(legacyKey(brandId), sceneKey(brandId));
    return readList(raw);
  } catch {
    return [];
  }
}

export function keptIds(kind: ShortlistKind, brandId: string): string[] {
  try {
    if (kind === 'scene') return bookmarkedScenes(brandId);
    return readList(localStorage.getItem(storageKey(kind, brandId)));
  } catch {
    return [];
  }
}

function write(kind: ShortlistKind, brandId: string, ids: string[]): void {
  try {
    localStorage.setItem(storageKey(kind, brandId), JSON.stringify(ids));
  } catch {
    /* private mode */
  }
}

/** One card on, or off. The list keeps the order it was built in. */
export function toggleKept(kind: ShortlistKind, brandId: string, id: string): string[] {
  const cur = keptIds(kind, brandId);
  const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
  write(kind, brandId, next);
  return next;
}

/**
 * A handful, the shot rule: if every id is already kept, take them off.
 * Otherwise add the ones that are not. Ids already in the right state stay put,
 * and the stored order does not shuffle.
 */
export function setKept(kind: ShortlistKind, brandId: string, ids: string[], on: boolean): string[] {
  const cur = keptIds(kind, brandId);
  const next = on ? [...cur, ...ids.filter((id) => !cur.includes(id))] : cur.filter((id) => !ids.includes(id));
  write(kind, brandId, next);
  return next;
}

export function toggleBookmarkScene(brandId: string, id: string): string[] {
  return toggleKept('scene', brandId, id);
}
