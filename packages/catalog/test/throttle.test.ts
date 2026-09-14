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
    for (const reason of ['RATE_LIMITED', 'PAGE_BLOCKED', 'IMAGE_FORBIDDEN', 'IMAGE_TIMEOUT'] as const) {
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

/**
 * Politeness and patience are the same mechanism, and past a point patience
 * stops buying products. A 150-page crawl of a throttling store spent ten
 * minutes to save forty-six, the last three of them waiting without a single
 * success. A run of refusals is the signal to stop and say so.
 */
describe('giving up on a store that keeps refusing', () => {
  const page = (i: number) =>
    `<html><head><script type="application/ld+json">${JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: `p${i}`,
      sku: `S-${i}`,
      url: `https://shop.example/products/p${i}`,
      image: ['https://cdn.example/a.jpg'],
      offers: { '@type': 'Offer', price: 1, priceCurrency: 'USD' },
    })}</script></head><body><button>Add to cart</button></body></html>`;

  it('stops after a run of refusals, and a success resets the run', async () => {
    const { fetchProductPages } = await import('../src/adapters/productPage.js');
    const urls = Array.from({ length: 60 }, (_, i) => `https://shop.example/products/p${i}`);
    let asked = 0;
    const ctx = {
      baseUrl: 'https://shop.example',
      fetchImpl: (async (input: any) => {
        asked++;
        const i = Number(/p(\d+)$/.exec(String(input))?.[1] ?? 0);
        // the first ten serve, everything after is refused
        return i < 10
          ? new Response(page(i), { status: 200 })
          : new Response('slow down', { status: 429, headers: { 'retry-after': '0' } });
      }) as any,
    } as any;

    const stats = { pages: 0, bytes: 0, refused: 0, reasons: {} };
    const got = await fetchProductPages(ctx, urls, { concurrency: 2, stats, giveUpAfterRefusals: 8 });

    expect(got.length).toBe(10);
    // it stopped rather than walking all sixty
    expect(asked).toBeLessThan(urls.length);
    expect(stats.reasons).toHaveProperty('RATE_LIMITED');
    // and the caller can tell it did not cover the catalogue
    expect(stats.pages).toBeLessThan(urls.length);
  });
});
