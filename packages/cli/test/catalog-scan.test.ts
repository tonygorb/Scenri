import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCore, type EngineAdapter } from '@scenri/core';
import { createDemoEngine } from '@scenri/engine-demo';
import { buildServer } from '../src/server.js';

function registryWith(...adapters: EngineAdapter[]) {
  const byId = new Map(adapters.map((a) => [a.capabilities().id, a]));
  return { all: () => adapters, get: (id: string) => byId.get(id) ?? null };
}

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const HANDLES = Array.from({ length: 40 }, (_, i) => `item-${i + 1}`);
// IMPORT_BATCH is 25, so forty products is two rounds.

/** A storefront whose API is shut and whose product pages are open. */
function storeFetch(input: any) {
  const url = String(input);
  const res = (body: string, status = 200, type = 'text/html') =>
    Promise.resolve(new Response(body, { status, headers: { 'content-type': type } }));
  if (url.endsWith('/robots.txt')) return res('', 404, 'text/plain');
  if (/\/products\.json/.test(url) || /\/products\/[^/]+\.json/.test(url)) return res('no', 403);
  if (url.endsWith('/sitemap.xml'))
    return res(
      `<?xml version="1.0"?><sitemapindex><sitemap><loc>https://shop.example/sitemap_products_1.xml</loc></sitemap></sitemapindex>`,
    );
  if (url.includes('sitemap_products'))
    return res(
      `<?xml version="1.0"?><urlset>${HANDLES.map(
        (h) => `<url><loc>https://shop.example/products/${h}</loc></url>`,
      ).join('')}</urlset>`,
    );
  if (url.includes('sitemap')) return res('<urlset></urlset>');
  if (url.includes('.jpg'))
    return Promise.resolve(new Response(PNG, { status: 200, headers: { 'content-type': 'image/jpeg' } }));
  const handle = /\/products\/([^/?#.]+)$/.exec(url)?.[1];
  if (handle) {
    const ld = {
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: handle,
      url: `https://shop.example/products/${handle}`,
      sku: handle.toUpperCase(),
      image: [1, 2, 3, 4, 5].map((n) => `https://cdn.example/${handle}-${n}.jpg`),
      offers: { '@type': 'Offer', price: 20, priceCurrency: 'USD' },
    };
    return res(`<html><head><script type="application/ld+json">${JSON.stringify(ld)}</script></head></html>`);
  }
  return res('<html><body>shop <script src="https://cdn.shopify.com/x.js"></script></body></html>');
}

describe('scanning a site, then importing only what was chosen', () => {
  let home: string;
  let core: ReturnType<typeof createCore>;
  let app: Awaited<ReturnType<typeof buildServer>>;
  let brandId: string;

  beforeEach(async () => {
    home = mkdtempSync(join(tmpdir(), 'sc-cli-scan-'));
    core = createCore(home);
    app = buildServer({
      core,
      engines: registryWith(createDemoEngine((b) => core.images.save(b))),
      fetchImpl: storeFetch as any,
    });
    await app.ready();
    const brand = await app.inject({
      method: 'POST',
      url: '/api/brands',
      payload: { brand: { specVersion: '0.1', meta: { name: 'Acme', website: 'https://shop.example' } } },
    });
    brandId = brand.json().id;
  });
  afterEach(async () => {
    await app.drain();
    rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  async function scan() {
    const start = await app.inject({ method: 'POST', url: `/api/brands/${brandId}/catalog/scan`, payload: {} });
    expect(start.statusCode).toBe(200);
    const { scanId } = start.json();
    for (let i = 0; i < 100; i++) {
      await new Promise((r) => setTimeout(r, 50));
      const res = await app.inject({ method: 'GET', url: `/api/brands/${brandId}/catalog/scans/${scanId}` });
      if (res.json().status !== 'running') return res.json();
    }
    throw new Error('scan never settled');
  }

  async function importUrls(urls?: string[]) {
    const start = await app.inject({
      method: 'POST',
      url: `/api/brands/${brandId}/catalog/import`,
      payload: urls ? { url: 'https://shop.example', urls } : { url: 'https://shop.example' },
    });
    expect(start.statusCode).toBe(200);
    const { jobId } = start.json();
    for (let i = 0; i < 120; i++) {
      await new Promise((r) => setTimeout(r, 50));
      const res = await app.inject({ method: 'GET', url: `/api/brands/${brandId}/catalog/jobs/${jobId}` });
      const job = res.json();
      if (job.finishedAt || ['completed', 'partial', 'failed', 'no_catalog'].includes(job.stage)) return job;
    }
    throw new Error('import never settled');
  }

  const library = async () =>
    (await app.inject({ method: 'GET', url: `/api/brands/${brandId}/products-library` })).json().products;

  it('reports the whole catalog and previews a slice of it, writing nothing', async () => {
    const state = await scan();
    expect(state.status).toBe('done');
    expect(state.result.verdict).toBe('found');
    expect(state.result.count).toBe(40);
    expect(state.result.candidates.length).toBeLessThanOrEqual(24);
    expect(state.result.truncated).toBe(true);
    expect(state.result.candidateUrls).toHaveLength(40);
    // A scan is a question, not an import.
    expect(await library()).toHaveLength(0);
  });

  it('imports exactly the products chosen', async () => {
    const state = await scan();
    const picked = state.result.candidateUrls.slice(0, 3);
    const job = await importUrls(picked);
    expect(['completed', 'partial']).toContain(job.stage);
    expect(await library()).toHaveLength(3);
  });

  /**
   * A full catalog run marks everything it did not see as gone, which is
   * right when the store dropped an item and destructive when someone is
   * importing twelve products at a time.
   */
  it('does not retire the first batch when a second one arrives', async () => {
    const state = await scan();
    const urls = state.result.candidateUrls as string[];
    await importUrls(urls.slice(0, 3));
    const first = (await library()).map((p: any) => p.name).sort();
    expect(first).toHaveLength(3);

    await importUrls(urls.slice(3, 6));
    const both = await library();
    expect(both).toHaveLength(6);
    expect(both.every((p: any) => p.shots?.length > 0)).toBe(true);
    for (const name of first) expect(both.map((p: any) => p.name)).toContain(name);
  });

  /**
   * A chosen set larger than one batch is read and written a batch at a time,
   * so the products show up as they arrive. Fetching all of them before
   * writing a single row is what left a 2,199-product import reporting "0 of
   * 2,199" for its whole sixteen minutes.
   */
  it('writes a large chosen set in batches rather than all at the end', async () => {
    const state = await scan();
    const urls = (state.result.candidateUrls as string[]).slice(0, 40);
    const job = await importUrls(urls);
    expect(['completed', 'partial']).toContain(job.stage);
    expect(await library()).toHaveLength(40);
    // Counted across the whole import rather than per batch: reporting one
    // batch's own numbers sent the row back to zero every time a new one began.
    expect(job.upserted).toBe(40);
    expect(job.imagesTotal).toBe(40 * 3);
    expect(job.imagesDone).toBe(job.imagesTotal);
  });

  it('refuses a chosen list that points somewhere else', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/brands/${brandId}/catalog/import`,
      payload: { url: 'https://shop.example', urls: ['https://elsewhere.example/products/x'] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/belong to this site/i);
  });

  /**
   * A product page offers about eleven images and Scenri re-encodes each to
   * PNG, so a 2203-product store is 24,233 images and roughly 70 GB. Three per
   * product is a front, a back and a detail; the rest of the URLs stay
   * recorded for later.
   */
  it('keeps a few pictures of each product, not all of them', async () => {
    const state = await scan();
    const job = await importUrls((state.result.candidateUrls as string[]).slice(0, 3));
    expect(await library()).toHaveLength(3);
    // The fixture offers five pictures of each of the three. Three per product
    // are fetched, so nine rather than fifteen. (Asserted on the job's own
    // count because the fixture serves one identical PNG for every URL, and
    // content-addressed storage folds those into a single asset.)
    expect(job.imagesTotal).toBe(9);
    expect(job.imagesDone).toBe(9);
  });

  it('refuses to quietly drop products from a list too long to honour', async () => {
    const many = Array.from({ length: 2100 }, (_, i) => `https://shop.example/products/item-${i + 1}`);
    const res = await app.inject({
      method: 'POST',
      url: `/api/brands/${brandId}/catalog/import`,
      payload: { url: 'https://shop.example', urls: many },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/whole catalogue/i);
  });

  /**
   * Aborting mid-fetch makes the pipeline throw `fetch_failed: aborted` and
   * then conclude `no_products_fetched`, which reads as "this store could not
   * be read" about a store that was answering every request. Both describe the
   * stop, not the site.
   */
  it('reports a stopped import as stopped, with no invented faults', async () => {
    const start = await app.inject({
      method: 'POST',
      url: `/api/brands/${brandId}/catalog/import`,
      payload: { url: 'https://shop.example' },
    });
    const { jobId } = start.json();
    await new Promise((r) => setTimeout(r, 60));
    await app.inject({ method: 'POST', url: `/api/brands/${brandId}/catalog/jobs/${jobId}/cancel` });

    let job: any;
    for (let i = 0; i < 120; i++) {
      await new Promise((r) => setTimeout(r, 50));
      job = (await app.inject({ method: 'GET', url: `/api/brands/${brandId}/catalog/jobs/${jobId}` })).json();
      if (job.finishedAt) break;
    }
    expect(job.stage).toBe('cancelled');
    expect(job.errors).toHaveLength(0);
    expect(job.message).toMatch(/^Stopped/);
  });

  it('still imports the whole catalog when nothing is chosen', async () => {
    const job = await importUrls();
    expect(['completed', 'partial']).toContain(job.stage);
    expect(await library()).toHaveLength(40);
  });
});
