import { test, expect, type Page } from '@playwright/test';
import { isolate } from './harness.js';

/**
 * Archiving a shot and toggling the assets rail used to remount every visible
 * tile and replay the image fade: the feed stayed populated (no first-load
 * swap) but unrelated pictures went to opacity 0 for a painted frame. These
 * pin the causes — stable neighbors, no pending stand-ins, no route reload,
 * the rail one `data-assets` flip — rather than screenshot timing.
 */
isolate();
test.describe.configure({ mode: 'serial' });

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
const stampWork = (p: Page) =>
  p.locator('.sc-work').evaluate((el) => {
    const id = el.getAttribute('data-stab') || `s${Math.random().toString(16).slice(2)}`;
    el.setAttribute('data-stab', id);
    return id;
  });

let brand = { id: '', slug: '' };
const cells = (p: Page) => p.locator('.sc-cell[data-fb-node]');
const tile = (p: Page, id: string) => p.locator(`.sc-cell[data-fb-node="${id}"]`);
const feedIds = async (p: Page) =>
  ((await api(p, `/api/brands/${brand.id}/feed?limit=20`)) as { items: { id: string }[] }).items.map((n) => n.id);

test('a handful of demo shots land so the feed has neighbors', async ({ page }, testInfo) => {
  testInfo.setTimeout(60_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.waitForURL((u) => {
    const seg = u.pathname.split('/').filter(Boolean);
    return seg.length === 1 && seg[0] !== 'setup';
  });
  const slug = decodeURIComponent(new URL(page.url()).pathname.split('/')[1]);
  const brands = (await api(page, '/api/brands')) as { id: string; slug: string }[];
  brand = brands.find((b) => b.slug === slug) ?? { id: '', slug };
  const ws = (await api(page, `/api/brands/${brand.id}/workspace`)) as { project: { id: string }; root: string };
  const made = (await api(
    page,
    '/api/nodes',
    postJson({
      projectId: ws.project.id,
      parentId: ws.root,
      kind: 'generation',
      prompt: 'stability feed',
      engineId: 'demo',
      count: 8,
    }),
  )) as { siblings?: unknown[] };
  expect(made.siblings, JSON.stringify(made)).toHaveLength(8);
  await expect
    .poll(async () => {
      const feed = (await api(page, `/api/brands/${brand.id}/feed?limit=20`)) as {
        items: { status: string }[];
        counts: { all: number };
      };
      if (feed.counts.all < 8 || feed.items.some((n) => n.status !== 'done')) return 0;
      return feed.counts.all;
    })
    .toBeGreaterThanOrEqual(8);
});

test('archiving a shot leaves the route, the neighbor, and no first-load stand-ins', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/${brand.slug}/create`);
  await expect(cells(page).first()).toBeVisible();
  const ids = await feedIds(page);
  const gone = ids[0];
  const stay = ids[1];
  expect(stay).toBeTruthy();
  const stamp = await stampWork(page);
  const scrollBefore = await page.locator('.sc-canvas').evaluate((el) => el.scrollTop);
  const feedHits: string[] = [];
  page.on('request', (req) => {
    if (req.url().includes('/feed')) feedHits.push(req.url());
  });

  await tile(page, gone).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Archive' }).click();
  await expect(tile(page, gone)).toHaveCount(0);

  await expect(tile(page, stay)).toBeVisible();
  await expect(tile(page, stay).locator('.sc-cellimg[data-loaded]')).toBeVisible();
  await expect(page.locator('.sc-cell[data-sending="true"]')).toHaveCount(0);
  expect(new URL(page.url()).pathname).toBe(`/${brand.slug}/create`);
  await expect(page.locator('.sc-work')).toHaveAttribute('data-stab', stamp);
  const scrollAfter = await page.locator('.sc-canvas').evaluate((el) => el.scrollTop);
  expect(Math.abs(scrollAfter - scrollBefore)).toBeLessThanOrEqual(8);
  expect(feedHits.filter((u) => !u.includes('cursor=')).length).toBe(0);
});

test('toggling the assets rail is one data-assets flip, not a remount of Create', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/${brand.slug}/create`);
  await expect(page.locator('.sc-work[data-assets="true"]')).toBeVisible();
  await expect(cells(page).first()).toBeVisible();
  const stay = (await feedIds(page))[0];
  const stamp = await stampWork(page);
  const scrollBefore = await page.locator('.sc-canvas').evaluate((el) => el.scrollTop);

  await page.getByRole('button', { name: 'Assets panel' }).click();
  await expect(page.locator('.sc-work[data-assets="false"]')).toBeVisible();
  await expect(tile(page, stay)).toBeVisible();
  await expect(tile(page, stay).locator('.sc-cellimg[data-loaded]')).toBeVisible();
  await expect(page.locator('.sc-cell[data-sending="true"]')).toHaveCount(0);
  await expect(page.locator('.sc-work')).toHaveAttribute('data-stab', stamp);
  expect(new URL(page.url()).pathname).toBe(`/${brand.slug}/create`);

  await page.getByRole('button', { name: 'Assets panel' }).click();
  await expect(page.locator('.sc-work[data-assets="true"]')).toBeVisible();
  await expect(tile(page, stay)).toBeVisible();
  const scrollAfter = await page.locator('.sc-canvas').evaluate((el) => el.scrollTop);
  expect(Math.abs(scrollAfter - scrollBefore)).toBeLessThanOrEqual(8);
});
