import { describe, expect, it } from 'vitest';
import { feedImageIsReady, markFeedImageReady } from '../src/layout/canvas/FeedImage.js';

describe('feed image memory', () => {
  it('a src this session has decoded stays ready after the tile remounts', () => {
    const src = `/thumbs/stability-${Math.random().toString(16).slice(2)}`;
    expect(feedImageIsReady(src)).toBe(false);
    markFeedImageReady(src);
    expect(feedImageIsReady(src)).toBe(true);
    expect(feedImageIsReady(`${src}-other`)).toBe(false);
  });

  it('an empty src is not remembered', () => {
    markFeedImageReady('');
    expect(feedImageIsReady('')).toBe(false);
  });
});
