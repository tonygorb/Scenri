import { createServer, type Server } from 'node:http';
import { test, expect } from '@playwright/test';
import { isolate } from './harness.js';

/**
 * Pasting a website at /setup.
 *
 * Nothing drove this field before, which is how a tester came to read
 * "Invalid URL" under a perfectly good marketing site: the studio built the
 * URL from the untrimmed field, a leading space produced `https://  https://…`,
 * and Node's parser message reached the screen as the whole explanation.
 *
 * The second test is the one that matters most. It serves a real page from a
 * loopback fixture and asserts the whole chain at once: normaliser, guard,
 * extraction, the report a person reads, and that a site with no shop on it
 * rings no alarm.
 */

// SCENRI_SCRAPE_ALLOW_PRIVATE lifts the address guard for the fixture server
// below, which is on 127.0.0.1. Nothing else ever sets it.
isolate({ env: { SCENRI_SCRAPE_ALLOW_PRIVATE: '1' } });

const PAGE = `<!doctype html><html lang="en"><head>
  <title>Bookkeeping, tax and CFO services | Lucid</title>
  <meta name="description" content="Smart tech meets smarter humans.">
  <meta name="theme-color" content="#4d61fc">
  <link rel="icon" href="/favicon.png" sizes="16x16">
  <style>:root{--brand-primary:#4d61fc;--brand-accent:oklch(0.62 0.24 350)}.btn-primary{background:#4d61fc}</style>
</head><body>
  <header class="site-header"><img src="/lucid-logo.png" alt="Lucid logo" width="240" height="64"></header>
  <main><p>We do the numbers.</p></main>
</body></html>`;

// A 1x1 PNG, enough for sharp to decode into a mark.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

let site: Server;
let origin: string;

test.beforeAll(async () => {
  site = createServer((req, res) => {
    if (req.url?.startsWith('/lucid-logo.png') || req.url?.startsWith('/favicon.png')) {
      res.writeHead(200, { 'content-type': 'image/png' });
      return res.end(PNG);
    }
    // Nothing shop-shaped exists here: no sitemap, no feed, no listing page.
    if (req.url !== '/') {
      res.writeHead(404, { 'content-type': 'text/plain' });
      return res.end('not found');
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(PAGE);
  });
  await new Promise<void>((r) => site.listen(0, '127.0.0.1', r));
  const address = site.address();
  origin = `127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
});

test.afterAll(async () => {
  await new Promise<void>((r) => site.close(() => r()));
});

test('a pasted address with a leading space builds the kit it meant', async ({ page }) => {
  await page.goto('/setup');
  await page.locator('#sc-wiz-url').fill(`  http://${origin}/`);
  await page.getByRole('button', { name: 'Build the kit' }).click();

  // The kit is shown and held, not flashed past: this panel used to be set and
  // navigated away from in the same tick.
  await expect(page.locator('.sc-wiz-cap')).toHaveText('Your kit', { timeout: 30_000 });
  await expect(page).toHaveURL(/\/setup/);

  await page.getByRole('button', { name: 'Looks right' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/setup'), { timeout: 30_000 });
  await expect(page.locator('.sc-wiz-form')).toHaveCount(0);
});

test('a site with no shop on it is a brand source, and says what it found', async ({ page }) => {
  await page.goto('/setup');
  await page.locator('#sc-wiz-url').fill(`http://${origin}/`);
  await page.getByRole('button', { name: 'Build the kit' }).click();
  // The test above already made a brand from this host, and the duplicate
  // guard is doing its job. Say yes to it.
  const anyway = page.getByRole('button', { name: 'Create anyway' });
  if (await anyway.isVisible().catch(() => false)) await anyway.click();

  // What the site gave up, said line by line, and held until someone reads it.
  const lines = page.locator('.sc-kit-lines');
  await expect(lines).toBeVisible({ timeout: 30_000 });
  await expect(lines).toContainText('Lucid');
  await expect(lines).toContainText('Logo');
  await expect(lines).toContainText('Colours');
  // A brand needs no shop, and nothing here may suggest otherwise.
  await expect(page.locator('.sc-wiz')).not.toContainText(/product|shop|catalog/i);

  await page.getByRole('button', { name: 'Looks right' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/setup'), { timeout: 30_000 });

  // And no catalog crawl at all: this screen was asked for a brand kit. The
  // Products page is where someone asks for products, with the website already
  // filled in from the kit.
  const jobs = await page.evaluate(async () => {
    const brands = await (await fetch('/api/brands')).json();
    const rows = await Promise.all(
      brands.map(async (b: { id: string }) => (await (await fetch(`/api/brands/${b.id}/catalog/jobs`)).json()) ?? {}),
    );
    return rows.flatMap((r: { jobs?: unknown[] }) => r.jobs ?? []);
  });
  expect(jobs).toHaveLength(0);
});

test('a refusal is a sentence, and the manual path is still one click away', async ({ page }) => {
  await page.goto('/setup');
  await page.locator('#sc-wiz-url').fill('file:///etc/passwd');
  await page.getByRole('button', { name: 'Build the kit' }).click();

  const callout = page.locator('.sc-wiz-form').getByText(/http or https/);
  await expect(callout).toBeVisible();
  await expect(page.locator('.sc-wiz-form')).not.toContainText('Invalid URL');

  await page.getByRole('button', { name: 'Start from scratch instead' }).click();
  await expect(page.locator('#sc-wiz-name')).toBeVisible();
});

/**
 * The other half: a website that does have a shop on it.
 *
 * Shaped after gymshark.com as measured on 2026-09-13 - a Shopify store whose
 * CDN answers 403 to `/products.json` and to every `/products/<handle>.json`,
 * while serving the product pages themselves 200 with a full `ProductGroup` in
 * their JSON-LD. That combination imported nothing at all before this, and it
 * is the reason any of this exists.
 */
const SHOP_HANDLES = Array.from({ length: 30 }, (_, i) => `jacket-${i + 1}`);

let shop: Server;
let shopOrigin: string;

test.beforeAll(async () => {
  shop = createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0];
    const html = (body: string) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(body);
    };
    if (path === '/robots.txt') {
      res.writeHead(404, { 'content-type': 'text/plain' });
      return res.end('');
    }
    // The two doors this kind of store keeps shut.
    if (path === '/products.json' || /^\/products\/[^/]+\.json$/.test(path)) {
      res.writeHead(403, { 'content-type': 'text/html' });
      return res.end('<html>403</html>');
    }
    if (path === '/sitemap.xml') {
      res.writeHead(200, { 'content-type': 'application/xml' });
      return res.end(
        `<?xml version="1.0"?><sitemapindex><sitemap><loc>http://${shopOrigin}/sitemap_products_1.xml</loc></sitemap></sitemapindex>`,
      );
    }
    if (path.includes('sitemap_products')) {
      res.writeHead(200, { 'content-type': 'application/xml' });
      return res.end(
        `<?xml version="1.0"?><urlset>${SHOP_HANDLES.map(
          (h) => `<url><loc>http://${shopOrigin}/products/${h}</loc></url>`,
        ).join('')}</urlset>`,
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
      const n = SHOP_HANDLES.indexOf(handle) + 1;
      const group = {
        '@context': 'https://schema.org',
        '@type': 'ProductGroup',
        name: `Field Jacket ${n}`,
        url: `http://${shopOrigin}/products/${handle}`,
        brand: { '@type': 'Brand', name: 'Northwind' },
        category: 'Outerwear',
        image: [`http://${shopOrigin}/img/${handle}.png`],
        productGroupID: `pg-${n}`,
        variesBy: ['https://schema.org/size'],
        hasVariant: ['s', 'm', 'l'].map((size) => ({
          '@type': 'Product',
          name: `Field Jacket ${n}`,
          sku: `NW-${n}`,
          size,
          url: `http://${shopOrigin}/products/${handle}`,
          offers: { '@type': 'Offer', price: 120, priceCurrency: 'USD' },
        })),
      };
      return html(
        `<!doctype html><html lang="en"><head><title>Field Jacket ${n} | Northwind</title>
         <script type="application/ld+json">${JSON.stringify(group)}</script></head><body></body></html>`,
      );
    }
    html(
      `<!doctype html><html lang="en"><head><title>Northwind | Workwear</title>
       <meta name="description" content="Jackets built to last.">
       <style>:root{--brand-primary:#2f4858;--brand-accent:#c0703a}</style>
       <script src="https://cdn.shopify.com/s/files/x.js"></script></head>
       <body><header><img src="/img/logo.png" alt="Northwind logo" width="240" height="64"></header></body></html>`,
    );
  });
  await new Promise<void>((r) => shop.listen(0, '127.0.0.1', r));
  const address = shop.address();
  shopOrigin = `127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
});

test.afterAll(async () => {
  await new Promise<void>((r) => shop.close(() => r()));
});

test('a shop on the site is offered, counted, and imported only where asked', async ({ page }) => {
  await page.goto('/setup');
  await page.locator('#sc-wiz-url').fill(`http://${shopOrigin}/`);
  await page.getByRole('button', { name: 'Build the kit' }).click();
  // Every fixture in this file is on 127.0.0.1, so by now the duplicate guard
  // recognises the host from the tests above. Say yes to it.
  const anyway = page.getByRole('button', { name: 'Create anyway' });
  if (await anyway.isVisible().catch(() => false)) await anyway.click();

  // The brand lands first and is never held up by the search for a catalog.
  const lines = page.locator('.sc-kit-lines');
  await expect(lines).toBeVisible({ timeout: 30_000 });
  await expect(lines).toContainText('Logo');

  // Then the products line resolves on its own, with the whole catalog
  // counted rather than the handful that were read.
  await expect(lines).toContainText('30 found', { timeout: 45_000 });

  // The products step is the main button, not a link beside it: the first
  // version said "Looks right", quietly meant "and no products", and was
  // walked straight past.
  await page.getByRole('button', { name: 'Add brand and products' }).click();
  const sheet = page.getByRole('dialog', { name: 'Products on your site' });
  await expect(sheet).toBeVisible();

  // Everything is ticked, including the ones no card has loaded for yet.
  await expect(sheet.getByRole('button', { name: `Import ${SHOP_HANDLES.length} products` })).toBeVisible();
  const cards = sheet.locator('.sc-lookcard');
  const shown = await cards.count();
  expect(shown).toBeGreaterThan(2);
  expect(shown).toBeLessThan(SHOP_HANDLES.length);

  // Search reaches a product that is not on screen, by the name its address
  // already carries.
  await sheet.getByRole('searchbox').fill('jacket-29');
  await expect(cards).toHaveCount(1);
  await sheet.getByRole('searchbox').fill('');
  await expect(sheet.getByRole('button', { name: `Import ${SHOP_HANDLES.length} products` })).toBeVisible();

  // Drop two and the button counts down with them.
  await cards.nth(0).click();
  await cards.nth(1).click();
  await expect(sheet.getByRole('button', { name: `Import ${SHOP_HANDLES.length - 2} products` })).toBeVisible();

  await sheet.getByRole('button', { name: /^Import / }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/setup'), { timeout: 30_000 });

  // And exactly those products exist, with their pictures kept locally.
  await expect
    .poll(
      async () =>
        page.evaluate(async () => {
          const brands = await (await fetch('/api/brands')).json();
          const last = brands[brands.length - 1];
          const lib = await (await fetch(`/api/brands/${last.id}/products-library`)).json();
          return lib.products.length;
        }),
      { timeout: 60_000 },
    )
    .toBe(SHOP_HANDLES.length - 2);
});
