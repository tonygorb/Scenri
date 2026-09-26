import { test, expect, type Page } from '@playwright/test';
import { isolate } from './harness.js';

/**
 * Waiting that ends in failure: the picture that was being refined stays on
 * the stage, the step that failed says so beside it and can be tried again,
 * and a sibling that fails keeps the place it rendered in, so the batch around
 * it never moves.
 */
isolate({ env: { SCENRI_DEMO_DELAY_MS: '2500', SCENRI_DEMO_FAIL_EDIT: '1', SCENRI_DEMO_FAIL_SLOT: '1' } });

test.beforeEach(async ({ page }, testInfo) => {
  await page.bringToFront();
  testInfo.setTimeout(60_000);
});

const line = (p: Page) => p.locator('.sc-brief-line').first();
const dock = (p: Page) => p.locator('.sc-canvas-dock').first();
const tile = (p: Page, id: string) => p.locator(`.sc-cell[data-fb-node="${id}"]`);

async function brandSlug(p: Page): Promise<string> {
  const brands = await (await p.request.get('/api/brands')).json();
  return brands[0].slug as string;
}

test('a refinement that fails leaves the shot on the stage and a way to try again beside it', async ({ page }) => {
  const slug = await brandSlug(page);
  const brand = (await (await page.request.get('/api/brands')).json())[0];
  const feed = await (await page.request.get(`/api/brands/${brand.id}/feed?limit=60`)).json();
  const parent = (feed.items as { id: string; status: string; images: string[] }[]).find(
    (n) => n.status === 'done' && n.images.length,
  );
  if (!parent) throw new Error('no finished shot to refine');
  await page.goto(`/${slug}/create/shots/${parent.id}`);
  await expect(page.locator('.sc-ovl-stage .sc-stage-img')).toBeVisible();

  const answered = page.waitForResponse((r) => r.url().endsWith('/api/nodes') && r.request().method() === 'POST');
  await page.locator('.sc-ovl-edit .sc-brief-line').click();
  await page.keyboard.type('bluer shadows');
  await page.locator('.sc-ovl-edit .sc-send').click();
  const child = (await (await answered).json()).id as string;

  // the failure arrives as a tile beside the shot, and the shot never leaves
  const failed = page.locator('.sc-trail .sc-thumb-failed');
  await expect(failed).toBeVisible({ timeout: 20_000 });
  await expect(page).toHaveURL(new RegExp(`/shots/${parent.id}`));
  await expect(page.locator('.sc-ovl-stage .sc-stage-img')).toHaveAttribute('src', new RegExp(parent.images[0]));
  const failedTile = page.locator('.sc-trail-tile:has(.sc-thumb-failed)');
  await expect(failedTile).toHaveAttribute('aria-label', /Did not finish/);
  // nothing still pretends to be rendering, and the field is free again
  await expect(page.locator('.sc-ovl-stage .sc-rendering')).toHaveCount(0);
  await expect(page.locator('.sc-ovl-edit .sc-send')).not.toHaveAttribute('title', /Wait for this refinement/);

  // opening the failed step shows why, with Try again
  await failedTile.click();
  await expect(page).toHaveURL(new RegExp(`/shots/${child}`));
  await expect(page.locator('.sc-ovl-stage .sc-fail')).toBeVisible();
  await expect(page.locator('.sc-ovl-stage').getByRole('button', { name: /Try again/ })).toBeVisible();
});

test('a sibling that fails keeps the place it rendered in, and the batch does not move', async ({ page }) => {
  const slug = await brandSlug(page);
  await page.goto(`/${slug}/create`);
  await page.evaluate(() => {
    localStorage.setItem('scenri:count', '3');
    localStorage.setItem('scenri:format', JSON.stringify('square'));
  });
  await page.goto(`/${slug}/create`);
  await expect(line(page)).toBeVisible();
  const answered = page.waitForResponse((r) => r.url().endsWith('/api/nodes') && r.request().method() === 'POST');
  await line(page).click();
  await page.keyboard.type('three squares, one fails');
  await dock(page).locator('.sc-send').click();
  const ids = ((await (await answered).json()).siblings as { id: string }[]).map((s) => s.id);
  expect(ids).toHaveLength(3);
  for (const id of ids) await expect(tile(page, id)).toBeVisible();
  const held = await Promise.all(ids.map((id) => tile(page, id).boundingBox()));

  await expect(tile(page, ids[1])).toHaveAttribute('data-failed', 'true', { timeout: 20_000 });
  for (const id of [ids[0], ids[2]])
    await expect(tile(page, id).locator('.sc-cellimg')).toBeVisible({ timeout: 20_000 });
  const after = await Promise.all(ids.map((id) => tile(page, id).boundingBox()));
  for (let i = 0; i < ids.length; i++) {
    expect(Math.abs((after[i]?.height ?? 0) - (held[i]?.height ?? 0))).toBeLessThanOrEqual(2);
    expect(Math.abs((after[i]?.y ?? 0) - (held[i]?.y ?? 0))).toBeLessThanOrEqual(2);
  }
  // the failure is quiet on its tile: the screen's one live region says it, not an alert per tile
  await expect(tile(page, ids[1]).locator('[role="alert"]')).toHaveCount(0);
});
