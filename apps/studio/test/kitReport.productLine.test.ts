import { describe, it, expect } from 'vitest';
import { productLine, hasCatalog, scanRetryable } from '../src/views/kitReport.js';
import type { CommerceScan } from '../src/apiTypes.js';
import type { ScanOutcome } from '../src/views/brandSetup/useCommerceScan.js';

const scan = (over: Partial<CommerceScan>): CommerceScan => ({
  verdict: 'found',
  count: 0,
  countSource: 'sitemap',
  candidates: [],
  candidateUrls: [],
  truncated: false,
  warnings: [],
  ...over,
});

const found = (over: Partial<CommerceScan>): ScanOutcome => ({ kind: 'result', scan: scan(over) });

describe('the products line', () => {
  it('says nothing at all about a site with no shop', () => {
    // A portfolio has never wanted a catalog; a row reading "0 products"
    // would turn a complete brand import into a scoreboard with a zero on it.
    expect(productLine(found({ verdict: 'none' }))).toBeNull();
  });

  /**
   * The regression this file now guards.
   *
   * `productLine` used to open with `if (!scan || scan.verdict === 'none')`,
   * and a failed scan arrived as `null`. So a timeout, a server error and an
   * unread poll all drew as the portfolio above: the row was removed and the
   * screen offered to continue. Measured against a real store, that hid 1,186
   * readable products behind an enabled "Looks right".
   */
  it('never goes silent about a scan that failed, which is not a site without a shop', () => {
    for (const outcome of [{ kind: 'timeout' }, { kind: 'error', reason: 'boom' }] as ScanOutcome[]) {
      const line = productLine(outcome);
      expect(line).not.toBeNull();
      expect(line?.found).toBe(false);
      expect(line?.label).toBe('Products');
      // Says something a person can act on, and never leaks the machinery.
      expect(line?.value).not.toMatch(/\bno products\b|\bnone\b/i);
      expect(line?.value).not.toMatch(/[45]\d\d|_|undefined|null|boom/);
    }
  });

  it('reports a found catalog, approximately when the count came from a sitemap', () => {
    expect(productLine(found({ count: 2202 }))?.value).toBe('about 2,202 found');
    expect(productLine(found({ count: 2202, countSource: 'api' }))?.value).toBe('2,202 found');
  });

  it('does not hedge a small count', () => {
    expect(productLine(found({ count: 8 }))?.value).toBe('8 found');
  });

  it('says a shop could not be loaded, never that there were no products', () => {
    for (const verdict of ['blocked', 'likely'] as const) {
      const line = productLine(found({ verdict, count: 40 }));
      expect(line?.found).toBe(false);
      expect(line?.value).toMatch(/could not load the catalogue/);
      expect(line?.value).not.toMatch(/\bno products\b/);
    }
  });

  it('shows it is still looking while the scan runs, and nothing before it starts', () => {
    expect(productLine({ kind: 'scanning' })?.value).toBe('looking for a shop');
    expect(productLine({ kind: 'idle' })).toBeNull();
  });

  /**
   * Two ways of knowing what is in a shop, and only one of them was counted.
   *
   * `candidates` are read from product pages, one request each. A store with a
   * bulk listing has none of them - it hands its whole catalogue over at once
   * as `cards` instead. Checking only the first sent a person who had just
   * been shown 1,187 products to the home page with nothing imported: the row
   * read "1,187 found" and the button under it read "Looks right".
   */
  it('offers an import when the listing described the shop, not only when pages were read', () => {
    const listed = scan({ count: 1187, candidates: [], cards: [{ externalKey: '1', title: 'A', url: 'u' }] } as any);
    expect(hasCatalog(listed)).toBe(true);
    // Still nothing to offer when the shop is empty by both measures.
    expect(hasCatalog(scan({ count: 0, candidates: [], cards: [] } as any))).toBe(false);
    // And a shop we could not open is still not an offer, however it is known.
    expect(hasCatalog(scan({ verdict: 'blocked', cards: [{ externalKey: '1', title: 'A', url: 'u' }] } as any))).toBe(
      false,
    );
  });

  it('only offers an import when there is something to preview', () => {
    expect(hasCatalog(scan({ count: 10, candidates: [{ externalKey: 'a', title: 'A' }] }))).toBe(true);
    expect(hasCatalog(scan({ verdict: 'blocked', count: 10 }))).toBe(false);
    expect(hasCatalog(scan({ count: 10 }))).toBe(false);
    expect(hasCatalog(null)).toBe(false);
  });
});

/**
 * Retry used to be gated on there being a scan at all, so the failures that
 * most needed another go were the ones that offered none.
 */
describe('offering another go', () => {
  it('offers one for every ending short of a catalogue, except a site with no shop', () => {
    expect(scanRetryable({ kind: 'timeout' })).toBe(true);
    expect(scanRetryable({ kind: 'error', reason: 'x' })).toBe(true);
    expect(scanRetryable(found({ verdict: 'blocked' }))).toBe(true);
    expect(scanRetryable(found({ verdict: 'likely' }))).toBe(true);
  });

  it('does not badger someone whose site simply has no shop, or one already read', () => {
    expect(scanRetryable(found({ verdict: 'none' }))).toBe(false);
    expect(scanRetryable(found({ verdict: 'found', count: 3 }))).toBe(false);
    expect(scanRetryable({ kind: 'scanning' })).toBe(false);
    expect(scanRetryable({ kind: 'idle' })).toBe(false);
  });
});
