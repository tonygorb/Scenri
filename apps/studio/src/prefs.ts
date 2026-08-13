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
  /** Which single asset group is expanded into the accordion's open pane, if any. */
  assetsOpenGroup: 'scenri:assets-open-group',
  /** Create feed tile width in px (continuous slider). */
  tileSize: 'scenri:tile-size',
  /** Catalog wall density: compact (7) | large (5). */
  wallDensity: 'scenri:wall-density',
  /** Create feed ordering: newest | oldest | cost | keepers. */
  feedSort: 'scenri:feed-sort',
} as const;

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

/**
 * One tab can hold the same pref twice: the composer is mounted in the dock
 * and again inside an open shot. localStorage's own `storage` event only fires
 * in *other* tabs, so without this the two copies drifted — changing quality in
 * the overlay left the dock still showing, and sending, the old one.
 */
const PREF_EVENT = 'scenri:pref-changed';

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode */
  }
  try {
    window.dispatchEvent(new CustomEvent(PREF_EVENT, { detail: { key, value } }));
  } catch {
    /* no window: tests and the pre-render redirect */
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
  useEffect(() => {
    const onChanged = (e: Event) => {
      const d = (e as CustomEvent<{ key: string; value: unknown }>).detail;
      // Object.is, so the write effect this triggers sees no change and the
      // two mounted copies settle instead of answering each other forever
      if (d?.key === key) setValue((prev) => (Object.is(prev, d.value) ? prev : (d.value as T)));
    };
    window.addEventListener(PREF_EVENT, onChanged);
    return () => window.removeEventListener(PREF_EVENT, onChanged);
  }, [key]);
  return [value, setValue] as const;
}

/**
 * A setting a recipe may borrow for the brief in front of you, without that
 * borrowing becoming your new default.
 *
 * Opening a curated example used to write its variant count and quality
 * straight into the machine's prefs, so looking at one four-variant example
 * quietly changed what every later shot would cost. The recipe's value now
 * rides on top for as long as that brief is on screen; picking a value by hand
 * is what writes the pref, and clearing the override hands the pref back.
 */
export function useRecipeSetting<T>(key: string, fallback: T) {
  const [pref, setPref] = useLocalPref<T>(key, fallback);
  const [borrowed, setBorrowed] = useState<T | null>(null);
  const choose = (v: T) => {
    setBorrowed(null);
    setPref(v);
  };
  return [borrowed ?? pref, choose, setBorrowed] as const;
}

/** Read outside React: the redirect at / needs this before anything renders. */
export const lastBrand = (): string | null => read<string | null>(PREF.lastBrand, null);
export const rememberBrand = (id: string): void => write(PREF.lastBrand, id);
