import { useEffect, useState } from 'react';

/**
 * Studio preferences that are settings, not locations: which engine you picked,
 * how many shots you ask for, whether the assets panel is open. They belong to
 * the machine rather than the URL, which stays about where you are.
 *
 * Most keys carry the scenri: prefix. Two older ones (sc-theme and
 * sc-favlooks-*) predate it and were spelled bt-* before the rename, so they
 * are migrated on first read rather than renamed outright: a plain rename
 * would silently reset every existing user's theme and favourites on upgrade.
 * Once a release or two has passed, `migrateKey` and its call sites can go.
 */
export const PREF = {
  lastBrand: 'scenri:last-brand',
  engine: 'scenri:engine',
  quality: 'scenri:quality',
  count: 'scenri:count',
  format: 'scenri:format',
  assetsOpen: 'scenri:assets-open',
} as const;

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode */
  }
}

/**
 * Move a value written under the pre-rename bt-* spelling to its sc-* name and
 * return it. Raw strings, not JSON: both callers store their own shape, and
 * this only ever moves bytes from one key to another.
 *
 * Returns null when there is nothing to move, so a caller can read the new key
 * first and only reach for this on a miss.
 */
export function migrateKey(from: string, to: string): string | null {
  try {
    const raw = localStorage.getItem(from);
    if (raw === null) return null;
    localStorage.setItem(to, raw);
    localStorage.removeItem(from);
    return raw;
  } catch {
    return null;
  }
}

/** useState that remembers, so call sites read exactly as they did before. */
export function useLocalPref<T>(key: string, fallback: T) {
  const [value, setValue] = useState<T>(() => read(key, fallback));
  useEffect(() => {
    write(key, value);
  }, [key, value]);
  return [value, setValue] as const;
}

/** Read outside React: the redirect at / needs this before anything renders. */
export const lastBrand = (): string | null => read<string | null>(PREF.lastBrand, null);
export const rememberBrand = (id: string): void => write(PREF.lastBrand, id);
