import { createServer, type Server } from 'node:http';
import { test, expect, type Page } from '@playwright/test';
import { isolate } from './harness.js';
import { expectSameSession, markSession } from './realtime.js';

/**
 * An import, watched from the Products wall rather than through the API.
 *
 * `import-lifecycle.spec.ts` proves the server writes products while a run is
 * still going. This proves the part a person sees: the wall grows on screen as
 * they land, keeps the place the person scrolled to, and never shows a product
 * whose page could not be read. The shop has one page that fails and one that
 * has no product on it.
 */
isolate({ env: { SCENRI_SCRAPE_ALLOW_PRIVATE: '1' } });

const HANDLES = Array.from({ length: 24 }, (_, i) => `boot-${i + 1}`);
const BROKEN = 'boot-5';
const EMPTY = 'boot-9';
const PAGE_DELAY_MS = 900;
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
      return setTimeout(() => {
        if (handle === BROKEN) {
          res.writeHead(500, { 'content-type': 'text/plain' });
          return res.end('boom');
        }
        const body =
          handle === EMPTY
            ? '<p>This page sells nothing.</p>'
            : `<script type="application/ld+json">${JSON.stringify({
                '@context': 'https://schema.org',
                '@type': 'Product',
                name: `Trail Boot ${n}`,
                sku: `TB-${n}`,
                url: `http://${origin}/products/${handle}`,
                image: [`http://${origin}/img/${handle}.png`],
                offers: { '@type': 'Offer', price: 90, priceCurrency: 'USD' },
              })}</script>`;
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(
          `<!doctype html><html lang="en"><head><title>Trail Boot ${n} | Summit</title>${body}</head><body></body></html>`,
        );
      }, PAGE_DELAY_MS);
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(
      `<!doctype html><html lang="en"><head><title>Summit | Boots</title>
       <meta name="description" content="Boots for long days.">
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

const wallCards = (p: Page) => p.locator('.sc-owned .sc-lookcard');
const scroller = (p: Page) => p.locator('[data-page-scroll]').first();

test('an import grows the wall on screen, keeps the scroll, and never shows a product it could not read', async ({
  page,
}) => {
  test.setTimeout(150_000);
  await page.goto('/setup');
  const brand = (await page.evaluate(async (host) => {
    const r = await fetch('/api/brands/from-url', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: `http://${host}/` }),
    });
    return r.json();
  }, origin)) as { id: string; slug: string };

  await page.goto(`/${brand.slug}/products`);
  await markSession(page);
  const jobId = (await page.evaluate(
    async ([id, host]) => {
      const r = await fetch(`/api/brands/${id}/catalog/import`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: `http://${host}/` }),
      });
      return (await r.json()).jobId;
    },
    [brand.id, origin],
  )) as string;
  // Started from the product dialog, an import pokes the bell at once
  // (AssetCreateHost). Started here through the API it would wait for the
  // bell's idle tick instead, so do what the dialog does: wake it.
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  const finished = async () =>
    !!(
      (await page.evaluate(
        async ([b, j]) => (await fetch(`/api/brands/${b}/catalog/jobs/${j}`)).json(),
        [brand.id, jobId],
      )) as { finishedAt?: string }
    ).finishedAt;

  // Arrivals are seen on the wall while the run is still going: several
  // distinct counts, each larger than the last, before it finishes.
  const seen: number[] = [];
  while (!(await finished())) {
    const n = await wallCards(page).count();
    if (!seen.length || n !== seen[seen.length - 1]) seen.push(n);
    if (seen.length === 3) {
      // a person scrolled down to look; arrivals must not move them
      await scroller(page).evaluate((el) => {
        el.scrollTop = 240;
      });
    }
    await page.waitForTimeout(250);
  }
  expect(seen.length).toBeGreaterThanOrEqual(3);
  for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeGreaterThan(seen[i - 1]);
  const top = await scroller(page).evaluate((el) => el.scrollTop);
  expect(top).toBeGreaterThan(200);

  // Once over, the wall holds exactly what was read, and nothing that was not.
  const listed = (await page.evaluate(
    async (b) => (await (await fetch(`/api/brands/${b}/products-library`)).json()).products,
    brand.id,
  )) as { name: string }[];
  expect(listed).toHaveLength(HANDLES.length - 2);
  await expect(wallCards(page)).toHaveCount(listed.length);
  await expect(page.locator('.sc-owned .sc-lookcard-cap', { hasText: /^Trail Boot 5$/ })).toHaveCount(0);
  await expect(page.locator('.sc-owned .sc-lookcard-cap', { hasText: /^Trail Boot 9$/ })).toHaveCount(0);
  expect(await scroller(page).evaluate((el) => el.scrollTop)).toBe(top);
  await expectSameSession(page);
});
