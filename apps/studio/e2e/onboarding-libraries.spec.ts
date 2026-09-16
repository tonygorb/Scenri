import { test, expect, type Page } from '@playwright/test';
import { isolate } from './harness.js';
import { learned, noWelcomeWait, setUpBrand, tourCard, tourTitle, welcome } from './firstUse.js';

/** Products, Presenters and Scenes: the page's own way to add one, then one of Scenri's, never the person's own. */
isolate({ brand: false, env: { SCENRI_NO_GUIDE: '0' } });
test.describe.configure({ mode: 'serial' });
test.beforeEach(({ page }) => noWelcomeWait(page));

const SLUG = 'three-libraries';

/** The light rings a card inside Scenri's own wall. */
async function lightsScenriCard(p: Page) {
  const light = await p.locator('.sc-tour-light').boundingBox();
  const cards = p.locator('[data-tour="library.ours"] .sc-lookcard');
  const card = await cards.first().boundingBox();
  expect(light && card).toBeTruthy();
  expect(Math.abs((light?.x ?? 0) + 6 - (card?.x ?? 0))).toBeLessThanOrEqual(2);
}

test('Products: add, then try one of ours', async ({ page }) => {
  await setUpBrand(page, 'Three Libraries');
  await welcome(page).getByRole('button', { name: 'Take the tour' }).click();
  await expect(tourTitle(page)).toHaveText('Start here');

  await page.goto(`/${SLUG}/products`);
  await expect(tourTitle(page)).toHaveText('Add your product');
  await page.locator('.sc-tour-next').click();
  await expect(tourTitle(page)).toHaveText('Try one now');
  await lightsScenriCard(page);
  await page.locator('.sc-tour-next').click();
  await expect.poll(() => learned(page)).toContain('tour-products');
});

test('Scenes: the create button is the step, and the tour waits out its dialog', async ({ page }) => {
  await page.goto(`/${SLUG}/scenes`);
  await expect(tourTitle(page)).toHaveText('Build your own');
  await page.locator('[data-tour="library.add"]').click();
  await expect(page.locator('.sc-newdlg')).toBeVisible();
  await expect(tourCard(page)).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.locator('.sc-newdlg')).toHaveCount(0);
  await expect(tourTitle(page)).toHaveText('Try one now');
  await lightsScenriCard(page);
});

test('Presenters: going to the studio from the first stop resumes past it', async ({ page }) => {
  await page.goto(`/${SLUG}/presenters`);
  await expect(tourTitle(page)).toHaveText('Cast your own');
  await page.locator('[data-tour="library.add"]').click();
  await page.waitForURL((u) => u.pathname.startsWith(`/${SLUG}/presenters/new`));
  await expect(tourCard(page)).toHaveCount(0);
  await page.locator('.sc-pstudio-close').click();
  await page.waitForURL((u) => u.pathname === `/${SLUG}/presenters`);
  await expect(tourTitle(page)).toHaveText('Try one now');
  await page.locator('.sc-tour-next').click();
  await expect.poll(() => learned(page)).toContain('tour-presenters');
});
