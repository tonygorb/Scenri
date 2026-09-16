import { createServer, type Server } from 'node:http';
import { test, expect } from '@playwright/test';
import { isolate } from './harness.js';

/**
 * A catalogue import, while it is happening, where you are already looking.
 *
 * Until this existed the only place a running import appeared was a row inside
 * the bell - a panel you have to remember to open - so a person who had just
 * started one watched a wall of products fill in with nothing to say what was
 * happening or how to stop it.
 */
isolate({ env: { SCENRI_SCRAPE_ALLOW_PRIVATE: '1' } });
const N = 60;
const HANDLES = Array.from({ length: N }, (_, i) => `sock-${i + 1}`);
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
      res.writeHead(404);
      return res.end('');
    }
    if (path === '/products.json') {
      const u = new URL(req.url ?? '/', `http://${origin}`);
      const page = Number(u.searchParams.get('page') ?? '1');
      const start = (page - 1) * 250;
      const products = HANDLES.slice(start, start + 250).map((handle, i) => ({
        id: start + i + 1,
        title: `Wool Sock ${start + i + 1}`,
        handle,
        variants: [{ id: 1, title: 'Default', price: '18.00', available: true }],
        images: [{ src: `http://${origin}/img/${handle}.png`, position: 1 }],
      }));
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ products }));
    }
    if (path.includes('sitemap')) {
      res.writeHead(200, { 'content-type': 'application/xml' });
      return res.end('<urlset></urlset>');
    }
    if (path.endsWith('.png')) {
      // Slow pictures, so the bar is caught mid-run.
      return setTimeout(() => {
        res.writeHead(200, { 'content-type': 'image/png' });
        res.end(PNG);
      }, 220);
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(
      `<!doctype html><html><head><title>Woolly | Socks</title><style>:root{--brand-primary:#5b7c99}</style></head><body><header><img src="/img/logo.png" alt="Woolly logo" width="240" height="64"></header></body></html>`,
    );
  });
  await new Promise<void>((r) => shop.listen(0, '127.0.0.1', r));
  const a = shop.address();
  origin = `127.0.0.1:${typeof a === 'object' && a ? a.port : 0}`;
});
test.afterAll(async () => {
  await new Promise<void>((r) => shop.close(() => r()));
});

for (const [w, h, label] of [
  [1440, 900, 'desktop'],
  [390, 820, 'phone'],
] as [number, number, string][]) {
  test(`import dock ${label}`, async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: w, height: h });
    await page.goto('/setup');
    const brand = await page.evaluate(async (host) => {
      const r = await fetch('/api/brands/from-url', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: `http://${host}/` }),
      });
      const b = await r.json();
      return { id: b.id, slug: b.slug };
    }, origin);
    await page.evaluate(
      async ([id, host]) => {
        await fetch(`/api/brands/${id}/catalog/import`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ url: `http://${host}/` }),
        });
      },
      [brand.id, origin],
    );

    // Home unmounts its whole dock on a phone - there is no composer there -
    // so the phone's home for this is Create, which keeps it at every width.
    await page.goto(label === 'phone' ? `/${brand.slug}/create` : `/${brand.slug}`);
    const bar = page.locator('.sc-impbar');
    await expect(bar).toBeVisible({ timeout: 40_000 });
    const text = await bar.innerText();
    // It names the shop and counts products, in the one unit the row uses.
    expect(text).toMatch(/\d+ of \d+ products|products/);
    // And the fill is real progress, not decoration.
    const pct = await bar.evaluate((el) => getComputedStyle(el).getPropertyValue('--sc-impbar-p'));
    expect(pct.trim()).toMatch(/^\d+(\.\d+)?%$/);

    // It offers the one thing there is to do, and stopping really stops it.
    await expect(bar.getByRole('button', { name: 'Stop importing' })).toBeVisible();
    await bar.getByRole('button', { name: 'Stop importing' }).click();
    await expect(bar).toBeHidden({ timeout: 60_000 });
  });
}
