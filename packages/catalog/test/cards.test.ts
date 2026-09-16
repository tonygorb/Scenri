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

  /**
   * A card wants the fewest pixels that still look right; an import wants the
   * most the store has. Measured on a real storefront, the listing's own
   * images are 2848x1953 and 4250x3238 - 4.2 MB and 12.9 MB - and two dozen of
   * those decoded on the main thread is a window that has stopped responding.
   */
  it('asks for the picture at card size, not at the size the importer wants', async () => {
    const { fetchImpl } = shopifyStore();
    const scan = await scanForCandidates({ url: 'https://shop.example', fetchImpl });
    const img = scan.cards[0].image!;
    // The size suffix the listing carried is gone...
    expect(img).not.toMatch(/_200x200/);
    // ...and a card-sized one is asked for in its place.
    expect(new URL(img).searchParams.get('width')).toBe('400');
  });

  it('leaves a signed picture URL exactly as it was', async () => {
    const { cardImageUrl } = await import('../src/url.js');
    const signed = 'https://cdn.example/p.jpg?X-Amz-Signature=abc&X-Amz-Expires=60';
    // Adding to the query of a signed URL invalidates it.
    expect(cardImageUrl(signed)).toBe(signed);
    expect(cardImageUrl('https://cdn.example/p.jpg')).toContain('width=400');
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

/**
 * Importing a chosen set used to cost one page read per product.
 *
 * That is the slow half of an import on a store whose listing would have
 * answered in one request, and the listing is the same one discovery already
 * walked. Counted rather than timed: seconds against a live store are weather,
 * requests are the thing we actually control.
 */
describe('importing what someone chose', () => {
  const chosen = (n: number) => Array.from({ length: n }, (_, i) => `https://shop.example/products/runner-${i + 1}`);

  it('reads the listing once instead of a page per product', async () => {
    const { asked, fetchImpl } = shopifyStore();
    const { shopifyAdapter } = await import('../src/adapters/shopify.js');
    const ctx = { fetchImpl, baseUrl: 'https://shop.example' } as any;

    const got = await shopifyAdapter.fetchSome!(ctx, chosen(25));

    expect(got).not.toBeNull();
    expect(got!).toHaveLength(25);
    expect(got!.every((p) => p.title && p.images?.length)).toBe(true);
    // The first 25 handles are all on page one, so that is one request.
    expect(asked.filter((u) => u.includes('/products.json'))).toHaveLength(1);
    // And not a single product page.
    expect(asked.filter((u) => /\/products\/[^/?]+$/.test(u))).toHaveLength(0);
  });

  it('stops walking as soon as it has everything asked for', async () => {
    const { asked, fetchImpl } = shopifyStore();
    const { shopifyAdapter } = await import('../src/adapters/shopify.js');
    const ctx = { fetchImpl, baseUrl: 'https://shop.example' } as any;

    // One product from the second page: two requests, never all 300.
    await shopifyAdapter.fetchSome!(ctx, ['https://shop.example/products/runner-260']);
    expect(asked.filter((u) => u.includes('/products.json')).length).toBeLessThanOrEqual(2);
  });

  it('hands back to the pages when the listing will not serve us', async () => {
    const fetchImpl = (async (input: any) => {
      const url = String(input);
      if (url.includes('/products.json')) return new Response('no', { status: 403 });
      return new Response('<html></html>', { status: 200, headers: { 'content-type': 'text/html' } });
    }) as typeof fetch;
    const { shopifyAdapter } = await import('../src/adapters/shopify.js');
    const got = await shopifyAdapter.fetchSome!({ fetchImpl, baseUrl: 'https://shop.example' } as any, chosen(5));
    // Null, not an empty list: the caller must know to read the pages itself.
    expect(got).toBeNull();
  });
});
