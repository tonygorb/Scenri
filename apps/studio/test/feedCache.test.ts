import { describe, expect, it } from 'vitest';
import type { FeedNode } from '../src/api.js';
import { cachedFeed, FEED_CACHE_CAP, forgetFeeds, rememberFeed } from '../src/views/create/feedCache.js';

const shot = (id: string) => ({ id }) as FeedNode;
const snapshot = (brandId: string, key: string, ids: string[] = ['a']) => ({
  brandId,
  key,
  items: ids.map(shot),
  next: null,
  counts: null,
});

// Create is a route, and leaving it used to lose the feed: every visit showed
// a grid of stand-ins before the same shots came back.
describe('the feed a visit paints at once', () => {
  it('gives back what a query last held, by its key', () => {
    rememberFeed(snapshot('b1', 'b1|all#0', ['x', 'y']));
    expect(cachedFeed('b1|all#0')?.items.map((n) => n.id)).toEqual(['x', 'y']);
    expect(cachedFeed('b1|keepers#0')).toBeNull();
  });

  it('never holds an answer that has no key', () => {
    rememberFeed(snapshot('b1', ''));
    expect(cachedFeed('')).toBeNull();
  });

  it('keeps only the queries met most recently', () => {
    for (let i = 0; i < FEED_CACHE_CAP + 2; i++) rememberFeed(snapshot('cap', `cap|q${i}#0`));
    expect(cachedFeed('cap|q0#0')).toBeNull();
    expect(cachedFeed('cap|q1#0')).toBeNull();
    expect(cachedFeed(`cap|q${FEED_CACHE_CAP + 1}#0`)).not.toBeNull();
  });

  // A send from Home makes shots no remembered page holds: they would land a
  // round trip late and push every tile down.
  it('forgets a brand whole, and only that brand', () => {
    rememberFeed(snapshot('home', 'home|all#0'));
    rememberFeed(snapshot('home', 'home|keepers#0'));
    rememberFeed(snapshot('other', 'other|all#0'));
    forgetFeeds('home');
    expect(cachedFeed('home|all#0')).toBeNull();
    expect(cachedFeed('home|keepers#0')).toBeNull();
    expect(cachedFeed('other|all#0')).not.toBeNull();
  });

  // The key carries the shots epoch, so a wipe is a different query.
  it('is a miss after a wipe moves the epoch', () => {
    rememberFeed(snapshot('w', 'w|all#0'));
    expect(cachedFeed('w|all#1')).toBeNull();
  });
});
