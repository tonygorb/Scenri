import { test, expect, type Page } from '@playwright/test';
import { isolate } from './harness.js';

/**
 * One slot of four fails; the other three are pictures and stay pictures.
 * A separate Scenri because the failing slot is a property of the engine
 * the file boots, not of one request.
 */
isolate({ env: { SCENRI_DEMO_STAGGER_MS: '300', SCENRI_DEMO_FAIL_SLOT: '1' } });

test.beforeEach(async ({ page }, testInfo) => {
  await page.bringToFront();
  testInfo.setTimeout(60_000);
});

const line = (p: Page) => p.locator('.sc-brief-line').first();
const dock = (p: Page) => p.locator('.sc-canvas-dock').first();
const tile = (p: Page, id: string) => p.locator(`.sc-cell[data-fb-node="${id}"]`);

test('a failed slot fails alone, and the shots that landed are usable', async ({ page }) => {
  const brands = await (await page.request.get('/api/brands')).json();
  const slug = brands[0].slug as string;
  await page.goto(`/${slug}/create`);
  await page.evaluate(() => localStorage.setItem('scenri:count', '4'));
  await page.goto(`/${slug}/create`);
  await expect(line(page)).toBeVisible();

  const answered = page.waitForResponse((r) => r.url().endsWith('/api/nodes') && r.request().method() === 'POST');
  await line(page).click();
  await page.keyboard.type('one of these will not make it');
  await dock(page).locator('.sc-send').click();
  const ids = ((await (await answered).json()).siblings as { id: string }[]).map((s) => s.id);
  expect(ids).toHaveLength(4);

  await expect(page.locator('.sc-cell[data-running]')).toHaveCount(0, { timeout: 30_000 });
  for (const i of [0, 2, 3]) await expect(tile(page, ids[i]).locator('img')).toBeVisible();
  await expect(tile(page, ids[1])).toHaveAttribute('data-failed', /.+/);
  await expect(page.locator('.sc-cell[data-failed]')).toHaveCount(1);

  // a landed sibling opens like any finished shot
  await tile(page, ids[0]).locator('.sc-cell-open').click();
  await expect(page.locator('.sc-ovl')).toBeVisible();
});
