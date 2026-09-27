import type { ContentState } from '../api.js';

/**
 * What the studio makes of the server's word on the library download
 * (AppShell). Pictures arrive a few at a time, Home's first, so the catalogs
 * are read again as they land, and a card with no picture yet holds its place
 * for as long as one may still be coming.
 */

/** Two answers that say the same thing: an unchanged answer keeps the old one, and nothing re-renders. */
export function sameContent(a: ContentState | null, b: ContentState): boolean {
  return (
    !!a &&
    a.arriving === b.arriving &&
    a.installs === b.installs &&
    (a.landed ?? 0) === (b.landed ?? 0) &&
    (a.failed ?? 0) === (b.failed ?? 0) &&
    (a.outcome ?? null) === (b.outcome ?? null)
  );
}

/**
 * Whether an answer means the catalogs hold pictures they did not when last
 * read. The first answer counts too once anything has landed: the catalogs
 * may have been read a moment before it.
 */
export function catalogsStale(prev: ContentState | null, next: ContentState): boolean {
  if (!prev) return next.installs > 0 || (next.landed ?? 0) > 0;
  return (
    prev.installs !== next.installs ||
    (prev.landed ?? 0) !== (next.landed ?? 0) ||
    (prev.outcome ?? null) !== (next.outcome ?? null)
  );
}

/**
 * Whether a card with no picture holds its place (true) rather than showing
 * the empty-picture glyph (false). Unknown until the first answer counts as on
 * its way, and so does the moment between a run ending and the catalogs that
 * carry its last pictures being read again: both used to show the glyph.
 */
export function picturesArriving(content: ContentState | null, reReading: boolean): boolean {
  if (!content) return true;
  return content.arriving || reReading;
}
