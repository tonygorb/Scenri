import { describe, expect, it } from 'vitest';
import { retryAfterMs } from '../src/http/fetch.js';
import { imageFailure, pageFailure, summarise, tally, thrownFailure } from '../src/failures.js';

/**
 * A store that is refusing us gets to say for how long.
 *
 * Guessing a backoff is what left a crawl reading 429 as "this page has no
 * product on it": four attempts inside 2.8 seconds against a CDN limiter, and
 * then silence. Asking the host beats guessing.
 */
describe('retryAfterMs', () => {
  it('reads a count of seconds', () => {
    expect(retryAfterMs('5')).toBe(5000);
    expect(retryAfterMs(' 30 ')).toBe(30_000);
    expect(retryAfterMs('0')).toBe(0);
  });

  it('reads an HTTP date, relative to now', () => {
    const now = Date.parse('2026-01-01T00:00:00Z');
    expect(retryAfterMs('Thu, 01 Jan 2026 00:00:10 GMT', now)).toBe(10_000);
    // already past is not a negative wait
    expect(retryAfterMs('Thu, 01 Jan 2026 00:00:00 GMT', now + 5000)).toBe(0);
  });

  it('caps what it will honour, so one bad header cannot park a crawl', () => {
    expect(retryAfterMs('86400')).toBe(60_000);
  });

  it('says nothing when the header says nothing usable', () => {
    expect(retryAfterMs(null)).toBeNull();
    expect(retryAfterMs('')).toBeNull();
    expect(retryAfterMs('soon')).toBeNull();
  });
});

/**
 * A swallowed failure has to carry a reason, or a rate-limited store is
 * indistinguishable from a store with fewer products - which is exactly how an
 * import came to report itself finished having saved nothing.
 */
describe('failure classification', () => {
  it('separates being throttled from being refused, missing or broken', () => {
    expect(pageFailure(429)).toBe('RATE_LIMITED');
    expect(pageFailure(503)).toBe('RATE_LIMITED');
    expect(pageFailure(403)).toBe('PAGE_BLOCKED');
    expect(pageFailure(404)).toBe('PAGE_NOT_FOUND');
    expect(pageFailure(418)).toBe('PAGE_UNREADABLE');
    expect(imageFailure(403)).toBe('IMAGE_FORBIDDEN');
    expect(imageFailure(404)).toBe('IMAGE_NOT_FOUND');
    expect(imageFailure(429)).toBe('RATE_LIMITED');
  });

  it('reads a stop as a stop, not as the site failing', () => {
    expect(thrownFailure(new Error('aborted'), true)).toBe('ABORTED');
    expect(thrownFailure(new Error('The operation timed out'))).toBe('IMAGE_TIMEOUT');
    expect(thrownFailure(new Error('socket hang up'))).toBe('DOWNLOAD_FAILED');
  });
});

/**
 * The sentence a person reads. Never a status code, never an enum, and it has
 * to say what to do when there is something to do.
 */
describe('summarise', () => {
  const t = (r: Parameters<typeof tally>[1], n = 1) => {
    const acc = {};
    tally(acc, r, n);
    return acc;
  };

  it('tells someone throttled that waiting works', () => {
    const none = summarise(t('RATE_LIMITED', 60), 0, 60)!;
    expect(none).toMatch(/slow down/i);
    expect(none).toMatch(/again/i);
    const some = summarise(t('RATE_LIMITED', 16), 44, 60)!;
    expect(some).toContain('16');
    expect(some).toContain('60');
  });

  it('never leaks a status code or an enum name', () => {
    for (const reason of ['RATE_LIMITED', 'PAGE_BLOCKED', 'IMAGE_FORBIDDEN', 'PRODUCT_SAVE_FAILED'] as const) {
      const said = summarise(t(reason, 3), 0, 10);
      expect(said).toBeTruthy();
      expect(said!).not.toMatch(/[45]\d\d|_|undefined|null/);
    }
  });

  it('says nothing when nothing failed, and nothing about a deliberate stop', () => {
    expect(summarise({}, 10, 10)).toBeNull();
    expect(summarise(t('ABORTED'), 3, 10)).toBeNull();
  });
});
