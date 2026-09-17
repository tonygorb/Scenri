import { test, expect, type Page } from '@playwright/test';
import { isolate } from './harness.js';
import { learned, noWelcomeWait, pointsAt, setUpBrand, tourNext, tourTitle, welcome } from './firstUse.js';

/**
 * Phone and tablet (this file runs in both projects): the ? where the corner is
 * free, the Home tour pointing at the Create link that is actually on screen,
 * and the Create tour's window open on the real composer under a thumb.
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

  await expect(tourTitle(page)).toHaveText('Every shot starts as a brief');
  await tourNext(page).tap();
  await expect(tourTitle(page)).toHaveText('Finished shots are recipes');
  await tourNext(page).tap();
  await expect(tourTitle(page)).toHaveText('Where your shots are kept');
  await pointsAt(page, '[data-tour="nav.create"]');
  await tourNext(page).tap();
  await expect.poll(() => learned(page)).toContain('tour-home');

  await page.goto(`/${slug}/create`);
  await expect(tourTitle(page)).toHaveText('Bring in what stays the same');
  await pointsAt(page, '[data-tour="create.add"]');
  await page.locator('[data-tour="create.add"]').tap();
  await expect(page.locator('.sc-attachpanel')).toBeVisible();
  await page.locator('[data-tour="create.add"]').tap();
  await expect(tourTitle(page)).toHaveText('Art-direct in words');
});
