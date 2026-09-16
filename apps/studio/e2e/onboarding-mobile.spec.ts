import { test, expect, type Page } from '@playwright/test';
import { isolate } from './harness.js';
import { learned, noWelcomeWait, setUpBrand, tourTitle, welcome } from './firstUse.js';

/**
 * Phone and tablet (this file runs in both projects): the ? where the corner is
 * free, the Home tour pointing at the Create link that is actually on screen,
 * and touch pointed at the + rather than a symbol a touch keyboard hides.
 */
isolate({ brand: false, env: { SCENRI_NO_GUIDE: '0' } });
test.beforeEach(({ page }) => noWelcomeWait(page));

const wide = (p: Page) => (p.viewportSize()?.width ?? 0) >= 1024;

test('the ? and the tours follow the controls this screen has', async ({ page }) => {
  const slug = await setUpBrand(page, 'Touch First');
  await expect(welcome(page)).toBeVisible();
  await welcome(page).getByRole('button', { name: 'Take the tour' }).click();

  if (wide(page)) await expect(page.locator('.sc-help-float button')).toBeVisible();
  else {
    await expect(page.locator('.sc-topbar [aria-label="Help"]')).toBeVisible();
    await expect(page.locator('.sc-help-float')).toHaveCount(0);
  }

  await expect(tourTitle(page)).toHaveText('Start here');
  await page.locator('.sc-tour-next').tap();
  await page.locator('.sc-tour-next').tap();
  await expect(tourTitle(page)).toHaveText('Your shots live in Create');
  const light = await page.locator('.sc-tour-light').boundingBox();
  const link = page.locator('[data-tour="nav.create"]').filter({ visible: true }).first();
  const target = await link.boundingBox();
  expect(Math.abs((light?.x ?? 0) + 6 - (target?.x ?? 0))).toBeLessThanOrEqual(3);
  await page.locator('.sc-tour-next').tap();
  await expect.poll(() => learned(page)).toContain('tour-home');

  await page.goto(`/${slug}/create`);
  await expect(tourTitle(page)).toHaveText('Add what goes in the shot');
  await expect(page.locator('.sc-tour-body')).toHaveText('Tap + for a product, a presenter or a scene.');
  await page.locator('[data-tour="create.add"]').tap();
  await expect(page.locator('.sc-attachpanel')).toBeVisible();
  await page.locator('[data-tour="create.add"]').tap();
  await expect(tourTitle(page)).toHaveText('Say what you want');
});
