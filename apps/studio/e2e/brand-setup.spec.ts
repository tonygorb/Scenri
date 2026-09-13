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
