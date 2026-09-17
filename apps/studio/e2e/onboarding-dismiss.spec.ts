import { test, expect } from '@playwright/test';
import { isolate } from './harness.js';
import { expectNoTour, learned, noWelcomeWait, setUpBrand, tourCard, tourTitle, tourX, welcome } from './firstUse.js';

/** Closing, twice, and a dialog opened over a tour. */
isolate({ brand: false, env: { SCENRI_NO_GUIDE: '0' } });
test.describe.configure({ mode: 'serial' });
test.beforeEach(({ page }) => noWelcomeWait(page));

const SLUG = 'skip-twice';

test('Escape closes a tour as a skip; a dialog hides the next one and gives it back; a second skip turns tours off', async ({
  page,
}) => {
  await setUpBrand(page, 'Skip Twice');
  await welcome(page).getByRole('button', { name: 'Take the tour' }).click();
  await expect(tourTitle(page)).toHaveText('Every shot starts as a brief');
  // A press on the curtain does nothing, and the key stays with the tour.
  await page.mouse.click(5, 400);
  await expect(tourTitle(page)).toHaveText('Every shot starts as a brief');
  await page.keyboard.press('Escape');
  await expect(tourCard(page)).toHaveCount(0);
  await expect.poll(() => learned(page)).toEqual(['welcome', 'tour-home', 'tour-skip']);

  await page.goto(`/${SLUG}/create`);
  await expect(tourTitle(page)).toHaveText('Bring in what stays the same');
  // The help button is behind the curtain; Shortcuts opens the way its menu row opens it.
  await page.evaluate(() => window.dispatchEvent(new Event('scenri:shortcuts')));
  await expect(page.getByRole('dialog', { name: 'Shortcuts' })).toBeVisible();
  await expect(tourCard(page)).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Shortcuts' })).toHaveCount(0);
  await expect(tourTitle(page)).toHaveText('Bring in what stays the same');

  await tourX(page).click();
  await expect(tourCard(page)).toHaveCount(0);
  await expect.poll(() => learned(page)).toContain('tours-off');

  await page.goto(`/${SLUG}/products`);
  await expect(page.locator('[data-tour="library.ours"] .sc-lookcard').first()).toBeVisible();
  await expectNoTour(page);
});
