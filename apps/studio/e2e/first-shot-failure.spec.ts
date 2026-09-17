import { test, expect } from '@playwright/test';
import { isolate } from './harness.js';
import {
  brief,
  chips,
  coachCard,
  coachTitle,
  expectHeld,
  expectNoGuide,
  guideRecord,
  noWelcomeWait,
  ownBrand,
  pickTheIngredients,
  readTheOpening,
  setUpBrand,
  steps,
  welcome,
} from './firstUse.js';

/**
 * The first shot when it does not go well (DESIGN.md, "First use"): the
 * welcome declined, every take refused by the engine, a brief emptied back to
 * nothing, and a phone. A failure is never a finished shot, and the tutor
 * comes back to building the brief the moment someone does.
 */
isolate({ brand: false, env: { SCENRI_NO_GUIDE: '0', SCENRI_DEMO_FAIL_SLOT: '0' } });
test.describe.configure({ mode: 'serial' });

let slug = '';

test.beforeEach(async ({ page }) => {
  await noWelcomeWait(page);
  // one shot per send, so the one refused slot is the whole take
  await page.addInitScript(() => localStorage.setItem('scenri:count', '1'));
});

test('declining the welcome holds nothing, and First steps offers the first shot', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  slug = await setUpBrand(page, 'Second Take');
  await welcome(page).locator('.sc-welcome-foot').getByRole('button', { name: 'Not now' }).click();
  await expect(welcome(page)).toHaveCount(0);
  await expect(steps(page)).toBeVisible();
  await page.goto(`/${slug}/create`);
  await expectNoGuide(page);
  expect((await guideRecord(page)).welcome).toBe('declined');
});

test('a take the engine refuses is said on its tile, and building again picks the tutor back up', async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/${slug}`);
  await steps(page).locator('.sc-steps-item', { hasText: 'Make your first shot' }).click();
  await readTheOpening(page);
  await pickTheIngredients(page);
  await page.keyboard.type('at dusk, by the window');
  await page.locator('[data-guide="compose.send"]').click();

  await expect(coachTitle(page)).toHaveText("That one didn't work", { timeout: 20_000 });
  await expect(coachCard(page)).toHaveAttribute('data-voice', 'card');
  const record = await guideRecord(page);
  expect(record.done.shot).toBeUndefined();
  expect(record.active?.task).toBe('first-shot');

  await page.reload();
  await expect(coachTitle(page)).toHaveText("That one didn't work");

  // The send emptied the brief, so building again starts from the first ask,
  // and the opening is not replayed at someone already under way.
  await page.locator('[data-guide="compose.add"]').click();
  await expect(coachTitle(page)).toHaveText('Choose a product');
  await expectHeld(page);
});

test('on a phone the card stands above the picker, whole', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const own = await ownBrand(page, 'Phone Take');
  await page.goto(`/${own}/create`);
  await readTheOpening(page);
  await expect(coachTitle(page)).toHaveText('Choose a product');
  await page.locator('[data-guide="compose.add"]').click();
  await expect(coachCard(page)).toHaveAttribute('data-side', 'top');
  const fit = await page.evaluate(() => {
    const c = document.querySelector('.sc-coach')?.getBoundingClientRect();
    const p = document.querySelector('.sc-attachpanel')?.getBoundingClientRect();
    if (!c || !p) return null;
    return {
      inside: c.left >= 0 && c.right <= innerWidth && c.top >= 0 && c.bottom <= innerHeight,
      above: c.bottom <= p.top + 1,
    };
  });
  expect(fit).toEqual({ inside: true, above: true });
});

test('a chip is held while the tutor walks them through it, and free once it is over', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const own = await ownBrand(page, 'Empty It');
  await page.goto(`/${own}/create`);
  await readTheOpening(page);
  await pickTheIngredients(page);
  await brief(page).click();
  // A keyboard is not a way around the hold: select everything, press Backspace,
  // and the words go while every chip the tutor asked for stays.
  await page.keyboard.type('a few words');
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('Backspace');
  await expect(chips(page)).toHaveCount(3);
  await expect(coachTitle(page)).toHaveText('Say how to shoot it, then make it');

  // and once the guidance is over, they are ordinary chips again
  await coachCard(page).getByRole('button', { name: 'Close guide' }).click();
  await expect(coachCard(page)).toHaveCount(0);
  await brief(page).click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('Backspace');
  await expect(chips(page)).toHaveCount(0);
});
