import type { FeedCounts, FeedNode } from '../../api.js';

/**
 * The feed as it last stood, per query, for the next visit to paint at once.
 *
 * Create is a route: leaving it unmounts the feed, and coming back used to
 * start from nothing, so every visit showed a grid of stand-ins before the
 * same shots it had just shown came back. A query met before now paints what
 * it last held, and the first page read on arrival replaces it whole (the
 * read the feed always makes), so what shows is exact within one round trip.
 * Keyed on the feed's own key, which carries the brand, the query and the
 * shots epoch, so a wipe or another brand never paints from here.
 */
export interface FeedSnapshot {
  brandId: string;
  key: string;
  items: FeedNode[];
  next: string | null;
  counts: FeedCounts | null;
}

/** The queries remembered; past this the one met longest ago is forgotten. */
export const FEED_CACHE_CAP = 6;

const held = new Map<string, FeedSnapshot>();

export function cachedFeed(key: string): FeedSnapshot | null {
  return held.get(key) ?? null;
}

/** What a feed holds now, remembered under its key. An empty key is no answer yet. */
export function rememberFeed(snapshot: FeedSnapshot): void {
  if (!snapshot.key) return;
  held.delete(snapshot.key);
  held.set(snapshot.key, snapshot);
  while (held.size > FEED_CACHE_CAP) held.delete(held.keys().next().value as string);
}

/**
 * Forget every query of a brand: for shots made while no feed is on screen to
 * take them in (a send from Home), which a remembered page would not hold,
 * so they would arrive late and push every tile down as they did.
 */
export function forgetFeeds(brandId: string): void {
  for (const [key, snapshot] of held) if (snapshot.brandId === brandId) held.delete(key);
}
