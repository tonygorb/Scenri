import { describe, it, expect } from 'vitest';
import { shopifyAdapter } from '../src/adapters/shopify.js';
import { fetchProductPages } from '../src/adapters/productPage.js';
import { isChallenge, httpGet } from '../src/http/fetch.js';
import { pageFailure, summarise, tally } from '../src/failures.js';

/**
 * The store that emptied a 1,186 product catalogue.
 *
 * Measured 2026-09-16 against a real Shopify storefront behind Cloudflare:
 *
 *   GET /products.json?limit=250          200, five pages, the whole catalogue
 *   GET /products/<handle>       x24 @ 8  200 every time, 2.2 s
 *   GET /products/<handle>.json  x24 @ 8  429 every time, `cf-mitigated: challenge`
 *
 * and once that burst had run, `/products.json` and `/sitemap.xml` answered
 * the same challenge for minutes, having answered 200 a minute earlier. The
 * backfill asked the one guarded endpoint for every handle, each refusal armed
 * a host-wide cooldown every other request then waited behind, and the pages
 * that would have worked never got asked. Zero products, several minutes.
 */

/** A Cloudflare interstitial: a whole HTML page, 429, and no Retry-After. */
const challengeResponse = () =>
  new Response('<!DOCTYPE html><html><head><title>Verifying your connection...</title></head></html>', {
    status: 429,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cf-mitigated': 'challenge' },
  });

const HANDLES = Array.from({ length: 24 }, (_, i) => `product-${i + 1}`);

const productPageHtml = (handle: string) =>
  `<html><head><script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: `Product ${handle}`,
    sku: `SKU-${handle}`,
    url: `https://shop.example/products/${handle}`,
    image: [`https://cdn.example/${handle}.jpg`],
    offers: { '@type': 'Offer', price: 19, priceCurrency: 'ILS' },
  })}</script></head><body><button>Add to cart</button></body></html>`;

describe('telling a door from a queue', () => {
  it('reads a challenge as a challenge, and a real limiter as a limiter', () => {
    expect(isChallenge(challengeResponse())).toBe(true);
    // An HTML 429 with no Retry-After is the same interstitial without the header.
    expect(
      isChallenge(new Response('<html>nope</html>', { status: 429, headers: { 'content-type': 'text/html' } })),
    ).toBe(true);
    // A server that says when to come back means it.
    expect(isChallenge(new Response('slow down', { status: 429, headers: { 'retry-after': '5' } }))).toBe(false);
    expect(isChallenge(new Response('{}', { status: 429, headers: { 'content-type': 'application/json' } }))).toBe(
      false,
    );
    expect(isChallenge(new Response('ok', { status: 200 }))).toBe(false);
  });

  it('does not retry a challenge, because every retry fails the same way', async () => {
    let asked = 0;
    const fetchImpl = (async () => {
      asked++;
      return challengeResponse();
    }) as typeof fetch;

    const res = await httpGet('https://shop.example/products/x.json', { fetchImpl, retries: 3 });
    expect(res.status).toBe(429);
    // Once. The default three retries would be three more identical refusals,
    // and each one used to extend a cooldown shared by every other request.
    expect(asked).toBe(1);
  });

  it('says so in words that do not tell someone to wait it out', () => {
    const acc = {};
    tally(acc, 'CHALLENGED', 12);
    const said = summarise(acc, 0, 12)!;
    expect(said).toMatch(/browser/i);
    // Waiting is the advice for a rate limit, and it cannot work here.
    expect(said).not.toMatch(/wait|try again|slow down/i);
    expect(said).not.toMatch(/[45]\d\d|_|undefined|null/);
    expect(pageFailure(429, true)).toBe('CHALLENGED');
    expect(pageFailure(429, false)).toBe('RATE_LIMITED');
  });
});

describe('a store that guards its product API but serves its product pages', () => {
  /** Counts every request so the test can prove what was and was not asked. */
  const makeStore = () => {
    const asked = { bulk: 0, handleJson: 0, pages: 0 };
    const fetchImpl = (async (input: any) => {
      const url = String(input);
      // The per-handle API is the guarded one. Checked first: it also matches
      // the bulk path below.
      if (/\/products\/[^/]+\.json/.test(url)) {
        asked.handleJson++;
        return challengeResponse();
      }
      if (url.includes('/products.json')) {
        asked.bulk++;
        const page = Number(new URL(url).searchParams.get('page') ?? '1');
        const limit = Number(new URL(url).searchParams.get('limit') ?? '250');
        // Everything on page one, so the bulk walk covers the catalogue.
        const products =
          page > 1
            ? []
            : HANDLES.slice(0, limit).map((handle, i) => ({
                id: i + 1,
                title: `Product ${handle}`,
                handle,
                variants: [{ id: (i + 1) * 10, title: 'Default', price: '19.00', available: true }],
                images: [{ src: `https://cdn.example/${handle}.jpg`, position: 1 }],
              }));
        return new Response(JSON.stringify({ products }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.includes('sitemap')) {
        // The sitemap names the same products, plus three the bulk API did not
        // carry - which is what made the backfill non-empty in the real case.
        const locs = [...HANDLES, 'extra-1', 'extra-2', 'extra-3']
          .map((h) => `<url><loc>https://shop.example/products/${h}</loc></url>`)
          .join('');
        return new Response(`<urlset>${locs}</urlset>`, { status: 200 });
      }
      const handle = /\/products\/([^/?#]+)$/.exec(url)?.[1];
      if (handle) {
        asked.pages++;
        return new Response(productPageHtml(handle), { status: 200, headers: { 'content-type': 'text/html' } });
      }
      return new Response('nope', { status: 404 });
    }) as typeof fetch;
    return { asked, fetchImpl };
  };

  it('imports the catalogue instead of emptying it', async () => {
    const { asked, fetchImpl } = makeStore();
    const ctx = { fetchImpl, baseUrl: 'https://shop.example' };

    const discovered = await shopifyAdapter.discover(ctx);
    expect(discovered.productUrls.length).toBeGreaterThanOrEqual(HANDLES.length);

    const products = await shopifyAdapter.fetchAll(ctx, discovered);

    // The whole point: a store that answers 200 on every page it is asked for
    // must not import as nothing.
    expect(products.length).toBeGreaterThanOrEqual(HANDLES.length);
    expect(products.every((p) => p.title)).toBe(true);

    // And it stopped asking the guarded endpoint almost immediately rather
    // than once per missing handle.
    expect(asked.handleJson).toBeLessThanOrEqual(4);
  });

  it('reads the three the bulk API missed from their pages', async () => {
    const { asked, fetchImpl } = makeStore();
    const ctx = { fetchImpl, baseUrl: 'https://shop.example' };
    const discovered = await shopifyAdapter.discover(ctx);
    const products = await shopifyAdapter.fetchAll(ctx, discovered);
    // Matched on the address, not the handle: a product read from its page
    // comes from JSON-LD, which carries no Shopify handle.
    const urls = products.map((p) => p.url).join(' ');
    for (const extra of ['extra-1', 'extra-2', 'extra-3']) expect(urls).toContain(extra);
    expect(asked.pages).toBeGreaterThan(0);
  });
});

/**
 * The circuit breaker was dead in exactly the case it was written for: under
 * real WAF pressure the requests throw rather than returning a status, and the
 * catch recorded the refusal without counting it, so 202 of 2,206 products
 * failed having tripped nothing.
 */
describe('giving up when the refusals throw', () => {
  it('stops after a run of thrown refusals, not only answered ones', async () => {
    let asked = 0;
    const ctx = {
      baseUrl: 'https://shop.example',
      fetchImpl: (async () => {
        asked++;
        throw new Error('fetch failed');
      }) as typeof fetch,
    };
    const urls = Array.from({ length: 120 }, (_, i) => `https://shop.example/products/p${i}`);
    const stats = { pages: 0, bytes: 0, refused: 0, reasons: {} };

    const got = await fetchProductPages(ctx, urls, { concurrency: 2, stats, giveUpAfterRefusals: 4 });

    expect(got.length).toBe(0);
    expect(asked).toBeLessThan(urls.length);
    // A thrown refusal costs a full retry ladder (400/800/1600 ms), so four of
    // them two wide is several seconds. That cost is the reason the breaker
    // has to count them.
  }, 30_000);
});

/**
 * A truncated JSON body is not a smaller answer, it is a parse error, and a
 * store that answered 200 to everything then reads as empty. Caught on
 * www.rothys.com, whose 250-product page is 2,333,750 bytes.
 */
describe('reading a large storefront answer', () => {
  it('does not truncate a real page of products into nothing', async () => {
    const products = Array.from({ length: 250 }, (_, i) => ({
      id: i + 1,
      title: `Product ${i + 1}`,
      handle: `product-${i + 1}`,
      // Padded to put the page well past two megabytes, as a real one is.
      body_html: 'x'.repeat(10_000),
      variants: [{ id: i + 1, title: 'Default', price: '1.00', available: true }],
      images: [{ src: `https://cdn.example/p${i + 1}.jpg`, position: 1 }],
    }));
    const body = JSON.stringify({ products });
    expect(body.length).toBeGreaterThan(2_000_000);

    const fetchImpl = (async (input: any) => {
      const url = String(input);
      if (url.includes('/products.json')) {
        const page = Number(new URL(url).searchParams.get('page') ?? '1');
        return new Response(page > 1 ? JSON.stringify({ products: [] }) : body, {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response('nope', { status: 404 });
    }) as typeof fetch;

    const discovered = await shopifyAdapter.discover({ fetchImpl, baseUrl: 'https://big.example' });
    expect(discovered.productKeys.length).toBe(250);
  });
});
