import { test, expect } from '@playwright/test';
import { isolate } from './harness.js';
import {
  brief,
  coachCard,
  coachTitle,
  expectHeld,
  expectNoGuide,
  guideRecord,
  note,
  noWelcomeWait,
  pickAProduct,
  setUpBrand,
  steps,
  welcome,
} from './firstUse.js';

/**
 * The first shot when things go the other way: the welcome declined, every
 * take refused by the engine, and a phone. A failure is never a finished shot,
 * and the guide comes back to building the brief the moment someone does.
 */
isolate({ brand: false, env: { SCENRI_NO_GUIDE: '0', SCENRI_DEMO_FAIL_SLOT: '0' } });
test.describe.configure({ mode: 'serial' });

let slug = '';

test.beforeEach(async ({ page }) => {
  await noWelcomeWait(page);
  // one shot per send, so the one refused slot is the whole take
  await page.addInitScript(() => localStorage.setItem('scenri:count', '1'));
});

test('declining the welcome guides nothing, and First steps offers the first shot', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  slug = await setUpBrand(page, 'Second Take');
  await welcome(page).locator('.sc-welcome-foot').getByRole('button', { name: 'Not now' }).click();
  await expect(welcome(page)).toHaveCount(0);
  await expect(steps(page)).toBeVisible();
  await page.goto(`/${slug}/create`);
  await expectNoGuide(page);
  expect((await guideRecord(page)).welcome).toBe('declined');
});

test('a take that fails is said on its tile, survives a reload, and building again resumes the guide', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/${slug}`);
  await steps(page)
    .getByRole('button', { name: /^Make a shot/ })
    .click();
  await expect(coachTitle(page)).toHaveText("Add what you're shooting");
  await page.locator('[data-guide="compose.add"]').click();
  await pickAProduct(page);
  await page.locator('.sc-attachpanel').getByRole('button', { name: 'Close', exact: true }).click();
  await brief(page).click();
  await page.keyboard.press('End');
  await page.keyboard.type(' at dusk');
  await page.locator('[data-guide="compose.send"]').click();

  const failed = "That one didn't finish. The tile says why, and trying again keeps your product and words.";
  await expect(page.locator('.sc-coach .sc-coach-body')).toHaveText(failed, { timeout: 15_000 });
  await expect(coachCard(page)).toHaveAttribute('data-voice', 'card');
  const record = await guideRecord(page);
  expect(record.done.shot).toBeUndefined();
  expect(record.active?.task).toBe('first-shot');

  await page.reload();
  await expect(page.locator('.sc-coach .sc-coach-body')).toHaveText(failed);

  await page.locator('[data-guide="compose.add"]').click();
  await expect(note(page)).toHaveText(/^Choose a product/);
  await expectHeld(page);
});

test('on a phone the picker strip and the card fit the screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/${slug}/create`);
  await page.locator('[data-guide="compose.add"]').click();
  const strip = page.locator('.sc-attachpanel .sc-ap-guide');
  await expect(strip).toBeVisible();
  const s = await strip.boundingBox();
  expect(s && s.x >= 0 && s.x + s.width <= 390).toBe(true);

  // a phone's picker closes from the composer's own toggle
  await page.locator('[data-guide="compose.add"]').click();
  await expect(page.locator('.sc-attachpanel')).toHaveCount(0);
  await expect(coachCard(page)).toHaveAttribute('data-state', 'shown');
  const c = await coachCard(page).boundingBox();
  expect(c && c.x >= 0 && c.x + c.width <= 390 && c.y >= 0 && c.y + c.height <= 844).toBe(true);
});
