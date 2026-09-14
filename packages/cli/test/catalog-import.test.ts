import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCore, type EngineAdapter } from '@scenri/core';
import { createDemoEngine } from '@scenri/engine-demo';
import { buildServer } from '../src/server.js';
import { brandJsonWithCatalogProducts } from '../src/catalogImport.js';

function registryWith(...adapters: EngineAdapter[]) {
  const byId = new Map(adapters.map((a) => [a.capabilities().id, a]));
  return { all: () => adapters, get: (id: string) => byId.get(id) ?? null };
}

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

function shopifyFetch(input: any) {
  const url = String(input);
  if (url.includes('/products.json')) {
    const page = Number(new URL(url).searchParams.get('page') ?? '1');
    if (page > 1) return Promise.resolve(new Response(JSON.stringify({ products: [] }), { status: 200 }));
    return Promise.resolve(
      new Response(
        JSON.stringify({
          products: [
            {
              id: 1,
              title: 'House Blend',
              handle: 'house-blend',
              body_html: '<p>coffee</p>',
              vendor: 'Acme',
              product_type: 'Coffee',
              tags: 'flagship',
              // sold in three colours, the way a real store declares them
              options: [{ name: 'Color' }],
              variants: [
                {
                  id: 11,
                  title: 'Forest green',
                  sku: 'HB-G',
                  price: '18.00',
                  available: true,
                  option1: 'Forest green',
                },
                { id: 12, title: 'Sky blue', sku: 'HB-B', price: '18.00', available: true, option1: 'Sky blue' },
                { id: 13, title: 'Plum', sku: 'HB-P', price: '18.00', available: true, option1: 'Plum' },
              ],
              images: [{ src: 'https://cdn.example/blend.jpg', position: 1 }],
            },
            {
              id: 2,
              title: 'Espresso',
              handle: 'espresso',
              body_html: '<p>shot</p>',
              vendor: 'Acme',
              product_type: 'Coffee',
              tags: '',
              variants: [{ id: 22, title: 'Default', sku: 'ES', price: '16.00', available: true }],
              images: [{ src: 'https://cdn.example/espresso.jpg', position: 1 }],
            },
          ],
        }),
        { status: 200 },
      ),
    );
  }
  if (url.includes('sitemap')) return Promise.resolve(new Response('<urlset></urlset>', { status: 200 }));
  if (url.includes('.jpg'))
    return Promise.resolve(new Response(PNG, { status: 200, headers: { 'content-type': 'image/jpeg' } }));
  return Promise.resolve(new Response('', { status: 404 }));
}

describe('catalog import API', () => {
  let home: string;
  let core: ReturnType<typeof createCore>;
  let app: Awaited<ReturnType<typeof buildServer>>;

  beforeEach(async () => {
    home = mkdtempSync(join(tmpdir(), 'sc-cli-cat-'));
    core = createCore(home);
    app = buildServer({
      core,
      engines: registryWith(createDemoEngine((b) => core.images.save(b))),
      fetchImpl: shopifyFetch as any,
    });
    await app.ready();
  });
  afterEach(async () => {
    await app.drain();
    rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it('imports full catalog into unified library without duplicates on re-run', async () => {
    const brand = await app.inject({
      method: 'POST',
      url: '/api/brands',
      payload: { brand: { specVersion: '0.1', meta: { name: 'Acme', website: 'https://shop.example' } } },
    });
    const brandId = brand.json().id;

    const start = await app.inject({
      method: 'POST',
      url: `/api/brands/${brandId}/catalog/import`,
      payload: { url: 'https://shop.example' },
    });
    expect(start.statusCode).toBe(200);
    const jobId = start.json().jobId;

    // poll until finished
    let job: any;
    for (let i = 0; i < 80; i++) {
      await new Promise((r) => setTimeout(r, 50));
      const res = await app.inject({ method: 'GET', url: `/api/brands/${brandId}/catalog/jobs/${jobId}` });
      job = res.json();
      if (job.finishedAt || job.stage === 'completed' || job.stage === 'partial' || job.stage === 'failed') break;
    }
    expect(['completed', 'partial']).toContain(job.stage);
    expect(job.upserted).toBe(2);
    expect(job.platform).toBe('shopify');

    const lib1 = await app.inject({ method: 'GET', url: `/api/brands/${brandId}/products-library` });
    expect(lib1.json().products).toHaveLength(2);
    expect(lib1.json().products.every((p: any) => p.shots?.length > 0)).toBe(true);

    // re-import is idempotent
    const start2 = await app.inject({
      method: 'POST',
      url: `/api/brands/${brandId}/catalog/import`,
      payload: { url: 'https://shop.example' },
    });
    const jobId2 = start2.json().jobId;
    for (let i = 0; i < 80; i++) {
      await new Promise((r) => setTimeout(r, 50));
      const res = await app.inject({ method: 'GET', url: `/api/brands/${brandId}/catalog/jobs/${jobId2}` });
      job = res.json();
      if (job.finishedAt || job.stage === 'completed' || job.stage === 'partial' || job.stage === 'failed') break;
    }
    const lib2 = await app.inject({ method: 'GET', url: `/api/brands/${brandId}/products-library` });
    expect(lib2.json().products).toHaveLength(2);
  });

  // The compile projection used to forward nothing the store said about
  // itself: no description (so nothing anchored scale) and no colour
  // options (so a colorway spread read as lighting). Both now ride.
  it('projects the store description and declared colorways for the compiler', async () => {
    const brand = await app.inject({
      method: 'POST',
      url: '/api/brands',
      payload: { brand: { specVersion: '0.1', meta: { name: 'Acme', website: 'https://shop.example' } } },
    });
    const brandId = brand.json().id;
    const start = await app.inject({
      method: 'POST',
      url: `/api/brands/${brandId}/catalog/import`,
      payload: { url: 'https://shop.example' },
    });
    const jobId = start.json().jobId;
    let job: any;
    for (let i = 0; i < 80; i++) {
      await new Promise((r) => setTimeout(r, 50));
      const res = await app.inject({ method: 'GET', url: `/api/brands/${brandId}/catalog/jobs/${jobId}` });
      job = res.json();
      if (job.finishedAt || job.stage === 'completed' || job.stage === 'partial' || job.stage === 'failed') break;
    }
    expect(['completed', 'partial']).toContain(job.stage);

    const json = brandJsonWithCatalogProducts(core, brandId);
    const blend = json.products.find((p: any) => p.name === 'House Blend');
    expect(blend.description).toBe('coffee');
    expect(blend.colorways).toEqual(['Forest green', 'Sky blue', 'Plum']);
    // one variant with no colour option is not a colorway story
    const espresso = json.products.find((p: any) => p.name === 'Espresso');
    expect(espresso.colorways).toBeUndefined();
    expect(espresso.description).toBe('shot');
  });
});

/**
 * Every URL typed at /setup is offered to the catalog importer, because a shop
 * can sit behind a splash page and skipping one would lose products. What
 * changed is only what a zero-product result is called: a site with no shop on
 * it is a fact about the site, and used to be written as `failed` - so a
 * tester whose brand kit had just been built perfectly also got a red bell
 * reading "No public product catalog found".
 */
describe('a website with no shop on it', () => {
  let home: string;
  let core: ReturnType<typeof createCore>;
  let app: ReturnType<typeof buildServer>;

  /** A real site, and a real 404 for every shop-shaped thing asked of it. */
  const marketingSite = (async (input: any) => {
    const url = String(input);
    if (url === 'https://lucid.example/' || url === 'https://lucid.example')
      return new Response('<title>Lucid</title><p>We do bookkeeping.</p>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });
    return new Response('not found', { status: 404 });
  }) as unknown as typeof fetch;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'sc-noshop-'));
    core = createCore(home);
    app = buildServer({ core, engines: registryWith(), fetchImpl: marketingSite });
  });
  afterEach(async () => {
    await app.drain();
    rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it('finishes as no_catalog rather than failed, and says so plainly', async () => {
    const brand = await app.inject({
      method: 'POST',
      url: '/api/brands',
      payload: { brand: { specVersion: '0.1', meta: { name: 'Lucid' } } },
    });
    const brandId = brand.json().id;
    const start = await app.inject({
      method: 'POST',
      url: `/api/brands/${brandId}/catalog/import`,
      payload: { url: 'https://lucid.example' },
    });
    expect(start.statusCode).toBe(200);

    let job: any;
    for (let i = 0; i < 120; i++) {
      await new Promise((r) => setTimeout(r, 50));
      job = (
        await app.inject({ method: 'GET', url: `/api/brands/${brandId}/catalog/jobs/${start.json().jobId}` })
      ).json();
      if (job.finishedAt) break;
    }
    expect(job.stage).toBe('no_catalog');
    expect(job.message).toBe('No shop found on this site');
    expect(job.errors).toEqual([]);
    expect(job.finishedAt).toBeTruthy();
  });
});

/**
 * A 2,201-product import used to write nothing until every page had been read.
 * The bell said "0 of 2,199" for sixteen minutes, the Products page stayed
 * empty, and an OOM at minute nineteen left zero products behind for all of it.
 * Products are persisted in batches now, so what has landed is readable while
 * the rest is still arriving.
 */
describe('a large import is readable while it runs', () => {
  let home: string;
  let core: ReturnType<typeof createCore>;
  let app: Awaited<ReturnType<typeof buildServer>>;
  /** Held until the test lets go, so the job cannot finish before it is looked at. */
  let openTheGate: () => void;
  let gate: Promise<void>;

  const COUNT = 30;
  /** Pages past this one are held, so the crawl cannot finish on its own. */
  const HELD_FROM = 20;

  beforeEach(async () => {
    gate = new Promise<void>((r) => {
      openTheGate = r;
    });
    home = mkdtempSync(join(tmpdir(), 'sc-cli-prog-'));
    core = createCore(home);
    app = buildServer({
      core,
      engines: registryWith(createDemoEngine((b) => core.images.save(b))),
      fetchImpl: (async (input: any) => {
        const url = String(input);
        // gymshark.com's shape: a Shopify store whose own product API refuses
        // us, so the catalogue is a wall of pages read one at a time. This is
        // the run that takes minutes and the only one batching is about; the
        // bulk-API path is a handful of requests and stays one round.
        if (url.includes('/products.json')) return new Response('blocked', { status: 403 });
        if (url.endsWith('/sitemap.xml'))
          return new Response(
            `<?xml version="1.0"?><sitemapindex><sitemap><loc>https://shop.example/sitemap_products_1.xml</loc></sitemap></sitemapindex>`,
            { status: 200 },
          );
        if (url.includes('sitemap_products_1'))
          return new Response(
            `<?xml version="1.0"?><urlset>${Array.from(
              { length: COUNT },
              (_, i) => `<url><loc>https://shop.example/products/product-${i + 1}</loc></url>`,
            ).join('')}</urlset>`,
            { status: 200 },
          );
        const page = /\/products\/product-(\d+)$/.exec(url);
        if (page) {
          const i = Number(page[1]);
          // The tail of the crawl is held until the test lets go, so what is
          // on screen while it waits is what a real import shows you partway
          // through a store of thousands.
          if (i > HELD_FROM) await gate;
          return new Response(
            `<html><head><script type="application/ld+json">${JSON.stringify({
              '@context': 'https://schema.org',
              '@type': 'Product',
              name: `Product ${i}`,
              sku: `P-${i}`,
              url,
              image: [`https://cdn.example/p${i}.jpg`],
              offers: { '@type': 'Offer', price: 10, priceCurrency: 'USD' },
            })}</script></head><body><button>Add to cart</button></body></html>`,
            { status: 200 },
          );
        }
        if (url.includes('.jpg')) return new Response(PNG, { status: 200, headers: { 'content-type': 'image/jpeg' } });
        return new Response('', { status: 404 });
      }) as any,
    });
    await app.ready();
  });
  afterEach(async () => {
    // Let the run end before the home goes away. The job keeps writing
    // progress, and tearing the database out from under it surfaces as an
    // unhandled rejection that has nothing to do with the test.
    openTheGate();
    await app.drain();
    rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  // Polls a real import through the HTTP surface, so it needs more than the
  // 5 s default.
  it('serves the products that have landed before the job is finished', { timeout: 20_000 }, async () => {
    const brand = await app.inject({
      method: 'POST',
      url: '/api/brands',
      payload: { brand: { specVersion: '0.1', meta: { name: 'Acme', website: 'https://shop.example' } } },
    });
    const brandId = brand.json().id;
    const start = await app.inject({
      method: 'POST',
      url: `/api/brands/${brandId}/catalog/import`,
      payload: { url: 'https://shop.example' },
    });
    const jobId = start.json().jobId;

    let landed = 0;
    let job: any = null;
    for (let i = 0; i < 100 && landed === 0; i++) {
      await new Promise((r) => setTimeout(r, 50));
      const lib = await app.inject({ method: 'GET', url: `/api/brands/${brandId}/products-library` });
      landed = lib.json().products.length;
      job = (await app.inject({ method: 'GET', url: `/api/brands/${brandId}/catalog/jobs/${jobId}` })).json();
    }

    // A PART of the catalogue is readable, while the crawl that is writing it
    // is still going: products reach the database as their pages parse, one at
    // a time, rather than after every page has been read. The old pipeline
    // read all thirty pages before writing a row, and the Products page stayed
    // empty for the whole run.
    expect(landed).toBeGreaterThan(0);
    expect(landed).toBeLessThanOrEqual(HELD_FROM);
    expect(job.finishedAt).toBeFalsy();

    openTheGate();
    for (let i = 0; i < 200; i++) {
      await new Promise((r) => setTimeout(r, 50));
      job = (await app.inject({ method: 'GET', url: `/api/brands/${brandId}/catalog/jobs/${jobId}` })).json();
      if (job.finishedAt) break;
    }
    expect(job.upserted).toBe(COUNT);
    const lib = await app.inject({ method: 'GET', url: `/api/brands/${brandId}/products-library` });
    expect(lib.json().products).toHaveLength(COUNT);
  });
});

/**
 * A shop that starts turning us away mid-catalogue used to look exactly like a
 * shop with very few products. A real gymshark.com run answered 413 pages and
 * then HTTP 405 with `x-amzn-waf-action: captcha` for the remaining 1,794, and
 * the job called itself "Imported 413 products with 209 issues" - a sentence
 * about pictures, for a run that had been shut out.
 */
describe('a store that stops answering', () => {
  let home: string;
  let core: ReturnType<typeof createCore>;
  let app: Awaited<ReturnType<typeof buildServer>>;
  const COUNT = 40;
  /** Pages past this one are refused, the way a bot check refuses them. */
  const OPEN_UNTIL = 10;

  beforeEach(async () => {
    home = mkdtempSync(join(tmpdir(), 'sc-cli-shut-'));
    core = createCore(home);
    app = buildServer({
      core,
      engines: registryWith(createDemoEngine((b) => core.images.save(b))),
      fetchImpl: (async (input: any) => {
        const url = String(input);
        if (url.includes('/products.json')) return new Response('blocked', { status: 403 });
        if (url.endsWith('/sitemap.xml'))
          return new Response(
            `<?xml version="1.0"?><sitemapindex><sitemap><loc>https://shop.example/sitemap_products_1.xml</loc></sitemap></sitemapindex>`,
            { status: 200 },
          );
        if (url.includes('sitemap_products_1'))
          return new Response(
            `<?xml version="1.0"?><urlset>${Array.from(
              { length: COUNT },
              (_, i) => `<url><loc>https://shop.example/products/product-${i + 1}</loc></url>`,
            ).join('')}</urlset>`,
            { status: 200 },
          );
        const page = /\/products\/product-(\d+)$/.exec(url);
        if (page) {
          const i = Number(page[1]);
          if (i > OPEN_UNTIL) return new Response('<html><body>captcha</body></html>', { status: 405 });
          return new Response(
            `<html><head><script type="application/ld+json">${JSON.stringify({
              '@context': 'https://schema.org',
              '@type': 'Product',
              name: `Product ${i}`,
              sku: `P-${i}`,
              url,
              image: [`https://cdn.example/p${i}.jpg`],
              offers: { '@type': 'Offer', price: 10, priceCurrency: 'USD' },
            })}</script></head><body><button>Add to cart</button></body></html>`,
            { status: 200 },
          );
        }
        if (url.includes('.jpg')) return new Response(PNG, { status: 200, headers: { 'content-type': 'image/jpeg' } });
        return new Response('', { status: 404 });
      }) as any,
    });
    await app.ready();
  });
  afterEach(async () => {
    await app.drain();
    rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it('says the store stopped answering, and keeps what it read', async () => {
    const brand = await app.inject({
      method: 'POST',
      url: '/api/brands',
      payload: { brand: { specVersion: '0.1', meta: { name: 'Acme', website: 'https://shop.example' } } },
    });
    const brandId = brand.json().id;
    const start = await app.inject({
      method: 'POST',
      url: `/api/brands/${brandId}/catalog/import`,
      payload: { url: 'https://shop.example' },
    });
    const jobId = start.json().jobId;
    let job: any;
    for (let i = 0; i < 200; i++) {
      await new Promise((r) => setTimeout(r, 50));
      job = (await app.inject({ method: 'GET', url: `/api/brands/${brandId}/catalog/jobs/${jobId}` })).json();
      if (job.finishedAt) break;
    }
    expect(job.stage).toBe('partial');
    // It names the shortfall in products, not a status code, and records why.
    expect(job.message).toContain(String(COUNT - OPEN_UNTIL));
    expect(job.message).toContain(String(COUNT));
    expect(job.message).not.toMatch(/40[0-9]|error|failed/i);
    expect((job.errors ?? []).some((e: any) => e.code === 'reason_page_blocked')).toBe(true);
    // What it did read is kept, not thrown away.
    const lib = await app.inject({ method: 'GET', url: `/api/brands/${brandId}/products-library` });
    expect(lib.json().products).toHaveLength(OPEN_UNTIL);
  });
});

/**
 * The reported failure, as a fixture.
 *
 * A real store behind Cloudflare answered 429 to nearly every product page. The
 * crawl swallowed each one as a page with no product on it, the run ended
 * saying it had imported zero products, and the user - who had just been told
 * their 1,186 products were found - got silence. Two things were wrong: a run
 * that saves nothing called itself finished, and a refused page carried no
 * reason, so a rate-limited store was indistinguishable from an empty one.
 */
describe('a store that is rate limiting us', () => {
  let home: string;
  let core: ReturnType<typeof createCore>;
  let app: Awaited<ReturnType<typeof buildServer>>;
  const COUNT = 12;
  /** Every product page answers 429, the way a limiter does once tripped. */
  let refuseAll = true;

  beforeEach(async () => {
    refuseAll = true;
    home = mkdtempSync(join(tmpdir(), 'sc-cli-429-'));
    core = createCore(home);
    app = buildServer({
      core,
      engines: registryWith(createDemoEngine((b) => core.images.save(b))),
      fetchImpl: (async (input: any) => {
        const url = String(input);
        if (url.includes('/products.json')) return new Response('blocked', { status: 403 });
        if (url.endsWith('/sitemap.xml'))
          return new Response(
            `<?xml version="1.0"?><sitemapindex><sitemap><loc>https://shop.example/sitemap_products_1.xml</loc></sitemap></sitemapindex>`,
            { status: 200 },
          );
        if (url.includes('sitemap_products_1'))
          return new Response(
            `<?xml version="1.0"?><urlset>${Array.from(
              { length: COUNT },
              (_, i) => `<url><loc>https://shop.example/products/product-${i + 1}</loc></url>`,
            ).join('')}</urlset>`,
            { status: 200 },
          );
        const page = /\/products\/product-(\d+)$/.exec(url);
        if (page) {
          if (refuseAll) return new Response('slow down', { status: 429, headers: { 'retry-after': '0' } });
          const i = Number(page[1]);
          return new Response(
            `<html><head><script type="application/ld+json">${JSON.stringify({
              '@context': 'https://schema.org',
              '@type': 'Product',
              name: `מוצר ${i}`,
              sku: `P-${i}`,
              url,
              image: [`https://cdn.example/p${i}.jpg`],
              offers: { '@type': 'Offer', price: 10, priceCurrency: 'USD' },
            })}</script></head><body><button>Add to cart</button></body></html>`,
            { status: 200 },
          );
        }
        if (url.includes('.jpg')) return new Response(PNG, { status: 200, headers: { 'content-type': 'image/jpeg' } });
        return new Response('', { status: 404 });
      }) as any,
    });
    await app.ready();
  });
  afterEach(async () => {
    await app.drain();
    rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  const brandId = async () =>
    (
      await app.inject({
        method: 'POST',
        url: '/api/brands',
        payload: { brand: { specVersion: '0.1', meta: { name: 'Acme', website: 'https://shop.example' } } },
      })
    ).json().id;

  const runImport = async (id: string) => {
    const start = await app.inject({
      method: 'POST',
      url: `/api/brands/${id}/catalog/import`,
      payload: { url: 'https://shop.example' },
    });
    const jobId = start.json().jobId;
    for (let i = 0; i < 300; i++) {
      await new Promise((r) => setTimeout(r, 50));
      const j = (await app.inject({ method: 'GET', url: `/api/brands/${id}/catalog/jobs/${jobId}` })).json();
      if (j.finishedAt) return j;
    }
    throw new Error('import never finished');
  };

  it('saving nothing is a failure that says why, never a finished import', async () => {
    const id = await brandId();
    const job = await runImport(id);

    expect(job.stage).toBe('failed');
    expect(job.upserted).toBe(0);
    // The sentence a person reads: what happened and what to do, no status code.
    expect(job.message).toMatch(/slow down/i);
    expect(job.message).not.toMatch(/429|error|null|undefined/i);
    expect((job.errors ?? []).some((e: any) => e.code === 'reason_rate_limited')).toBe(true);
  });

  /**
   * The dangerous one. `markMissingUnavailable` marks every key a run did not
   * write, and the library hides `unavailable` rows - so a re-import that a
   * limiter cut short would have retired the catalogue an earlier run had
   * imported perfectly well. A run that was refused pages does not know what
   * is gone.
   */
  it('a refused re-import never retires the products an earlier one saved', async () => {
    const id = await brandId();
    refuseAll = false;
    const first = await runImport(id);
    expect(first.upserted).toBe(COUNT);
    const before = (await app.inject({ method: 'GET', url: `/api/brands/${id}/products-library` })).json().products
      .length;
    expect(before).toBe(COUNT);

    refuseAll = true;
    const second = await runImport(id);
    expect(second.upserted).toBe(0);

    const after = (await app.inject({ method: 'GET', url: `/api/brands/${id}/products-library` })).json().products;
    expect(after).toHaveLength(COUNT);
  });
});

/**
 * What a store may legally hand us, and what we must be able to hand back.
 *
 * The store image path takes its extension from what sharp reads, and sharp
 * reports an AVIF file as `heif`. `heif` was not among the extensions a hash
 * resolves against, so those bytes were written and then unreachable: `has`
 * said no, `read` threw, and the product looked imported with an image nothing
 * could open. A format we cannot keep must fail that one picture loudly, never
 * produce a product that only looks finished.
 */
describe('image formats a real catalog can serve', () => {
  let home: string;
  let core: ReturnType<typeof createCore>;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'sc-fmt-'));
    core = createCore(home);
  });
  afterEach(() => {
    core.close();
    rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it('keeps and finds jpeg, png, webp, gif and avif', async () => {
    const sharp = (await import('sharp')).default;
    const src = sharp({ create: { width: 8, height: 8, channels: 3, background: '#c33' } });
    for (const fmt of ['jpeg', 'png', 'webp', 'avif', 'gif'] as const) {
      const buf = await (src.clone() as any)[fmt]().toBuffer();
      // exactly how the importer decides the extension
      const read = await sharp(buf).metadata();
      const hash = core.images.save(buf, read.format ?? 'png');
      expect(core.images.has(hash), `${fmt}, which sharp reads as ${read.format}`).toBe(true);
      expect(core.images.read(hash).length).toBe(buf.length);
    }
  });
});

/**
 * A product title is prose, and prose is not a path.
 *
 * Titles arrive in any language and carry anything a shop felt like typing.
 * The reported store's own catalogue contains `Star Trek: U.S.S. …` - a colon,
 * illegal in a Windows filename - alongside Hebrew throughout. None of it may
 * reach the filesystem: pictures are content-addressed by hash, and the title
 * only ever goes into a database column.
 */
describe('titles never become filenames', () => {
  let home: string;
  let core: ReturnType<typeof createCore>;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'sc-title-'));
    core = createCore(home);
  });
  afterEach(() => {
    core.close();
    rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it('stores a title full of path characters, Hebrew and an emoji, and keeps its picture findable', () => {
    const brand = core.store.createBrand({ specVersion: '0.1', meta: { name: 'Acme' } } as any);
    const source = core.catalog.upsertSource(brand.id, 'https://shop.example', 'shopify');
    const nasty = 'לגו Icons: U.S.S. / Enterprise? "NCC-1701" <set> | 🧱 \\ *';
    const hash = core.images.save(Buffer.from('picture-bytes'), 'png');
    const p = core.catalog.upsertProduct({
      sourceId: source.id,
      brandId: brand.id,
      externalKey: '11385',
      title: nasty,
      url: 'https://shop.example/products/x',
      images: [{ sourceUrl: 'https://cdn.example/a.png', position: 0, assetRef: `asset:${hash}` }],
    });

    expect(p.title).toBe(nasty);
    const [entry] = core.catalog
      .listLibraryIndex(brand.id, core.store.getBrand(brand.id)!.json)
      .filter((e) => e.origin === 'catalog');
    expect(entry.name).toBe(nasty);
    // the picture is reachable, and its path is the hash rather than the words
    expect(core.images.has(hash)).toBe(true);
    expect(core.images.pathFor(hash)).toMatch(/[a-f0-9]{32}\.png$/);
    for (const ch of ['/', ':', '?', '"', '<', '>', '|', '*', '\\']) {
      expect(core.images.pathFor(hash).split('/').pop()).not.toContain(ch);
    }
  });
});
