import { test, expect } from '@playwright/test';
import { isolate } from './harness.js';
import { expectNoGuide, guideRecord, ownBrand, setUpBrand, steps, welcome } from './firstUse.js';
import { FIRST_USE } from '../src/firstUse.js';

/**
 * A new install on a build with first use paused (src/firstUse.ts). The server
 * still knows it is new and keeps its record; nothing of first use shows, and
 * no way into it is left open.
 */

// The guide left on at the server. Not with '0': the harness skips the files
// that turn it on that way while first use is paused, and this file is about
// exactly that build.
isolate({ brand: false, env: { SCENRI_NO_GUIDE: '' } });
test.skip(FIRST_USE, 'only means something while first use is paused');
test.describe.configure({ mode: 'serial' });

test('a new install is not welcomed, taught or offered First steps, and Help has no way in', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const slug = await setUpBrand(page, 'Paused Co');
  // the server does call this install new
  expect((await guideRecord(page)).eligible).toBe(true);

  await expect(page.locator('.sc-greet')).toBeVisible();
  // well past the welcome's settle
  await page.waitForTimeout(1500);
  await expect(welcome(page)).toHaveCount(0);
  await expect(steps(page)).toHaveCount(0);
  await expectNoGuide(page);

  await page.locator('.sc-help-float button').click();
  await expect(page.getByRole('menuitem', { name: "What's new" })).toBeVisible();
  const items = await page.locator('.sc-help-menu [role="menuitem"]').allTextContents();
  for (const gone of ['First steps', 'Learn', 'Welcome to Scenri']) expect(items).not.toContain(gone);
  await page.keyboard.press('Escape');

  // an address from a build that offered them opens nothing
  await page.goto(`/${slug}?learn=lessons`);
  await expect(page.locator('.sc-greet')).toBeVisible();
  await page.waitForTimeout(600);
  await expect(page.getByRole('dialog', { name: 'Learn' })).toHaveCount(0);
  await page.goto(`/${slug}?welcome=1`);
  await expect(page.locator('.sc-greet')).toBeVisible();
  await page.waitForTimeout(600);
  await expect(welcome(page)).toHaveCount(0);
});

test('a task begun on a build that offered it stays out of sight, and its record is kept', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const slug = await ownBrand(page, 'Held Co');
  await page.goto(`/${slug}/create`);
  await expect(page.locator('[data-guide="compose"]')).toBeVisible();
  await expectNoGuide(page);
  expect((await guideRecord(page)).active?.task).toBe('first-shot');
});
