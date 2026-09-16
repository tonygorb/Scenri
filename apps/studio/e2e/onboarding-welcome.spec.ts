import { test, expect } from '@playwright/test';
import { isolate } from './harness.js';
import { expectNoTour, learned, noWelcomeWait, setUpBrand, tourTitle, welcome } from './firstUse.js';

/** Every way out of the welcome that is not Take the tour means no tour begins; the ? still brings one back. */
isolate({ brand: false, env: { SCENRI_NO_GUIDE: '0' } });

test('skipping at the welcome turns tours off, and the ? replays one without counting a skip', async ({ page }) => {
  await noWelcomeWait(page);
  const slug = await setUpBrand(page, 'Quiet Start');
  await expect(welcome(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(welcome(page)).toHaveCount(0);
  await expect.poll(() => learned(page)).toEqual(['welcome', 'tours-off']);
  await expectNoTour(page);

  await page.goto(`/${slug}/scenes`);
  await expect(page.locator('[data-tour="library.ours"] .sc-lookcard').first()).toBeVisible();
  await expectNoTour(page);

  await page.locator('.sc-help-float button').click();
  await page.getByRole('menuitem', { name: 'Tour this page' }).click();
  await expect(tourTitle(page)).toHaveText('Build your own');
  await page.locator('.sc-tour-skip').click();
  await expect(tourTitle(page)).toHaveCount(0);
  await expect.poll(() => learned(page)).toEqual(['welcome', 'tours-off', 'tour-scenes']);
});
