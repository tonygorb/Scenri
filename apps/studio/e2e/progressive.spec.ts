import { test, expect, type Page } from '@playwright/test';
import { isolate } from './harness.js';

/**
 * A four-shot request shows each shot as it finishes.
 *
 * The demo engine is told to take its time and to land the LAST slot first,
 * which is the case the feed has to survive: a picture arriving out of order
 * fills its own held space and moves nothing.
 */
isolate({ env: { SCENRI_DEMO_STAGGER_MS: '3000', SCENRI_DEMO_ORDER: 'reverse' } });

// A staggered batch takes nine seconds to land on its own; the default budget
// of twenty leaves nothing for the walk to and from it on a loaded machine.
test.beforeEach(async ({ page }, testInfo) => {
  await page.bringToFront();
  testInfo.setTimeout(60_000);
});

const line = (p: Page) => p.locator('.sc-brief-line').first();
const dock = (p: Page) => p.locator('.sc-canvas-dock').first();
const tile = (p: Page, id: string) => p.locator(`.sc-cell[data-fb-node="${id}"]`);
const picture = (p: Page, id: string) => tile(p, id).locator('img');
const stillRunning = async (p: Page, id: string) =>
  (await (await p.request.get(`/api/nodes/${id}`)).json()).status === 'running';

async function brandSlug(p: Page): Promise<string> {
  const brands = await (await p.request.get('/api/brands')).json();
  return brands[0].slug as string;
}

/** Stand on the feed with the count set to four. */
async function openFeed(p: Page, slug: string, count = 4) {
  await p.goto(`/${slug}/create`);
  await p.evaluate((c) => localStorage.setItem('scenri:count', String(c)), count);
  await p.goto(`/${slug}/create`);
  await expect(line(p)).toBeVisible();
}

/** Send from the composer; answer with the batch's ids in slot order. */
async function send(p: Page, said: string): Promise<string[]> {
  const answered = p.waitForResponse((r) => r.url().endsWith('/api/nodes') && r.request().method() === 'POST');
  await line(p).click();
  await p.keyboard.type(said);
  await dock(p).locator('.sc-send').click();
  const body = await (await answered).json();
  return (body.siblings as { id: string }[]).map((s) => s.id);
}

const boxes = (p: Page, ids: string[]) =>
  p.evaluate(
    (list) =>
      list.map((id) => {
        const b = document.querySelector(`.sc-cell[data-fb-node="${id}"]`)?.getBoundingClientRect();
        return b ? [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)] : null;
      }),
    ids,
  );

test('the first finished shot shows while its siblings still render, and nothing moves', async ({ page }) => {
  const slug = await brandSlug(page);
  await openFeed(page, slug);
  const ids = await send(page, 'four shots, last one first');
  expect(ids).toHaveLength(4);

  // four held spaces, then the last slot's picture, alone
  for (const id of ids) await expect(tile(page, id)).toBeVisible();
  const held = await boxes(page, ids);
  await expect(picture(page, ids[3])).toBeVisible({ timeout: 20_000 });
  // the last slot is a picture while the first has not even landed
  expect(await stillRunning(page, ids[0])).toBe(true);
  expect(await page.locator('.sc-cell[data-running]').count()).toBeGreaterThanOrEqual(1);
  await expect(picture(page, ids[0])).toHaveCount(0);

  // then the rest, each in the space held for it
  await expect(page.locator('.sc-cell[data-running]')).toHaveCount(0, { timeout: 30_000 });
  for (const id of ids) await expect(picture(page, id)).toBeVisible();
  expect(await boxes(page, ids)).toEqual(held);

  // and the batch still reads in request order, whatever order it landed in
  const order = (await boxes(page, ids))
    .map((b, i) => ({ i, y: b?.[1] ?? 0, x: b?.[0] ?? 0 }))
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .map((o) => o.i);
  expect(order).toEqual([0, 1, 2, 3]);
});

test('a finished shot opens and refines before its siblings land', async ({ page }) => {
  const slug = await brandSlug(page);
  await openFeed(page, slug);
  const ids = await send(page, 'refine the first to land');
  await expect(picture(page, ids[3])).toBeVisible({ timeout: 20_000 });

  await tile(page, ids[3]).locator('.sc-cell-open').click();
  await expect(page.locator('.sc-ovl')).toBeVisible();
  const refined = page.waitForResponse((r) => r.url().endsWith('/api/nodes') && r.request().method() === 'POST');
  await page.locator('.sc-ovl .sc-brief-line').first().click();
  await page.keyboard.type('warmer');
  await page.locator('.sc-ovl .sc-send').click();
  const child = await (await refined).json();
  expect(child.parentId).toBe(ids[3]);

  // the batch it came from is untouched and still lands, every sibling
  await page.keyboard.press('Escape');
  await expect(page.locator('.sc-cell[data-running]')).toHaveCount(0, { timeout: 30_000 });
  for (const id of ids) await expect(picture(page, id)).toBeVisible();
  const node = await (await page.request.get(`/api/nodes/${child.id}`)).json();
  expect(node.parentId).toBe(ids[3]);
});

test('walking away and coming back keeps what landed and what is still coming', async ({ page }) => {
  const slug = await brandSlug(page);
  await openFeed(page, slug);
  const ids = await send(page, 'landing while you are elsewhere');
  await expect(picture(page, ids[3])).toBeVisible({ timeout: 20_000 });

  await page.locator('.sc-nav a', { hasText: 'Scenes' }).click();
  await page.waitForURL(/\/scenes$/);
  await page.goto(`/${slug}/create`);
  for (const id of ids) await expect(tile(page, id)).toBeVisible();
  await expect(page.locator('.sc-cell[data-running]')).toHaveCount(0, { timeout: 30_000 });
  for (const id of ids) await expect(picture(page, id)).toBeVisible();
});

test('landing shots never refetch the workspace', async ({ page }) => {
  const slug = await brandSlug(page);
  await openFeed(page, slug);
  const ids = await send(page, 'counted, not refetched');
  await expect(picture(page, ids[3])).toBeVisible({ timeout: 20_000 });

  let workspaceReads = 0;
  page.on('request', (r) => {
    if (r.url().includes('/workspace')) workspaceReads += 1;
  });
  await expect(page.locator('.sc-cell[data-running]')).toHaveCount(0, { timeout: 30_000 });
  for (const id of ids) await expect(picture(page, id)).toBeVisible();
  expect(workspaceReads).toBe(0);
});

test('cancelling after some shots landed keeps them and stops the rest', async ({ page }) => {
  const slug = await brandSlug(page);
  await openFeed(page, slug);
  const ids = await send(page, 'stop after two');
  await expect(picture(page, ids[3])).toBeVisible({ timeout: 20_000 });
  await expect(picture(page, ids[2])).toBeVisible({ timeout: 20_000 });

  await page.locator('.sc-cell[data-running] .sc-cell-cancel').first().click();
  await expect(page.locator('.sc-cell[data-running]')).toHaveCount(0, { timeout: 30_000 });
  await expect(picture(page, ids[3])).toBeVisible();
  await expect(picture(page, ids[2])).toBeVisible();
  const outcomes = await Promise.all(
    ids.map(async (id) => (await (await page.request.get(`/api/nodes/${id}`)).json()).status),
  );
  expect(outcomes.filter((s) => s === 'done').length).toBeGreaterThanOrEqual(2);
  expect(outcomes.filter((s) => s === 'cancelled').length).toBeGreaterThanOrEqual(1);
  expect(outcomes.every((s) => s === 'done' || s === 'cancelled')).toBe(true);
  await expect(page.locator('.sc-cell[data-cancelled]')).toHaveCount(outcomes.filter((s) => s === 'cancelled').length);
});

test('another brand never sees the batch, before or after it lands', async ({ page }) => {
  const slug = await brandSlug(page);
  const made = await page.request.post('/api/brands', {
    data: { brand: { specVersion: '0.1', meta: { name: 'Elsewhere' } } },
  });
  expect(made.ok(), await made.text()).toBe(true);
  const other = (await (await page.request.get('/api/brands')).json()).find(
    (b: { json?: { meta?: { name?: string } } }) => b.json?.meta?.name === 'Elsewhere',
  ).slug as string;

  await openFeed(page, slug);
  const ids = await send(page, 'stays in its own brand');
  await expect(picture(page, ids[3])).toBeVisible({ timeout: 20_000 });

  await page.goto(`/${other}/create`);
  await expect(line(page)).toBeVisible();
  // let the rest of the batch land while the other brand is on screen
  await expect
    .poll(async () => (await (await page.request.get(`/api/nodes/${ids[0]}`)).json()).status, { timeout: 30_000 })
    .toBe('done');
  await page.waitForTimeout(2_000);
  expect(await page.locator('.sc-cell[data-fb-node]').count()).toBe(0);

  await page.goto(`/${slug}/create`);
  for (const id of ids) await expect(picture(page, id)).toBeVisible();
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('shots land one by one in a single column that never scrolls sideways', async ({ page }) => {
    const slug = await brandSlug(page);
    await openFeed(page, slug);
    const ids = await send(page, 'four on a phone');
    for (const id of ids) await expect(tile(page, id)).toBeVisible();
    await expect(picture(page, ids[3])).toBeVisible({ timeout: 20_000 });
    expect(await stillRunning(page, ids[0])).toBe(true);
    expect(await page.locator('.sc-cell[data-running]').count()).toBeGreaterThanOrEqual(1);
    await expect(page.locator('.sc-cell[data-running]')).toHaveCount(0, { timeout: 30_000 });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
