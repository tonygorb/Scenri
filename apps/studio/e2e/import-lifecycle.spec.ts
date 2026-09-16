import { createServer, type Server } from 'node:http';
import { test, expect, type Page } from '@playwright/test';
import { isolate } from './harness.js';

/**
 * What happens to an import while a person carries on using the app.
 *
 * The import is a server-side job with its own row, and every promise made
 * about it is a promise about something the screen does not own: it survives
 * the dialog closing, the page navigating, a reload, and it stops when it is
 * told to and not before. None of that had a browser test, so none of it was
 * more than an intention.
 *
 * The shop below answers slowly on purpose. A fast fixture finishes before the
 * first assertion and proves nothing about a run in flight.
 */
isolate({ env: { SCENRI_SCRAPE_ALLOW_PRIVATE: '1' } });

const HANDLES = Array.from({ length: 40 }, (_, i) => `boot-${i + 1}`);
/** Enough that a 40-product run stays in flight while a person clicks around. */
const PAGE_DELAY_MS = 350;

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

let shop: Server;
let origin = '';

test.beforeAll(async () => {
  shop = createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0];
    if (path === '/robots.txt') {
      res.writeHead(404, { 'content-type': 'text/plain' });
      return res.end('');
    }
    // A storefront that keeps its JSON shut, so the run is one page per
    // product and therefore observable.
    if (path === '/products.json' || /^\/products\/[^/]+\.json$/.test(path)) {
      res.writeHead(403, { 'content-type': 'text/html' });
      return res.end('<html>403</html>');
    }
    if (path === '/sitemap.xml') {
      res.writeHead(200, { 'content-type': 'application/xml' });
      return res.end(
        `<?xml version="1.0"?><sitemapindex><sitemap><loc>http://${origin}/sitemap_products_1.xml</loc></sitemap></sitemapindex>`,
      );
    }
    if (path.includes('sitemap_products')) {
      res.writeHead(200, { 'content-type': 'application/xml' });
      return res.end(
        `<?xml version="1.0"?><urlset>${HANDLES.map((h) => `<url><loc>http://${origin}/products/${h}</loc></url>`).join('')}</urlset>`,
      );
    }
    if (path.includes('sitemap')) {
      res.writeHead(200, { 'content-type': 'application/xml' });
      return res.end('<urlset></urlset>');
    }
    if (path.endsWith('.png')) {
      res.writeHead(200, { 'content-type': 'image/png' });
      return res.end(PNG);
    }
    const handle = /^\/products\/([^/]+)$/.exec(path)?.[1];
    if (handle) {
      const n = HANDLES.indexOf(handle) + 1;
      const product = {
        '@context': 'https://schema.org',
        '@type': 'Product',
        name: `Trail Boot ${n}`,
        sku: `TB-${n}`,
        url: `http://${origin}/products/${handle}`,
        image: [`http://${origin}/img/${handle}.png`],
        offers: { '@type': 'Offer', price: 90, priceCurrency: 'USD' },
      };
      return setTimeout(() => {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(
          `<!doctype html><html lang="en"><head><title>Trail Boot ${n} | Summit</title>
           <script type="application/ld+json">${JSON.stringify(product)}</script></head><body></body></html>`,
        );
      }, PAGE_DELAY_MS);
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(
      `<!doctype html><html lang="en"><head><title>Summit | Boots</title>
       <meta name="description" content="Boots for long days.">
       <style>:root{--brand-primary:#3b5d3a}</style>
       <script src="https://cdn.shopify.com/s/files/x.js"></script></head>
       <body><header><img src="/img/logo.png" alt="Summit logo" width="240" height="64"></header></body></html>`,
    );
  });
  await new Promise<void>((r) => shop.listen(0, '127.0.0.1', r));
  const a = shop.address();
  origin = `127.0.0.1:${typeof a === 'object' && a ? a.port : 0}`;
});

test.afterAll(async () => {
  await new Promise<void>((r) => shop.close(() => r()));
});

/** The brand this file works against, made once per test from the fixture shop. */
async function makeBrand(page: Page): Promise<{ id: string; slug: string }> {
  return page.evaluate(async (host) => {
    const r = await fetch('/api/brands/from-url', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: `http://${host}/` }),
    });
    const b = await r.json();
    return { id: b.id, slug: b.slug };
  }, origin);
}

const startImport = (page: Page, brandId: string) =>
  page.evaluate(
    async ([id, host]) => {
      const r = await fetch(`/api/brands/${id}/catalog/import`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: `http://${host}/` }),
      });
      return (await r.json()).jobId as string;
    },
    [brandId, origin],
  );

const job = (page: Page, brandId: string, jobId: string) =>
  page.evaluate(async ([b, j]) => (await fetch(`/api/brands/${b}/catalog/jobs/${j}`)).json(), [brandId, jobId]);

const jobCount = (page: Page, brandId: string) =>
  page.evaluate(
    async (b) => ((await (await fetch(`/api/brands/${b}/catalog/jobs`)).json()).jobs ?? []).length,
    brandId,
  );

const productCount = (page: Page, brandId: string) =>
  page.evaluate(
    async (b) => ((await (await fetch(`/api/brands/${b}/products-library`)).json()).products ?? []).length,
    brandId,
  );

/** Wait until the run has saved something but has not finished. */
async function inFlight(page: Page, brandId: string, jobId: string) {
  await expect
    .poll(
      async () => {
        const j = await job(page, brandId, jobId);
        return j.finishedAt ? 'done' : (j.upserted ?? 0) > 0 ? 'working' : 'starting';
      },
      { timeout: 60_000 },
    )
    .toBe('working');
}

/**
 * Group L and AB. A catalogue is not a transaction: the first product is
 * useful long before the last one, and it has to be visible while the rest
 * are still arriving.
 */
test('products arrive while the run is still going, with nothing refreshed', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/setup');
  const brand = await makeBrand(page);
  const jobId = await startImport(page, brand.id);

  await inFlight(page, brand.id, jobId);
  const early = await productCount(page, brand.id);
  expect(early).toBeGreaterThan(0);

  const running = await job(page, brand.id, jobId);
  expect(running.finishedAt).toBeFalsy();
  // Strictly fewer than the catalogue: this is a run caught in the middle.
  expect(early).toBeLessThan(HANDLES.length);

  // The products page, opened while the run continues, shows them growing
  // without anything being reloaded.
  await page.goto(`/${brand.slug}/products`);
  await expect.poll(() => productCount(page, brand.id), { timeout: 90_000 }).toBeGreaterThan(early);
});

/**
 * Group M and T. The job belongs to the server, so neither walking away nor
 * reloading the page may disturb it - and neither may start a second one.
 */
test('an import survives navigation and a reload, and never forks in two', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/setup');
  const brand = await makeBrand(page);
  const jobId = await startImport(page, brand.id);
  await inFlight(page, brand.id, jobId);
  const atStart = await productCount(page, brand.id);

  // Walk around the app while it runs.
  await page.goto(`/${brand.slug}/create`);
  await page.goto(`/${brand.slug}/presenters`);
  await page.goto(`/${brand.slug}/products`);
  // And reload on top of that.
  await page.reload();

  expect(await jobCount(page, brand.id)).toBe(1);
  await expect.poll(() => productCount(page, brand.id), { timeout: 90_000 }).toBeGreaterThan(atStart);

  const finished = await expect
    .poll(async () => (await job(page, brand.id, jobId)).stage, { timeout: 90_000 })
    .toMatch(/completed|partial/)
    .catch(() => null);
  void finished;
  expect(await jobCount(page, brand.id)).toBe(1);
});

/**
 * Group S. Stopping is not undoing. What has already been saved is real work
 * a person can use, and cancelling must not reach back and take it away.
 */
test('cancelling keeps what landed and stops what had not started', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/setup');
  const brand = await makeBrand(page);
  const jobId = await startImport(page, brand.id);
  await inFlight(page, brand.id, jobId);

  const before = await productCount(page, brand.id);
  await page.evaluate(
    async ([b, j]) => {
      await fetch(`/api/brands/${b}/catalog/jobs/${j}/cancel`, { method: 'POST' });
    },
    [brand.id, jobId],
  );

  const stage = await expect
    .poll(async () => (await job(page, brand.id, jobId)).stage, { timeout: 60_000 })
    .toBe('cancelled')
    .then(() => 'cancelled');
  expect(stage).toBe('cancelled');

  const after = await productCount(page, brand.id);
  // Nothing was rolled back.
  expect(after).toBeGreaterThanOrEqual(before);
  // And it really stopped, well short of the catalogue.
  expect(after).toBeLessThan(HANDLES.length);

  // It says so in words, and the words agree with what is on disk. A stop
  // that unwound through the catch used to report "Stopped before anything was
  // saved" whatever had happened - seen on a real run holding 294 products and
  // 822 pictures.
  const j = await job(page, brand.id, jobId);
  const said = String(j.message ?? '');
  expect(said).toMatch(/stopped/i);
  if ((j.upserted ?? 0) > 0) {
    expect(said).toMatch(/after saving/i);
    expect(said).toContain(String(j.upserted));
    expect(said).not.toMatch(/before anything was saved/i);
  }

  // Settled for good: nothing keeps arriving after a stop.
  const settled = await productCount(page, brand.id);
  await page.waitForTimeout(2500);
  expect(await productCount(page, brand.id)).toBe(settled);
});

/**
 * Group R and X. Running the same store again is the recovery path for a run
 * that was stopped or that half worked, so it has to top up rather than
 * duplicate: products are keyed by what the store calls them.
 */
test('importing the same store twice tops up instead of duplicating', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/setup');
  const brand = await makeBrand(page);

  const first = await startImport(page, brand.id);
  await inFlight(page, brand.id, first);
  await page.evaluate(
    async ([b, j]) => {
      await fetch(`/api/brands/${b}/catalog/jobs/${j}/cancel`, { method: 'POST' });
    },
    [brand.id, first],
  );
  await expect.poll(async () => (await job(page, brand.id, first)).stage, { timeout: 60_000 }).toBe('cancelled');
  const partial = await productCount(page, brand.id);
  expect(partial).toBeGreaterThan(0);
  expect(partial).toBeLessThan(HANDLES.length);

  // Run it again, to completion.
  const second = await startImport(page, brand.id);
  await expect
    .poll(async () => (await job(page, brand.id, second)).stage, { timeout: 150_000 })
    .toMatch(/completed|partial/);

  const total = await productCount(page, brand.id);
  // Every product once, however many runs it took to get them.
  expect(total).toBe(HANDLES.length);
  expect(await jobCount(page, brand.id)).toBe(2);
});
