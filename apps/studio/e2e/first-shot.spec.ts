import { test, expect } from '@playwright/test';
import { isolate } from './harness.js';
import {
  brief,
  chips,
  coachCard,
  coachTitle,
  expectHeld,
  expectLetGo,
  guideRecord,
  isInert,
  noWelcomeWait,
  pointsAt,
  setUpBrand,
  steps,
  welcome,
} from './firstUse.js';

/**
 * The first shot, A to Z, as someone new makes it (DESIGN.md, "First use"):
 * the welcome, the coach on the add control, the picker it follows into, a
 * presenter picked first, Continue, the direction, Generate, the wait on its
 * tile, the finished picture, and the refinement that follows only when the
 * shot's composer is reached for. Every step is read from what the product
 * holds, so a wrong turn, Back or a reload lands on the right one.
 */
isolate({ brand: false, env: { SCENRI_NO_GUIDE: '0', SCENRI_DEMO_DELAY_MS: '1500' } });
test.describe.configure({ mode: 'serial' });

let slug = '';

test.beforeEach(async ({ page }) => {
  await noWelcomeWait(page);
  await page.setViewportSize({ width: 1440, height: 900 });
});

test('the coach follows the first shot into the picker, adapts to what is picked, and stays through the wait', async ({
  page,
}) => {
  test.setTimeout(90_000);
  slug = await setUpBrand(page, 'First Light');
  await expect(welcome(page)).toBeVisible();
  // the welcome is held behind the guide's own curtain, not the light dialog scrim
  const scrim = page.locator('.sc-newdlg-scrim[data-tone="guide"]');
  await expect(scrim).toHaveCSS('backdrop-filter', 'blur(6px)');
  await welcome(page).getByRole('button', { name: 'Make your first shot' }).click();
  await page.waitForURL(`**/${slug}/create`);

  await expect(coachTitle(page)).toHaveText('Every shot starts from ingredients');
  await pointsAt(page, '[data-guide="compose.add"]');
  await expectHeld(page);
  expect(await isInert(page, '.sc-topbar')).toBe(true);
  expect(await isInert(page, '[data-guide="compose"]')).toBe(false);
  await expect(page.locator('.sc-coach-veil')).toHaveCSS('backdrop-filter', 'blur(6px)');

  // The picker opening is a step, not the task: the card follows beside it.
  await page.locator('[data-guide="compose.add"]').click();
  await expect(coachTitle(page)).toHaveText("A product is what you're shooting");
  await expect(coachCard(page)).toHaveAttribute('data-side', 'right');
  const beside = await page.evaluate(() => {
    const c = document.querySelector('.sc-coach')?.getBoundingClientRect();
    const p = document.querySelector('.sc-attachpanel')?.getBoundingClientRect();
    return !!c && !!p && c.left >= p.right;
  });
  expect(beside).toBe(true);
  expect(await isInert(page, '.sc-attachpanel')).toBe(false);
  expect(await isInert(page, '.sc-topbar')).toBe(true);

  // Closed with nothing picked: back to adding, never on.
  await page.keyboard.press('Escape');
  await expect(page.locator('.sc-attachpanel')).toHaveCount(0);
  await expect(coachTitle(page)).toHaveText('Every shot starts from ingredients');

  // Browsing inside the picker keeps the guide with it; a presenter first is a valid start.
  await page.locator('[data-guide="compose.add"]').click();
  await page
    .locator('.sc-attachpanel')
    .getByRole('tab', { name: /^Presenters/ })
    .click();
  await expect(coachCard(page)).toHaveAttribute('data-state', 'shown');
  await expect(coachTitle(page)).toHaveText("A product is what you're shooting");
  await page
    .locator('.sc-attachpanel')
    .getByRole('button', { name: /^Presenter: / })
    .first()
    .click();
  await expect(chips(page)).toHaveCount(1);
  await expect(coachTitle(page)).toHaveText("Add what they're showing");
  // A press on the curtain is not a press outside the picker.
  await page.mouse.click(40, 450);
  await expect(page.locator('.sc-attachpanel')).toBeVisible();

  await coachCard(page).getByRole('button', { name: 'Continue' }).click();
  await expect(page.locator('.sc-attachpanel')).toHaveCount(0);
  await expect(coachTitle(page)).toHaveText('Now direct it');

  // Back reviews the card before and touches nothing in the brief.
  await coachCard(page).getByRole('button', { name: 'Back' }).click();
  await expect(coachTitle(page)).toHaveText('Every shot starts from ingredients');
  await expect(chips(page)).toHaveCount(1);
  await coachCard(page).getByRole('button', { name: 'Next' }).click();
  await expect(coachTitle(page)).toHaveText('Now direct it');

  await brief(page).click();
  await page.keyboard.press('End');
  await page.keyboard.type(' on a sunlit concrete step');
  await expect(coachTitle(page)).toHaveText('Make the shot');
  await pointsAt(page, '[data-guide="compose.send"]');
  await page.locator('[data-guide="compose.send"]').click();

  await expect(coachTitle(page)).toHaveText('Your shot is being made', { timeout: 15_000 });
  await expect(coachCard(page)).toHaveAttribute('data-voice', 'card');
  await expectLetGo(page);
  await expect(coachTitle(page)).toHaveText('Your first shot', { timeout: 15_000 });
  expect((await guideRecord(page)).done.shot).toBeTruthy();
  expect((await guideRecord(page)).active?.task).toBe('first-shot');
});

test('a reload lands on the result; opening it ends the first shot, and refining waits to be reached for', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.goto(`/${slug}/create`);
  await expect(coachTitle(page)).toHaveText('Your first shot');
  const shot = (await guideRecord(page)).activeNodes.find((n) => n.status === 'done' && n.images > 0);
  expect(shot).toBeTruthy();
  await page.locator(`.sc-feed .sc-cell[data-fb-node="${shot?.id}"] .sc-cell-open`).click();
  await page.waitForURL(`**/shots/${shot?.id}**`);
  await expect.poll(async () => (await guideRecord(page)).active).toBeNull();
  await page.waitForTimeout(600);
  await expect(coachCard(page)).toHaveCount(0);

  // Reaching for the shot's composer is what starts refining.
  await page.locator('.sc-ovl .sc-brief-line').click();
  await expect.poll(async () => (await guideRecord(page)).active?.task).toBe('refine');
  await expect(page.locator('.sc-ovl .sc-coach .sc-coach-title')).toHaveText('Change one thing at a time');
  await page.locator('.sc-ovl .sc-brief-line').click();
  await page.keyboard.type('warmer light');
  await page.getByRole('button', { name: 'Refine', exact: true }).click();
  // the card arrives with the new version, the same moment the stage shows it
  await expect(page.locator('.sc-ovl .sc-coach .sc-coach-title')).toHaveText('This is a new version', {
    timeout: 30_000,
  });
  await page.locator('.sc-ovl .sc-coach').getByRole('button', { name: 'Done' }).click();
  await expect.poll(async () => (await guideRecord(page)).active).toBeNull();
  expect((await guideRecord(page)).done.refine).toBeTruthy();
});

test('First steps sits under the greeting, ticks what was made, hides with an Undo, and Help brings it back', async ({
  page,
}) => {
  await page.goto(`/${slug}`);
  await expect(steps(page).locator('.sc-steps-name')).toHaveText([
    'Make your first shot, done',
    'Refine a shot, done',
    'Add your own product',
    'Cast a presenter',
    'Build a scene',
  ]);
  await expect(steps(page).locator('.sc-steps-count')).toHaveText('2 of 5');
  const order = await page.evaluate(() => {
    const g = document.querySelector('.sc-greet')?.getBoundingClientRect();
    const s = document.querySelector('.sc-steps')?.getBoundingClientRect();
    const c = document.querySelector('.sc-create-grid')?.getBoundingClientRect();
    return !!g && !!s && !!c && g.bottom <= s.top && s.bottom <= c.top;
  });
  expect(order).toBe(true);

  await steps(page).getByRole('button', { name: 'Hide first steps' }).click();
  await expect(steps(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(steps(page)).toBeVisible();

  await steps(page).getByRole('button', { name: 'Hide first steps' }).click();
  await expect(steps(page)).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.sc-greet')).toBeVisible();
  await expect(steps(page)).toHaveCount(0);
  await page.goto(`/${slug}/scenes`);
  await page.locator('.sc-help-float button').click();
  await page.getByRole('menuitem', { name: 'First steps' }).click();
  await page.waitForURL((u) => u.pathname === `/${slug}`);
  await expect(steps(page)).toBeVisible();
});

test('the X ends only the task in hand: the brief stays, and First steps picks it up again', async ({ page }) => {
  await page.goto(`/${slug}`);
  await steps(page).locator('.sc-steps-item', { hasText: 'Make your first shot' }).click();
  await page.waitForURL(`**/${slug}/create`);
  await expect(coachTitle(page)).toHaveText('Every shot starts from ingredients');
  await brief(page).click();
  await page.keyboard.type('kept words');

  await coachCard(page).getByRole('button', { name: 'Close guide' }).click();
  await expect(coachCard(page)).toHaveCount(0);
  await expectLetGo(page);
  await expect(page.getByText('Pick it up again from First steps on Home.')).toBeVisible();
  await expect(brief(page)).toContainText('kept words');
  const record = await guideRecord(page);
  expect(record.active).toBeNull();
  expect(record.dismissed).toContain('first-shot');

  await page.goto(`/${slug}`);
  await steps(page).locator('.sc-steps-item', { hasText: 'Make your first shot' }).click();
  await expect(coachTitle(page)).toHaveText(/./);
  expect((await guideRecord(page)).dismissed).not.toContain('first-shot');
});

test('a scene, a product and a presenter each hold their own surface with the same coach', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto(`/${slug}`);
  await steps(page).locator('.sc-steps-item', { hasText: 'Build a scene' }).click();
  await expect(page).toHaveURL(/new=scene/);
  const layer = page.locator('.sc-newdlg-layer');
  await expect(layer.locator('.sc-coach .sc-coach-title')).toHaveText('A scene is the world a shot lives in');
  await expect(layer.locator('.sc-coach-veil')).toHaveCount(1);
  // the dialog itself stays live under the curtain
  await layer.getByPlaceholder('Name this place').fill('Terrace');
  await expect(layer.getByPlaceholder('Name this place')).toHaveValue('Terrace');
  // the fifth step, now in hand, reads as one to continue
  await expect(page.locator('.sc-steps-item').nth(4)).toHaveAttribute('data-state', 'active');
  await layer.getByRole('button', { name: 'Close', exact: true }).first().click();
  await expect(page).not.toHaveURL(/new=scene/);
  // closing the dialog does not end the task: First steps continues it
  expect((await guideRecord(page)).active?.task).toBe('scene');
  await expect(steps(page).locator('.sc-steps-item[data-state="active"] .sc-steps-name')).toHaveText(
    'Continue your scene',
  );

  // Another task replaces it; the product dialog is held the same way, and its X ends only the guide.
  await steps(page).locator('.sc-steps-item', { hasText: 'Add your own product' }).click();
  await expect(layer.locator('.sc-coach .sc-coach-title')).toHaveText("A product is what you're shooting");
  await layer.locator('.sc-coach').getByRole('button', { name: 'Close guide' }).click();
  await expect(layer.locator('.sc-coach')).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: 'New product' })).toBeVisible();
  expect((await guideRecord(page)).dismissed).toContain('product');
  await page.getByRole('dialog', { name: 'New product' }).getByRole('button', { name: 'Close', exact: true }).click();

  await steps(page).locator('.sc-steps-item', { hasText: 'Cast a presenter' }).click();
  await page.waitForURL(`**/${slug}/presenters/new**`);
  const studio = page.locator('.sc-pstudio');
  await expect(studio.locator('.sc-coach .sc-coach-title')).toHaveText('A presenter is who appears');
  await expect(studio.locator('.sc-coach')).toHaveAttribute('data-side', 'left');
  // answering the studio's own question lets the studio speak for itself
  await studio.getByRole('button', { name: 'Describe someone', exact: true }).click();
  await expect(studio.locator('.sc-coach')).toHaveCount(0);
  await expect(studio.locator('.sc-coach-veil')).toHaveCount(0);
});
