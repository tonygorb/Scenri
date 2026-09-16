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
        images: [1, 2, 3].map((n) => ({ src: `http://${origin}/img/${handle}-${n}.png`, position: n })),
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
    // It names the shop and counts the work, in whichever unit is still moving:
    // products while they are being read, pictures once they all are.
    expect(text).toMatch(/\d+ of \d+ (products|pictures)|products/);
    // A clock, not a percent. The job's percent goes backwards - the picture
    // phase divides by a total that grows as products are written - so what is
    // shown is the one number that cannot.
    await expect(bar.locator('.sc-impbar-clock')).toHaveText(/^\d+:\d{2}(:\d{2})?$/);
    // And the shop is its mark, not its address.
    expect(text).not.toContain('127.0.0.1');

    // It is on the products page too, which is the page an import fills.
    await page.goto(`/${brand.slug}/products`);
    await expect(page.locator('.sc-impbar-float .sc-impbar')).toBeVisible({ timeout: 20_000 });
    await page.goto(label === 'phone' ? `/${brand.slug}/create` : `/${brand.slug}`);
    await expect(bar).toBeVisible({ timeout: 20_000 });

    // The bar only ever advances. The picture total used to be "pictures we
    // have looked at so far", which grew by sixty every round and dropped the
    // fraction with it: 60/60, then 64/120, then 122/172.
    const pctOf = () =>
      bar.evaluate((el) => Number.parseFloat(getComputedStyle(el).getPropertyValue('--sc-impbar-p')) || 0);
    let last = await pctOf();
    for (let i = 0; i < 8; i++) {
      await page.waitForTimeout(400);
      if (!(await bar.isVisible().catch(() => false))) break;
      const nowPct = await pctOf();
      expect(nowPct).toBeGreaterThanOrEqual(last);
      last = nowPct;
    }

    // The pill is the door back into the run. The exact counters, and the list
    // of what failed, live in the dialog, and the only way into it used to be a
    // row inside the bell.
    await bar.getByRole('button', { name: 'Show import details' }).click();
    const sheet = page.locator('.sc-imp');
    await expect(sheet).toBeVisible();
    await expect(sheet.getByText('Found on the site')).toBeVisible();
    await sheet.getByRole('button', { name: 'Close' }).click();
    await expect(sheet).toBeHidden();

    // It offers the one thing there is to do, and stopping really stops it.
    await expect(bar.getByRole('button', { name: 'Stop importing' })).toBeVisible();
    await bar.getByRole('button', { name: 'Stop importing' }).click();
    await expect(bar).toBeHidden({ timeout: 60_000 });
  });
}
