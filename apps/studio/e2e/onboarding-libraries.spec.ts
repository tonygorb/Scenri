import { test, expect } from '@playwright/test';
import { isolate } from './harness.js';
import { learned, noWelcomeWait, pointsAt, setUpBrand, tourCard, tourNext, tourTitle, welcome } from './firstUse.js';

/** Products, Presenters and Scenes: why the page keeps its kind, then Scenri's own, never the person's. */
isolate({ brand: false, env: { SCENRI_NO_GUIDE: '0' } });
test.describe.configure({ mode: 'serial' });
test.beforeEach(({ page }) => noWelcomeWait(page));

const SLUG = 'three-libraries';
const OURS = '[data-tour="library.ours"] .sc-lookcard';

test('Products: keep what you sell, then shoot with ours', async ({ page }) => {
  await setUpBrand(page, 'Three Libraries');
  await welcome(page).getByRole('button', { name: 'Take the tour' }).click();
  await expect(tourTitle(page)).toHaveText('Every shot starts as a brief');

  await page.goto(`/${SLUG}/products`);
  await expect(tourTitle(page)).toHaveText('Keep what you sell');
  await tourNext(page).click();
  await expect(tourTitle(page)).toHaveText('Shoot before your catalog is in');
  await pointsAt(page, OURS);
  await tourNext(page).click();
  await expect.poll(() => learned(page)).toContain('tour-products');
});

test('Scenes: the create button is the step, and the tour waits out its dialog', async ({ page }) => {
  await page.goto(`/${SLUG}/scenes`);
  await expect(tourTitle(page)).toHaveText('Build the worlds you shoot in');
  await page.locator('[data-tour="library.add"]').click();
  await expect(page.locator('.sc-newdlg')).toBeVisible();
  await expect(tourCard(page)).toHaveCount(0);
  await expect(page.locator('[data-sc-tour-inert]')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.locator('.sc-newdlg')).toHaveCount(0);
  await expect(tourTitle(page)).toHaveText('A world for each use');
  await pointsAt(page, OURS);
});

test('Presenters: going to the studio from the first stop resumes past it', async ({ page }) => {
  await page.goto(`/${SLUG}/presenters`);
  await expect(tourTitle(page)).toHaveText('Cast the faces of this brand');
  await page.locator('[data-tour="library.add"]').click();
  await page.waitForURL((u) => u.pathname.startsWith(`/${SLUG}/presenters/new`));
  await expect(tourCard(page)).toHaveCount(0);
  await page.locator('.sc-pstudio-close').click();
  await page.waitForURL((u) => u.pathname === `/${SLUG}/presenters`);
  await expect(tourTitle(page)).toHaveText('A cast ready to work');
  await tourNext(page).click();
  await expect.poll(() => learned(page)).toContain('tour-presenters');
});
