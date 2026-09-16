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
const SHOP_HANDLES = Array.from({ length: 60 }, (_, i) => `jacket-${i + 1}`);

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
  await expect(lines).toContainText('60 found', { timeout: 45_000 });

  // The products step is the main button, not a link beside it: the first
  // version said "Looks right", quietly meant "and no products", and was
  // walked straight past.
  await page.getByRole('button', { name: 'Add brand and products' }).click();
  const sheet = page.getByRole('dialog', { name: 'Products on your site' });
  await expect(sheet).toBeVisible();

  // Everything is ticked, including the ones no card has loaded for yet.
  await expect(sheet.getByRole('button', { name: `Import ${SHOP_HANDLES.length} products` })).toBeVisible();

  // Every card ON SCREEN ends up with its picture, and the screen stops saying
  // it is working. Not every card that exists: a picture is one page read of
  // somebody's live shop, so they are paid for by what a person actually
  // scrolled to, and cards below the fold are card-shaped until they are
  // reached. The first version read for every card that had ever rendered and
  // held the next page of cards back until all of them landed, which paced
  // appearing - which is free - by fetching, which is not.
  //
  // It also leaked its in-flight count - the effect's own cleanup cancelled
  // the requests that same render had started - so one card shimmered for good
  // under a "Loading products" that never went away.
  const picturedInView = async () =>
    sheet.locator('.sc-wizpick-grid').evaluate((g) => {
      const gr = g.getBoundingClientRect();
      const inView = [...g.querySelectorAll('.sc-lookcard')].filter((c) => {
        const r = c.getBoundingClientRect();
        return r.bottom > gr.top + 4 && r.top < gr.bottom - 4;
      });
      return { inView: inView.length, withPicture: inView.filter((c) => c.querySelector('img')).length };
    });
  await expect(sheet.locator('.sc-wizpick-loading')).toHaveCount(0, { timeout: 30_000 });
  await expect
    .poll(
      async () => {
        const { inView, withPicture } = await picturedInView();
        return inView > 0 && withPicture === inView;
      },
      { timeout: 30_000 },
    )
    .toBe(true);
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

  // Scrolling asks for more, and only once the last lot has landed: a flick
  // to the bottom of a 2,200-product store queued 240 page reads at once.
  const grid = sheet.locator('.sc-wizpick-grid');
  const firstScreen = await cards.count();
  for (let i = 0; i < 3; i++) {
    await grid.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await page.waitForTimeout(400);
  }
  await expect(sheet.locator('.sc-wizpick-loading')).toHaveCount(0, { timeout: 30_000 });
  expect(await cards.count()).toBeGreaterThan(firstScreen);
  // And the cards scrolling brought into view got their pictures too.
  await expect
    .poll(
      async () => {
        const { inView, withPicture } = await picturedInView();
        return inView > 0 && withPicture === inView;
      },
      { timeout: 30_000 },
    )
    .toBe(true);

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

/**
 * The regression this whole pass exists for.
 *
 * A tester pasted a real Shopify store, watched it search for several minutes,
 * and then watched the Products row disappear and "Looks right" light up. No
 * products were imported and nothing said why. The scan had failed, and a
 * failed scan reached the screen as `null` - exactly what a site with no shop
 * looks like - so the screen drew the row for a portfolio: it removed it.
 *
 * A failure has to be visible, and it has to be retryable.
 */
test('a scan that fails says so, and offers another go', async ({ page }) => {
  // The server's own answer, replaced with the one it gives when a look could
  // not be finished. Everything else on the screen is real.
  await page.route('**/catalog/scans/**', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ id: 'x', brandId: 'x', url: 'x', status: 'error', error: 'boom', startedAt: Date.now() }),
    });
  });

  await page.goto('/setup');
  await page.locator('#sc-wiz-url').fill(`http://${origin}/`);
  await page.getByRole('button', { name: 'Build the kit' }).click();
  const anyway = page.getByRole('button', { name: 'Create anyway' });
  if (await anyway.isVisible().catch(() => false)) await anyway.click();

  const lines = page.locator('.sc-kit-lines');
  await expect(lines).toBeVisible({ timeout: 30_000 });

  // Waited for first, and deliberately. While the look is still running the
  // row already reads "Products / looking for a shop", so asserting on the
  // word alone passes against the in-flight row and proves nothing. This
  // button appears only once the scan has settled and settled badly.
  await expect(page.getByRole('button', { name: /Look for products again/i })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'Continue without products' })).toBeVisible();
  // "Looks right" over a shop we never managed to read is the sentence that
  // made this a silent failure.
  await expect(page.getByRole('button', { name: 'Looks right' })).toHaveCount(0);

  // And now the row: still there, having survived the failure. This is what
  // the old code could not do - it removed the line entirely.
  await expect(lines).toContainText('Products');
  await expect(lines).not.toContainText(/\bno products\b|\b0 products\b/i);
  await expect(page.locator('.sc-wiz')).not.toContainText(/boom|HTTP|undefined|null/);

  // The quieter option still works.
  await page.getByRole('button', { name: 'Continue without products' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/setup'), { timeout: 30_000 });
});

/**
 * The 2026-09-16 report: a pasted store answered "asked Scenri to slow down"
 * and nothing was created.
 *
 * The scrape reads a homepage, its stylesheets and its logo - and only the
 * homepage was fatal. A site that refused everything *after* it produced a
 * perfectly good kit; a site that refused the first byte produced a red box
 * and no brand at all. A refusal is not an absence: the address is real and
 * the person typed it on purpose, so the brand is made from the address and
 * the two missing fields are named.
 */
test('a site that answers and refuses still becomes a brand', async ({ page }) => {
  // The look for a shop runs its own budget against the same refusing host,
  // and now waits out the cooldown the scrape armed. Bounded, but longer than
  // the file's default.
  test.setTimeout(120_000);
  const busy = createServer((_req, res) => {
    // No Retry-After and a plain body: a rate limit, not a challenge.
    res.writeHead(429, { 'content-type': 'text/plain' });
    res.end('slow down');
  });
  await new Promise<void>((r) => busy.listen(0, '127.0.0.1', r));
  const port = (() => {
    const a = busy.address();
    return typeof a === 'object' && a ? a.port : 0;
  })();

  try {
    await page.goto('/setup');
    await page.locator('#sc-wiz-url').fill(`http://127.0.0.1:${port}/`);
    await page.getByRole('button', { name: 'Build the kit' }).click();
    const anyway = page.getByRole('button', { name: 'Create anyway' });
    if (await anyway.isVisible().catch(() => false)) await anyway.click();

    // A kit exists. This is the assertion the old behaviour could not pass.
    const lines = page.locator('.sc-kit-lines');
    await expect(lines).toBeVisible({ timeout: 30_000 });
    await expect(lines).toContainText('Name');
    await expect(lines).toContainText('127.0.0.1');

    // It is honestly empty rather than wrong.
    await expect(lines).toContainText('none found');

    // And it says why, quietly, without a status code.
    const note = page.locator('.sc-kit-note');
    await expect(note).toBeVisible();
    await expect(note).toContainText(/slow down|would not let Scenri read it/i);
    // And what to do about it: a refusal that only says "try again" reads as a
    // failure, and this stopped being one the moment a brand was created.
    await expect(note).toContainText(/Settings/);
    await expect(page.locator('.sc-wiz')).not.toContainText(/429|undefined|null|ScrapeError/);

    // Not an error: nothing red, and the way forward is the normal one.
    await expect(page.locator('.rt-CalloutRoot')).toHaveCount(0);

    // The look for a shop runs against the same refusing host, and now waits
    // out the cooldown the scrape armed, so this settles rather than racing.
    // Any of the three terminal buttons is a pass; "Looking for products" is
    // not one of them.
    const onward = page.getByRole('button', {
      name: /^(Looks right|Look for products again|Add brand and products)/,
    });
    await expect(onward).toBeVisible({ timeout: 60_000 });
    await onward.click();
    await page.waitForURL((u) => !u.pathname.startsWith('/setup'), { timeout: 30_000 });
  } finally {
    await new Promise<void>((r) => busy.close(() => r()));
  }
});

/**
 * What a person using a keyboard and a screen reader gets.
 *
 * Nothing in this flow was announced. You pasted an address, pressed a button
 * and heard silence: the kit rows appeared, the shop was counted or not, and a
 * refusal explained itself, all of it invisible unless you could see it.
 *
 * Concise on purpose. The three brand rows land together and the products row
 * resolves once, so this is a handful of announcements for a whole onboarding,
 * not one per product.
 */
test('the kit says what it found, out loud, and the whole step is reachable by keyboard', async ({ page }) => {
  await page.goto('/setup');

  // Reachable without a mouse, and submits on Enter.
  await page.locator('#sc-wiz-url').focus();
  await expect(page.locator('#sc-wiz-url')).toBeFocused();
  await page.keyboard.type(`http://${origin}/`);
  await page.keyboard.press('Enter');

  const anyway = page.getByRole('button', { name: 'Create anyway' });
  if (await anyway.isVisible().catch(() => false)) await anyway.click();

  // The result is in a live region, so it is spoken rather than merely drawn.
  const lines = page.locator('.sc-kit-lines');
  await expect(lines).toBeVisible({ timeout: 30_000 });
  await expect(lines).toHaveAttribute('role', 'status');
  await expect(lines).toContainText('Lucid');

  // And the way onward is a real button a keyboard can reach.
  const onward = page.getByRole('button', { name: /Looks right|Add brand and products|Look for products again/ });
  await expect(onward).toBeVisible({ timeout: 45_000 });
  await onward.focus();
  await expect(onward).toBeFocused();
});
