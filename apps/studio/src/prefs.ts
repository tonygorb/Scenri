import { useEffect, useState } from 'react';

/**
 * Studio preferences that are settings, not locations: which engine you picked,
 * how many shots you ask for, whether the assets panel is open. They belong to
 * the machine rather than the URL, which stays about where you are.
 *
 * New keys carry the scenri: prefix. The two older keys (bt-theme and
 * bt-favlooks-*) keep their names on purpose: renaming them would silently
 * reset every existing user's theme and favourites on upgrade.
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
