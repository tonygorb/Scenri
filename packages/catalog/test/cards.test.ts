import { describe, expect, it } from 'vitest';
import { scanForCandidates } from '../src/candidates.js';

/**
 * A store that lists its own catalogue should never be asked to describe it
 * twice.
 *
 * Shopify's `/products.json` answers 250 products a page, each with a title
 * and its pictures. Discovery walked those pages, kept the ids and the
 * addresses and threw the rest away - and then the chooser asked the store
 * again, one HTTP request per card, for what had already been downloaded.
 *
 * Measured 2026-09-16 against a real 1,186 product store: five requests
 * brought the whole catalogue, and drawing it cost another 1,186. Cards sat
 * blank for minutes and the storefront began refusing us, both for want of
 * keeping 247 KB we already had.
 */
const N = 300;

function shopifyStore(opts: { withImages?: boolean } = {}) {
  const asked: string[] = [];
  const products = (page: number, limit: number) => {
    const start = (page - 1) * limit;
    if (start >= N) return [];
    return Array.from({ length: Math.min(limit, N - start) }, (_, i) => {
      const id = start + i + 1;
      return {
        id,
        title: `Runner ${id}`,
        handle: `runner-${id}`,
        body_html: `<p>${'x'.repeat(200)}</p>`,
        variants: [{ id: id * 10, title: 'Default', price: '95.00', available: true }],
        images: opts.withImages === false ? [] : [{ src: `https://cdn.example/runner-${id}_200x200.jpg`, position: 1 }],
      };
    });
  };
  const fetchImpl = (async (input: any) => {
    const url = String(input);
    asked.push(url);
    if (url.endsWith('/robots.txt')) return new Response('', { status: 404 });
    if (url.includes('/products.json')) {
      const u = new URL(url);
      const page = Number(u.searchParams.get('page') ?? '1');
      const limit = Number(u.searchParams.get('limit') ?? '250');
      return new Response(JSON.stringify({ products: products(page, limit) }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url.includes('sitemap')) return new Response('<urlset></urlset>', { status: 200 });
    // Any product page request here is a request we should not be making.
    return new Response('<html><body>page</body></html>', { status: 200, headers: { 'content-type': 'text/html' } });
  }) as typeof fetch;
  return { asked, fetchImpl };
}

describe('a catalogue the store already described', () => {
  it('keeps every card, and reads no product pages at all', async () => {
    const { asked, fetchImpl } = shopifyStore();
    const scan = await scanForCandidates({ url: 'https://shop.example', fetchImpl });

    expect(scan.verdict).toBe('found');
    expect(scan.count).toBe(N);
    // The whole catalogue, not a preview of it.
    expect(scan.cards).toHaveLength(N);
    expect(scan.cards.every((c) => c.title && c.url)).toBe(true);
    expect(scan.cards.every((c) => c.image)).toBe(true);

    // And not one product page was read: this is the request count that used
    // to be one per card.
    expect(asked.filter((u) => /\/products\/[^/?]+$/.test(u))).toHaveLength(0);
    expect(scan.spent.pages).toBe(0);
  });

  it('asks for the catalogue a handful of times, not once per product', async () => {
    const { asked, fetchImpl } = shopifyStore();
    await scanForCandidates({ url: 'https://shop.example', fetchImpl });
    // 300 products at 250 a page is two pages, plus detection and sitemaps.
    expect(asked.length).toBeLessThan(12);
  });

  it('upgrades a listing thumbnail to the picture that will be saved', async () => {
    const { fetchImpl } = shopifyStore();
    const scan = await scanForCandidates({ url: 'https://shop.example', fetchImpl });
    // `_200x200` is Shopify's thumbnail suffix; the card must not carry it.
    expect(scan.cards[0].image).not.toMatch(/_200x200/);
  });

  it('falls back to reading pages when the listing carries no pictures', async () => {
    // A listing with names but no images is not enough to choose from, so the
    // old path still has to run.
    const { fetchImpl } = shopifyStore({ withImages: false });
    const scan = await scanForCandidates({ url: 'https://shop.example', fetchImpl });
    expect(scan.cards.every((c) => !c.image)).toBe(true);
    expect(scan.cards).toHaveLength(N);
  });
});
