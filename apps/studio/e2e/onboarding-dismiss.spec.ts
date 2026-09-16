import { test, expect } from '@playwright/test';
import { isolate } from './harness.js';
import { expectNoTour, learned, noWelcomeWait, setUpBrand, tourCard, tourTitle, welcome } from './firstUse.js';

/** Skipping, twice, and a dialog opened over a tour. */
isolate({ brand: false, env: { SCENRI_NO_GUIDE: '0' } });
test.describe.configure({ mode: 'serial' });
test.beforeEach(({ page }) => noWelcomeWait(page));

const SLUG = 'skip-twice';

test('Escape skips a tour; Shortcuts hides the next one and gives it back; a second skip turns tours off', async ({
  page,
}) => {
  await setUpBrand(page, 'Skip Twice');
  await welcome(page).getByRole('button', { name: 'Take the tour' }).click();
  await expect(tourTitle(page)).toHaveText('Start here');
  await page.locator('body').click({ position: { x: 5, y: 400 } });
  await page.keyboard.press('Escape');
  await expect(tourCard(page)).toHaveCount(0);
  await expect.poll(() => learned(page)).toEqual(['welcome', 'tour-home', 'tour-skip']);

  await page.goto(`/${SLUG}/create`);
  await expect(tourTitle(page)).toHaveText('Add what goes in the shot');
  await page.locator('.sc-help-float button').click();
  await page.getByRole('menuitem', { name: 'Keyboard shortcuts' }).click();
  await expect(page.getByRole('dialog', { name: 'Shortcuts' })).toBeVisible();
  await expect(tourCard(page)).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Shortcuts' })).toHaveCount(0);
  await expect(tourTitle(page)).toHaveText('Add what goes in the shot');

  await page.getByRole('button', { name: 'Skip tour' }).first().click();
  await expect(tourCard(page)).toHaveCount(0);
  await expect.poll(() => learned(page)).toContain('tours-off');

  await page.goto(`/${SLUG}/products`);
  await expect(page.locator('[data-tour="library.ours"] .sc-lookcard').first()).toBeVisible();
  await expectNoTour(page);
});
