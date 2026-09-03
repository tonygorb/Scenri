import { test, expect, type Page } from '@playwright/test';
import { isolate } from './harness.js';

/**
 * A feed of two hundred shots mounts what the reader can reach: a band of
 * tiles around the viewport, the rest held as spacers, the next page brought
 * in as the reader nears the end. Every verb a tile offers works on a tile
 * deep in that feed, and the lenses count from the server.
 */
isolate();
test.describe.configure({ mode: 'serial' });

const TOTAL = 200;

const api = async (p: Page, path: string, init?: RequestInit) =>
  p.evaluate(
    async ([u, i]) => {
      const r = await fetch(u as string, i as RequestInit);
      return r.json();
    },
    [path, init ?? undefined],
  );
const postJson = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

let brand = { id: '', slug: '' };
/** What the brand holds once the seed has landed: the harness may have seeded a shot of its own. */
let total = 0;
const cells = (p: Page) => p.locator('.sc-cell[data-fb-node]');
const tile = (p: Page, id: string) => p.locator(`.sc-cell[data-fb-node="${id}"]`);
const scrollToEnd = (p: Page) =>
  p.locator('.sc-canvas').evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
const feedIds = async (p: Page, q: string) =>
  (((await api(p, `/api/brands/${brand.id}/feed?${q}`)) as any).items as { id: string }[]).map((n) => n.id);

test('two hundred demo shots land', async ({ page }, testInfo) => {
  testInfo.setTimeout(180_000);
  await page.goto('/');
  await page.waitForURL((u) => {
    const seg = u.pathname.split('/').filter(Boolean);
    return seg.length === 1 && seg[0] !== 'setup';
  });
  const slug = decodeURIComponent(new URL(page.url()).pathname.split('/')[1]);
  const brands = (await api(page, '/api/brands')) as any[];
  brand = { id: brands.find((b) => b.slug === slug).id, slug };
  const ws = (await api(page, `/api/brands/${brand.id}/workspace`)) as any;
  for (let made = 0; made < TOTAL; made += 4) {
    const r = (await api(
      page,
      '/api/nodes',
      postJson({
        projectId: ws.project.id,
        parentId: ws.root,
        kind: 'generation',
        prompt: `window shot ${made}`,
        engineId: 'demo',
        count: 4,
      }),
    )) as any;
    expect(r.siblings, JSON.stringify(r)).toHaveLength(4);
  }
  await expect
    .poll(
      async () => {
        const feed = (await api(page, `/api/brands/${brand.id}/feed?limit=200`)) as any;
        if (feed.counts.total < TOTAL || feed.items.some((n: any) => n.status !== 'done')) return 0;
        total = feed.counts.total;
        return total;
      },
      { timeout: 150_000 },
    )
    .toBeGreaterThanOrEqual(TOTAL);
});

test('a large feed mounts a band of tiles, newest first, and holds the rest as spacers', async ({ page }) => {
  await page.goto(`/${brand.slug}/create`);
  await expect(cells(page).first()).toBeVisible();
  const mounted = await cells(page).count();
  expect(mounted).toBeGreaterThan(3);
  expect(mounted).toBeLessThan(60);
  await expect(page.locator('.sc-feed-pad').first()).toBeAttached();
  // the deal: the newest three read across the top row
  const cols = page.locator('.sc-feed-col');
  const n = await cols.count();
  expect(n).toBeGreaterThan(1);
  const newest = await feedIds(page, `limit=${n}`);
  for (let c = 0; c < n; c++) {
    await expect(cols.nth(c).locator('.sc-cell').first()).toHaveAttribute('data-fb-node', newest[c]);
  }
  // the lens counts come from the server, not from what is mounted
  await expect(page.getByRole('tab', { name: /^All/ })).toContainText(String(total));
});

test('scrolling to the end pages the oldest shots in and lets go of the newest', async ({ page }) => {
  await page.goto(`/${brand.slug}/create`);
  await expect(cells(page).first()).toBeVisible();
  const [newest] = await feedIds(page, 'limit=1');
  const [oldest] = await feedIds(page, 'sort=oldest&limit=1');
  for (let i = 0; i < 40 && (await tile(page, oldest).count()) === 0; i++) {
    await scrollToEnd(page);
    await page.waitForTimeout(250);
  }
  await expect(tile(page, oldest)).toBeAttached();
  await expect(tile(page, newest)).toHaveCount(0);
  expect(await cells(page).count()).toBeLessThan(90);
});

test('a tile deep in the feed opens, and every verb works on it', async ({ page }) => {
  await page.goto(`/${brand.slug}/create`);
  await expect(cells(page).first()).toBeVisible();
  const [oldest] = await feedIds(page, 'sort=oldest&limit=1');
  for (let i = 0; i < 40 && (await tile(page, oldest).count()) === 0; i++) {
    await scrollToEnd(page);
    await page.waitForTimeout(250);
  }
  const deep = tile(page, oldest);
  await deep.scrollIntoViewIfNeeded();
  await deep.locator('.sc-cell-open').click();
  await expect(page.locator('.sc-ovl')).toBeVisible();
  expect(new URL(page.url()).pathname).toContain(oldest);
  await page.keyboard.press('Escape');
  await expect(page.locator('.sc-ovl')).toHaveCount(0);
  await expect(deep).toBeAttached();

  // keep: the star paints, the record says so
  await deep.scrollIntoViewIfNeeded();
  await deep.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Keep' }).click();
  await expect(deep.locator('.sc-cell-star')).toBeVisible();
  await expect.poll(async () => ((await api(page, `/api/nodes/${oldest}`)) as any).kept).toBe(true);
  await expect(page.getByRole('tab', { name: /^Keepers/ })).toContainText('1');

  // archive: it leaves this lens and waits in the archived one
  await deep.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Archive' }).click();
  await expect(deep).toHaveCount(0);
  await page.getByRole('tab', { name: /^Archived/ }).click();
  await expect(deep).toBeVisible();

  // restore: it leaves the archived lens again
  await deep.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Restore' }).click();
  await expect(deep).toHaveCount(0);
  await expect.poll(async () => ((await api(page, `/api/nodes/${oldest}`)) as any).archived).toBe(false);
});

test('an archived shot can be deleted for good from the archived lens', async ({ page }) => {
  await page.goto(`/${brand.slug}/create`);
  await expect(cells(page).first()).toBeVisible();
  const [newest] = await feedIds(page, 'limit=1');
  const top = tile(page, newest);
  await top.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Archive' }).click();
  await expect(top).toHaveCount(0);
  await page.getByRole('tab', { name: /^Archived/ }).click();
  await expect(top).toBeVisible();
  await top.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Delete permanently' }).click();
  await page.getByRole('button', { name: 'Delete permanently' }).click();
  await expect(top).toHaveCount(0);
  await expect.poll(async () => ((await api(page, `/api/nodes/${newest}`)) as any).error).toBeTruthy();
  await page.getByRole('tab', { name: /^All/ }).click();
  await expect(page.getByRole('tab', { name: /^All/ })).toContainText(String(total - 1));
});
