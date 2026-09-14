import { describe, it, expect } from 'vitest';
import { productLine, hasCatalog } from '../src/views/kitReport.js';
import type { CommerceScan } from '../src/apiTypes.js';

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

describe('the products line', () => {
  it('says nothing at all about a site with no shop', () => {
    // A portfolio has never wanted a catalog; a row reading "0 products"
    // would turn a complete brand import into a scoreboard with a zero on it.
    expect(productLine(scan({ verdict: 'none' }), false)).toBeNull();
    expect(productLine(null, false)).toBeNull();
  });

  it('reports a found catalog, approximately when the count came from a sitemap', () => {
    expect(productLine(scan({ count: 2202 }), false)?.value).toBe('about 2,202 found');
    expect(productLine(scan({ count: 2202, countSource: 'api' }), false)?.value).toBe('2,202 found');
  });

  it('does not hedge a small count', () => {
    expect(productLine(scan({ count: 8 }), false)?.value).toBe('8 found');
  });

  it('says a shop could not be loaded, never that there were no products', () => {
    for (const verdict of ['blocked', 'likely'] as const) {
      const line = productLine(scan({ verdict, count: 40 }), false);
      expect(line?.found).toBe(false);
      expect(line?.value).toMatch(/could not load the catalogue/);
      expect(line?.value).not.toMatch(/\bno products\b/);
    }
  });

  it('shows it is still looking while the scan runs', () => {
    expect(productLine(null, true)?.value).toBe('looking for a shop');
  });

  it('only offers an import when there is something to preview', () => {
    expect(hasCatalog(scan({ count: 10, candidates: [{ externalKey: 'a', title: 'A' }] }))).toBe(true);
    expect(hasCatalog(scan({ verdict: 'blocked', count: 10 }))).toBe(false);
    expect(hasCatalog(scan({ count: 10 }))).toBe(false);
    expect(hasCatalog(null)).toBe(false);
  });
});
