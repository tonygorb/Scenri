import { test, expect } from '@playwright/test';
import { isolate } from './harness.js';
import {
  chips,
  coachCard,
  coachTitle,
  guideRecord,
  noWelcomeWait,
  ownBrand,
  pickFromPicker,
  readTheOpening,
  setUpBrand,
  welcome,
} from './firstUse.js';

/**
 * Going back through a brief (DESIGN.md, "First use"): while the tutor is
 * walking someone through one, a chip is theirs to change but not to take out,
 * and Back is the one thing that takes one out, a single step at a time.
 */
isolate({ brand: false, env: { SCENRI_NO_GUIDE: '0' } });

test('chips change, Back takes one out', async ({ page }) => {
  test.setTimeout(90_000);
  await noWelcomeWait(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await setUpBrand(page, 'Stepping Home');
  await welcome(page).locator('.sc-welcome-foot').getByRole('button', { name: 'Not now' }).click();
  // the answer is kept before the next write, or the two race at the server
  await expect.poll(async () => (await guideRecord(page)).welcome).toBe('declined');
  const slug = await ownBrand(page, 'Stepping');
  await page.goto(`/${slug}/create`);
  await readTheOpening(page);
  await page.locator('[data-guide="compose.add"]').click();
  await pickFromPicker(page, 'Product');
  await pickFromPicker(page, 'Presenter');
  await pickFromPicker(page, 'Scene');
  await expect(chips(page)).toHaveCount(3);

  // no X on a chip while the tutor is walking them through it
  expect(await page.locator('[data-guide="compose"] .sc-token > button:visible').count()).toBe(0);

  // Back takes the last one out, shows the ask that put it there, and opens
  // the shelf it came from: the choice is in front of them, not one press away
  await coachCard(page).getByRole('button', { name: 'Back' }).click();
  await expect(chips(page)).toHaveCount(2);
  await expect(coachTitle(page)).toHaveText('Choose a scene');
  await expect(page.locator('.sc-attachpanel .sc-ap-body')).toBeVisible();
  await expect(
    page
      .locator('.sc-attachpanel')
      .getByRole('button', { name: /^Scene: / })
      .first(),
  ).toBeVisible();
  await coachCard(page).getByRole('button', { name: 'Back' }).click();
  await expect(chips(page)).toHaveCount(1);
  await expect(coachTitle(page)).toHaveText('Choose a presenter');
  await coachCard(page).getByRole('button', { name: 'Back' }).click();
  await expect(chips(page)).toHaveCount(0);
  await expect(coachTitle(page)).toHaveText('Choose a product');
});
