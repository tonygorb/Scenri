import { createServer, type Server } from 'node:http';
import { test, expect } from '@playwright/test';
import { isolate } from './harness.js';

/**
 * A store that serves its own listing, which is what most Shopify shops are.
 *
 * Every other fixture in this suite answers 403 to `/products.json`, because
 * each was written for a storefront that keeps its JSON shut. That left the
 * ordinary path - the one a real Shopify store takes - with no browser test at
 * all, and it is where this broke: the catalogue arrives as `cards` rather
 * than as page-read `candidates`, and the button that offers to import them
 * was still looking only at the latter. A person who had just been shown 1,187
 * products pressed the primary button and was put on the home page with
 * nothing imported.
 */
isolate({ env: { SCENRI_SCRAPE_ALLOW_PRIVATE: '1' } });

const N = 40;
const HANDLES = Array.from({ length: N }, (_, i) => `clog-${i + 1}`);
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
    // The listing a real Shopify store serves: name and pictures, in bulk.
    if (path === '/products.json') {
      const u = new URL(req.url ?? '/', `http://${origin}`);
      const page = Number(u.searchParams.get('page') ?? '1');
      const limit = Number(u.searchParams.get('limit') ?? '250');
      const start = (page - 1) * limit;
      const products = HANDLES.slice(start, start + limit).map((handle, i) => {
        const n = start + i + 1;
        return {
          id: n,
          title: `Garden Clog ${n}`,
          handle,
          body_html: '<p>Comfortable.</p>',
          variants: [{ id: n * 10, title: 'Default', price: '60.00', available: true }],
          images: [{ src: `http://${origin}/img/${handle}_200x200.png`, position: 1 }],
        };
      });
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ products }));
    }
    if (path.includes('sitemap')) {
      res.writeHead(200, { 'content-type': 'application/xml' });
      return res.end('<urlset></urlset>');
    }
    if (path.endsWith('.png')) {
      res.writeHead(200, { 'content-type': 'image/png' });
      return res.end(PNG);
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(
      `<!doctype html><html lang="en"><head><title>Meadow | Clogs</title>
       <meta name="description" content="Clogs for the garden.">
       <style>:root{--brand-primary:#4a6741}</style></head>
       <body><header><img src="/img/logo.png" alt="Meadow logo" width="240" height="64"></header></body></html>`,
    );
  });
  await new Promise<void>((r) => shop.listen(0, '127.0.0.1', r));
  const a = shop.address();
  origin = `127.0.0.1:${typeof a === 'object' && a ? a.port : 0}`;
});

test.afterAll(async () => {
  await new Promise<void>((r) => shop.close(() => r()));
});

test('a store that lists its own products can be chosen from and imported', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/setup');
  await page.locator('#sc-wiz-url').fill(`http://${origin}/`);
  await page.getByRole('button', { name: 'Build the kit' }).click();
  const anyway = page.getByRole('button', { name: 'Create anyway' });
  if (await anyway.isVisible().catch(() => false)) await anyway.click();

  // The kit counts them.
  const lines = page.locator('.sc-kit-lines');
  await expect(lines).toBeVisible({ timeout: 30_000 });
  await expect(lines).toContainText(`${N} found`, { timeout: 45_000 });

  // And the button underneath offers them. This is the assertion that failed:
  // the row said "40 found" while the primary read "Looks right", which lands
  // the brand and imports nothing.
  const offer = page.getByRole('button', { name: 'Add brand and products' });
  await expect(offer).toBeVisible({ timeout: 45_000 });
  await expect(page.getByRole('button', { name: 'Looks right' })).toHaveCount(0);
  await offer.click();

  // Every card is drawn from the listing, so the pictures are there at once
  // and nothing is asked of the store to show them.
  const sheet = page.locator('.sc-wizpick');
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole('button', { name: `Import ${N} products` })).toBeVisible();
  // No shimmer left standing: a card drawn from the listing has its picture
  // from the first frame, because nothing had to be fetched to draw it.
  await expect
    .poll(async () => sheet.locator('.sc-lookcard-media img').count(), { timeout: 20_000 })
    .toBeGreaterThan(0);
  expect(await sheet.locator('.sc-wizpick-loading').count()).toBe(0);

  await sheet.getByRole('button', { name: /^Import / }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/setup'), { timeout: 30_000 });

  // And they really arrive.
  await expect
    .poll(
      async () =>
        page.evaluate(async () => {
          const brands = await (await fetch('/api/brands')).json();
          const last = brands[brands.length - 1];
          const lib = await (await fetch(`/api/brands/${last.id}/products-library`)).json();
          return lib.products.length;
        }),
      { timeout: 90_000 },
    )
    .toBe(N);
});
