/**
 * Where each history entry was scrolled to.
 *
 * A module-level Map rather than sessionStorage: this is about Back inside a
 * session. A reload rebuilds every pane from a cold catalog, and the browser
 * has nothing to restore an inner div to anyway.
 *
 * It lives beside `ScrollPane` rather than inside it because it is the one
 * part of that component which is pure bookkeeping, and the one part a test
 * can hold. It was inside, and a `remember` that called itself instead of
 * writing to the Map shipped in 0.8.1 and threw on every scroll of every
 * pane for a month, because nothing could reach it.
 */
const offsets = new Map<string, number>();
/** Places remembered. A Map keeps insertion order, so the oldest key is the first one. */
const OFFSETS_CAP = 50;

/** Note where a pane stands. Re-inserting makes insertion order recency order. */
export function remember(key: string, top: number): void {
  offsets.delete(key);
  offsets.set(key, top);
  while (offsets.size > OFFSETS_CAP) offsets.delete(offsets.keys().next().value as string);
}

/** Where that entry stood, or nothing if it was never here or has aged out. */
export function recall(key: string): number | undefined {
  return offsets.get(key);
}

/** Between tests, and nowhere else. */
export function forgetAll(): void {
  offsets.clear();
}
