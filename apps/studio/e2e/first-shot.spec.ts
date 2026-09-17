import { test, expect } from '@playwright/test';
import { isolate } from './harness.js';
import {
  answerSettings,
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
 * one control at a time, each framed on its own and the only thing that can be
 * used: the add control, the picker it follows into, a presenter picked first,
 * Continue, the direction, the shape, the number, the size, Generate, the wait
 * on its tile, the finished picture, and the refinement that follows only when
 * the shot's composer is used. Every step is read from what the product holds.
 */
isolate({ brand: false, env: { SCENRI_NO_GUIDE: '0', SCENRI_DEMO_DELAY_MS: '1500' } });
test.describe.configure({ mode: 'serial' });

let slug = '';

test.beforeEach(async ({ page }) => {
  await noWelcomeWait(page);
  await page.setViewportSize({ width: 1440, height: 900 });
});

test('the coach walks every control of the first shot, one at a time, and stays through the wait', async ({ page }) => {
  test.setTimeout(90_000);
  slug = await setUpBrand(page, 'First Light');
  await expect(welcome(page)).toBeVisible();
  // the welcome is held behind the guide's own curtain, not the light dialog scrim
  await expect(page.locator('.sc-newdlg-scrim[data-tone="guide"]')).toHaveCSS('backdrop-filter', 'blur(6px)');
  await welcome(page).getByRole('button', { name: 'Make your first shot' }).click();
  await page.waitForURL(`**/${slug}/create`);

  await expect(coachTitle(page)).toHaveText('Add your ingredients');
  await pointsAt(page, '[data-guide="compose.add"]');
  await expectHeld(page);
  await expect(page.locator('.sc-coach-veil')).toHaveCSS('backdrop-filter', 'blur(6px)');
  // only the control the step asks for can be used: not the page, not the rest of the composer
  expect(await isInert(page, '.sc-topbar')).toBe(true);
  expect(await isInert(page, '[data-guide="compose.add"]')).toBe(false);
  expect(await isInert(page, '[data-guide="compose.send"]')).toBe(true);
  expect(await isInert(page, '[data-guide="compose"] .sc-brief-line')).toBe(true);

  // The picker opening is a step, not the task: the card follows beside it.
  await page.locator('[data-guide="compose.add"]').click();
  await expect(coachTitle(page)).toHaveText('Add a product, a presenter and a scene');
  await expect(coachCard(page)).toHaveAttribute('data-side', 'right');
  // measured once the picker has finished opening
  await expect
    .poll(() =>
      page.evaluate(() => {
        const c = document.querySelector('.sc-coach')?.getBoundingClientRect();
        const p = document.querySelector('.sc-attachpanel')?.getBoundingClientRect();
        return !!c && !!p && c.left >= p.right;
      }),
    )
    .toBe(true);
  expect(await isInert(page, '.sc-attachpanel')).toBe(false);
  expect(await isInert(page, '.sc-topbar')).toBe(true);

  // Closed with nothing picked: back to adding, never on.
  await page.keyboard.press('Escape');
  await expect(page.locator('.sc-attachpanel')).toHaveCount(0);
  await expect(coachTitle(page)).toHaveText('Add your ingredients');

  // Browsing inside the picker keeps the guide with it; any order is fine, a presenter first included.
  await page.locator('[data-guide="compose.add"]').click();
  const panel = page.locator('.sc-attachpanel');
  await panel.getByRole('tab', { name: /^Presenters/ }).click();
  await expect(coachCard(page)).toHaveAttribute('data-state', 'shown');
  await expect(coachTitle(page)).toHaveText('Add a product, a presenter and a scene');
  await panel
    .getByRole('button', { name: /^Presenter: / })
    .first()
    .click();
  await expect(chips(page)).toHaveCount(1);
  await expect(coachTitle(page)).toHaveText('Add a product and a scene');
  await expect(page.locator('.sc-coach-item[data-done]')).toHaveText(['Presenter, added']);
  // Continue waits for all three.
  const next = coachCard(page).getByRole('button', { name: 'Continue' });
  await expect(next).toHaveAttribute('aria-disabled', 'true');
  await next.click({ force: true });
  await expect(panel).toBeVisible();
  // A press on the curtain is not a press outside the picker.
  await page.mouse.click(40, 450);
  await expect(panel).toBeVisible();

  // An open row takes the picker to that ingredient; each pick moves it on to the next one missing.
  await coachCard(page)
    .getByRole('button', { name: /^Product/ })
    .click();
  await expect(panel.getByRole('tab', { name: /^Products/ })).toHaveAttribute('aria-selected', 'true');
  await panel
    .getByRole('button', { name: /^Product: / })
    .first()
    .click();
  await expect(coachTitle(page)).toHaveText('Add a scene');
  await expect(panel.getByRole('tab', { name: /^Scenes/ })).toHaveAttribute('aria-selected', 'true');
  await panel
    .getByRole('button', { name: /^Scene: / })
    .first()
    .click();
  await expect(coachTitle(page)).toHaveText("That's everything a shot needs");
  await expect(next).not.toHaveAttribute('aria-disabled', 'true');
  await next.click();
  await expect(panel).toHaveCount(0);
  await expect(coachTitle(page)).toHaveText('Describe the shot');
  // The composer stays in view whole: what the step does not ask for recedes, and cannot be used.
  expect(await page.locator('[data-guide="compose"] .sc-promptcard').getAttribute('data-guide-stage')).toBe('');
  expect(await isInert(page, '[data-guide="compose.add"]')).toBe(true);

  // Back reviews the card before and touches nothing in the brief.
  await coachCard(page).getByRole('button', { name: 'Back' }).click();
  await expect(coachTitle(page)).toHaveText('Add your ingredients');
  await expect(chips(page)).toHaveCount(3);
  await coachCard(page).getByRole('button', { name: 'Next' }).click();
  await expect(coachTitle(page)).toHaveText('Describe the shot');

  // A first word is not a finished direction; Enter says it is, and sends nothing.
  await brief(page).click();
  await page.keyboard.press('End');
  await page.keyboard.type(' on a sunlit concrete step');
  await expect(coachTitle(page)).toHaveText('Describe the shot');
  await page.keyboard.press('Enter');
  await expect(coachTitle(page)).toHaveText('Choose the shape');
  expect((await guideRecord(page)).activeNodes).toHaveLength(0);
  expect(await isInert(page, '[data-guide="compose.send"]')).toBe(true);

  // Opening a setting's popover keeps the guide on screen, with the popover live.
  await page.locator('[data-guide="compose.shape"]').click();
  await expect(coachCard(page)).toHaveAttribute('data-state', 'shown');
  expect(await isInert(page, '.sc-setpop[data-state="open"]')).toBe(false);
  await page.keyboard.press('Escape');
  await expect(coachTitle(page)).toHaveText('Choose how many');

  await expect(coachTitle(page)).toHaveText('Choose how many');
  await page.locator('[data-guide="compose.count"]').click();
  await page.locator('.sc-setpop[data-state="open"] [role="radio"][aria-checked="true"]').first().click();
  await expect(coachTitle(page)).toHaveText('Choose the size');
  await page.locator('[data-guide="compose.quality"]').click();
  await page.locator('.sc-setpop[data-state="open"] [role="radio"][aria-checked="true"]').first().click();
  await expect(coachTitle(page)).toHaveText('Make it');

  await pointsAt(page, '[data-guide="compose.send"]');
  await page.locator('[data-guide="compose.send"]').click();

  await expect(coachTitle(page)).toHaveText('Your shots are on the way', { timeout: 15_000 });
  await expect(coachCard(page)).toHaveAttribute('data-voice', 'card');
  await expectLetGo(page);
  await expect(coachTitle(page)).toHaveText('Your first shot is ready', { timeout: 15_000 });
  expect((await guideRecord(page)).done.shot).toBeTruthy();
  expect((await guideRecord(page)).active?.task).toBe('first-shot');
});

test('a reload lands on the result; opening it ends the first shot, and refining waits to be reached for', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.goto(`/${slug}/create`);
  await expect(coachTitle(page)).toHaveText('Your first shot is ready');
  const shot = (await guideRecord(page)).activeNodes.find((n) => n.status === 'done' && n.images > 0);
  expect(shot).toBeTruthy();
  await page.locator(`.sc-feed .sc-cell[data-fb-node="${shot?.id}"] .sc-cell-open`).click();
  await page.waitForURL(`**/shots/${shot?.id}**`);
  await expect.poll(async () => (await guideRecord(page)).active).toBeNull();
  await page.waitForTimeout(600);
  await expect(coachCard(page)).toHaveCount(0);

  // Using the shot's composer is what starts refining.
  await page.locator('.sc-ovl .sc-brief-line').click();
  await expect.poll(async () => (await guideRecord(page)).active?.task).toBe('refine');
  await expect(page.locator('.sc-ovl .sc-coach .sc-coach-title')).toHaveText('Change one thing');
  await page.locator('.sc-ovl .sc-brief-line').click();
  await page.keyboard.type('warmer light');
  await page.getByRole('button', { name: 'Refine', exact: true }).click();
  // the card arrives with the new version, the same moment the stage shows it
  await expect(page.locator('.sc-ovl .sc-coach .sc-coach-title')).toHaveText('A new version', { timeout: 30_000 });
  await page.locator('.sc-ovl .sc-coach').getByRole('button', { name: 'Done' }).click();
  await expect.poll(async () => (await guideRecord(page)).active).toBeNull();
  expect((await guideRecord(page)).done.refine).toBeTruthy();
});

test('First steps offers the next step under the greeting, ticks what was made, hides with an Undo, and Help brings it back', async ({
  page,
}) => {
  await page.goto(`/${slug}`);
  await expect(steps(page).locator('.sc-steps-item')).toHaveText([
    'First shot, done',
    'Refine, done',
    'Product',
    'Presenter',
    'Scene',
  ]);
  await expect(steps(page).locator('.sc-steps-count')).toHaveText('2 of 5 done');
  await expect(steps(page).locator('.sc-steps-title')).toHaveText('Add your own product');
  await expect(steps(page).locator('.sc-steps-item[data-next]')).toHaveText('Product');
  await expect(steps(page).locator('.sc-steps-go')).toHaveText('Start');
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

test('the X ends only the task in hand, leaves everything usable, and First steps picks it up again', async ({
  page,
}) => {
  await page.goto(`/${slug}`);
  await steps(page).locator('.sc-steps-item', { hasText: 'First shot' }).click();
  await page.waitForURL(`**/${slug}/create`);
  await expect(coachTitle(page)).toHaveText('Add your ingredients');

  await coachCard(page).getByRole('button', { name: 'Close guide' }).click();
  await expect(coachCard(page)).toHaveCount(0);
  await expectLetGo(page);
  await expect(page.getByText('Pick it up again from First steps on Home.')).toBeVisible();
  expect(await isInert(page, '[data-guide="compose"] .sc-brief-line')).toBe(false);
  const record = await guideRecord(page);
  expect(record.active).toBeNull();
  expect(record.dismissed).toContain('first-shot');

  await page.goto(`/${slug}`);
  await steps(page).locator('.sc-steps-item', { hasText: 'First shot' }).click();
  await expect(coachTitle(page)).toHaveText(/./);
  expect((await guideRecord(page)).dismissed).not.toContain('first-shot');
});

test('a scene, a product and a presenter each hold their own surface with the same coach', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto(`/${slug}`);
  await steps(page).locator('.sc-steps-item', { hasText: 'Scene' }).click();
  await expect(page).toHaveURL(/new=scene/);
  const layer = page.locator('.sc-newdlg-layer');
  await expect(layer.locator('.sc-coach .sc-coach-title')).toHaveText('Build a scene');
  await expect(layer.locator('.sc-coach-veil')).toHaveCount(1);
  // the dialog itself stays live under the curtain
  await layer.getByPlaceholder('Name this place').fill('Terrace');
  await expect(layer.getByPlaceholder('Name this place')).toHaveValue('Terrace');
  // the next step, now in hand, reads as one to continue
  await expect(page.locator('.sc-steps-item').nth(4)).toHaveAttribute('data-state', 'active');
  await layer.getByRole('button', { name: 'Close', exact: true }).first().click();
  await expect(page).not.toHaveURL(/new=scene/);
  // closing the dialog does not end the task: First steps continues it
  expect((await guideRecord(page)).active?.task).toBe('scene');
  await expect(steps(page).locator('.sc-steps-title')).toHaveText('Continue your scene');
  await expect(steps(page).locator('.sc-steps-go')).toHaveText('Continue');

  // Another task replaces it; the product dialog is held the same way, and its X ends only the guide.
  await steps(page).locator('.sc-steps-item', { hasText: 'Product' }).click();
  await expect(layer.locator('.sc-coach .sc-coach-title')).toHaveText('Add your product');
  await layer.locator('.sc-coach').getByRole('button', { name: 'Close guide' }).click();
  await expect(layer.locator('.sc-coach')).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: 'New product' })).toBeVisible();
  expect((await guideRecord(page)).dismissed).toContain('product');
  await page.getByRole('dialog', { name: 'New product' }).getByRole('button', { name: 'Close', exact: true }).click();

  await steps(page).locator('.sc-steps-item', { hasText: 'Presenter' }).click();
  await page.waitForURL(`**/${slug}/presenters/new**`);
  const studio = page.locator('.sc-pstudio');
  await expect(studio.locator('.sc-coach .sc-coach-title')).toHaveText('Create a presenter');
  await expect(studio.locator('.sc-coach')).toHaveAttribute('data-side', 'left');
  // answering the studio's own question moves the guide on with it
  await studio.getByRole('button', { name: 'Describe someone', exact: true }).click();
  // with nothing here that can draw, the studio's own answer (set up, or use photos) speaks for itself
  await expect(studio.locator('.sc-coach')).toHaveCount(0);
});
