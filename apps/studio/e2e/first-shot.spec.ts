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
  note,
  noWelcomeWait,
  pickAProduct,
  pointsAt,
  setUpBrand,
  steps,
  welcome,
} from './firstUse.js';

/**
 * The first shot, A to Z, as someone new makes it (DESIGN.md, "First use"):
 * the welcome, the coach on the add control, the picker it stays inside, the
 * brief, a quiet wait, the finished picture, and the refinement that follows
 * when they open it. Every step is read from what the product holds, so a
 * wrong turn, Back or a reload lands on the right one.
 */
isolate({ brand: false, env: { SCENRI_NO_GUIDE: '0', SCENRI_DEMO_DELAY_MS: '1500' } });
test.describe.configure({ mode: 'serial' });

let slug = '';

test.beforeEach(async ({ page }) => {
  await noWelcomeWait(page);
  await page.setViewportSize({ width: 1440, height: 900 });
});

test('the welcome offers the first shot, and the coach follows it into the picker and out', async ({ page }) => {
  test.setTimeout(60_000);
  slug = await setUpBrand(page, 'First Light');
  await expect(welcome(page)).toBeVisible();
  await expect(welcome(page)).toContainText('Product shots on brand');
  await welcome(page).getByRole('button', { name: 'Make your first shot' }).click();
  await page.waitForURL(`**/${slug}/create`);

  await expect(coachTitle(page)).toHaveText("Add what you're shooting");
  await pointsAt(page, '[data-guide="compose.add"]');
  await expectHeld(page);
  expect(await isInert(page, '.sc-topbar')).toBe(true);
  expect(await isInert(page, '[data-guide="compose"]')).toBe(false);

  // Opening the picker is a step change, not the task: the words move inside it.
  await page.locator('[data-guide="compose.add"]').click();
  await expect(note(page)).toHaveText('Choose a product. Its real photos keep it exact in every shot.');
  await expect(page.locator('.sc-attachpanel .sc-ap-guide [data-guide="note"]')).toBeVisible();
  await expect(coachCard(page)).toHaveCount(0);
  await expectHeld(page);
  expect(await isInert(page, '.sc-attachpanel')).toBe(false);
  expect(await isInert(page, '.sc-topbar')).toBe(true);

  // Closed with nothing picked: back to adding, never on to the brief.
  await page.keyboard.press('Escape');
  await expect(page.locator('.sc-attachpanel')).toHaveCount(0);
  await expect(coachTitle(page)).toHaveText("Add what you're shooting");

  // A tab switch keeps the guide in the picker; a pick moves it on.
  await page.locator('[data-guide="compose.add"]').click();
  await page
    .locator('.sc-attachpanel')
    .getByRole('tab', { name: /^Products/ })
    .click();
  await expect(note(page)).toHaveText(/^Choose a product/);
  await pickAProduct(page);
  await expect(chips(page)).toHaveCount(1);
  await expect(note(page)).toHaveText(
    'Add a presenter or a scene if you like, then close the panel to direct the shot.',
  );
  // A press on the curtain is not a press outside the picker.
  await page.mouse.click(40, 450);
  await expect(page.locator('.sc-attachpanel')).toBeVisible();
  await page.locator('.sc-attachpanel').getByRole('button', { name: 'Close', exact: true }).click();

  await expect(coachTitle(page)).toHaveText('Direct it, then Generate');
  await pointsAt(page, '[data-guide="compose.send"]');

  // Back reviews the card before and touches nothing in the brief.
  await coachCard(page).getByRole('button', { name: 'Back' }).click();
  await expect(coachTitle(page)).toHaveText("Add what you're shooting");
  await expect(chips(page)).toHaveCount(1);
  await coachCard(page).getByRole('button', { name: 'Next' }).click();
  await expect(coachTitle(page)).toHaveText('Direct it, then Generate');

  // The send lets go of the page at once; the wait is quiet; the shot ends it on its tile.
  await brief(page).click();
  await page.keyboard.press('End');
  await page.keyboard.type(' on a sunlit concrete step');
  await page.locator('[data-guide="compose.send"]').click();
  await expect(coachCard(page)).toHaveCount(0);
  await expectLetGo(page);
  await expect(page.getByRole('status').filter({ hasText: 'Your first shot is on its way.' })).toHaveCount(1);
  await expect(coachTitle(page)).toHaveText('Your first shot', { timeout: 15_000 });
  await expect(coachCard(page)).toHaveAttribute('data-voice', 'card');
  await expectLetGo(page);
  expect((await guideRecord(page)).done.shot).toBeTruthy();
  expect((await guideRecord(page)).active?.task).toBe('first-shot');
});

test('a reload lands on the same moment, and opening the shot ends it and begins refining', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto(`/${slug}/create`);
  await expect(coachTitle(page)).toHaveText('Your first shot');
  const shot = (await guideRecord(page)).activeNodes.find((n) => n.status === 'done' && n.images > 0);
  expect(shot).toBeTruthy();
  await page.locator(`.sc-feed .sc-cell[data-fb-node="${shot?.id}"] .sc-cell-open`).click();
  await page.waitForURL(`**/shots/${shot?.id}**`);

  await expect.poll(async () => (await guideRecord(page)).active?.task).toBe('refine');
  await expect(note(page)).toHaveText('One change at a time works best, like warmer light or a closer crop.');
  await expect(coachCard(page)).toHaveCount(0);

  const field = page.locator('.sc-composer:not([data-guide]) .sc-brief-line');
  await field.click();
  await page.keyboard.type('warmer light');
  await page.getByRole('button', { name: 'Refine', exact: true }).click();
  await expect(note(page)).toHaveText('This is a new version. The original is one step back.', { timeout: 15_000 });

  await page.keyboard.press('Escape');
  await expect.poll(async () => (await guideRecord(page)).active).toBeNull();
  expect((await guideRecord(page)).done.refine).toBeTruthy();
});

test('First steps ticks what was made, hides with an Undo, and Help brings it back', async ({ page }) => {
  await page.goto(`/${slug}`);
  await expect(steps(page).locator('.sc-steps-item')).toHaveText([
    'Make a shot, done',
    'Refine a shot, done',
    'Add your product',
    'Cast a presenter',
    'Build a scene',
  ]);
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
  await steps(page)
    .getByRole('button', { name: /^Make a shot/ })
    .click();
  await page.waitForURL(`**/${slug}/create`);
  await expect(coachTitle(page)).toHaveText("Add what you're shooting");
  await brief(page).click();
  await page.keyboard.type('kept words');
  await expect(coachTitle(page)).toHaveText("Add what you're shooting");

  await coachCard(page).getByRole('button', { name: 'Close guide' }).click();
  await expect(coachCard(page)).toHaveCount(0);
  await expectLetGo(page);
  await expect(page.getByText('Pick it up again from First steps on Home.')).toBeVisible();
  await expect(brief(page)).toContainText('kept words');
  const record = await guideRecord(page);
  expect(record.active).toBeNull();
  expect(record.dismissed).toContain('first-shot');

  await page.goto(`/${slug}`);
  await steps(page)
    .getByRole('button', { name: /^Make a shot/ })
    .click();
  await expect(coachTitle(page)).toHaveText("Add what you're shooting");
  expect((await guideRecord(page)).dismissed).not.toContain('first-shot');
});

test('a scene, a product and a presenter each say one thing where they are made, and leaving ends quietly', async ({
  page,
}) => {
  await page.goto(`/${slug}`);
  await steps(page)
    .getByRole('button', { name: /^Build a scene/ })
    .click();
  await expect(page).toHaveURL(/new=scene/);
  const dialog = page.getByRole('dialog', { name: 'New scene' });
  await expect(dialog.locator('[data-guide="note"]')).toHaveText(
    'Build a place once and shoot in it again. Photos of a real place work best; a line of direction works too.',
  );
  // under the dialog the page is hidden from the accessibility tree, so this reads the element itself
  await expect(page.locator('.sc-steps-item', { hasText: 'Build a scene' })).toHaveAttribute('data-state', 'active');
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect.poll(async () => (await guideRecord(page)).active).toBeNull();
  expect((await guideRecord(page)).dismissed).not.toContain('scene');

  await steps(page)
    .getByRole('button', { name: /^Add your product/ })
    .click();
  const product = page.getByRole('dialog', { name: 'New product' });
  await expect(product.locator('[data-guide="note"]')).toHaveText(
    'Photos of the real product keep it exact in every shot, or import your store below.',
  );
  // The note's X ends the task and leaves the dialog exactly as it was.
  await product.getByRole('button', { name: 'Close guide' }).click();
  await expect(product.locator('[data-guide="note"]')).toHaveCount(0);
  await expect(product).toBeVisible();
  expect((await guideRecord(page)).dismissed).toContain('product');
  await product.getByRole('button', { name: 'Close', exact: true }).click();

  await steps(page)
    .getByRole('button', { name: /^Cast a presenter/ })
    .click();
  await page.waitForURL(`**/${slug}/presenters/new**`);
  await expect(note(page)).toHaveText('Cast them once, and the same person fronts every shot.');
  await page.locator('.sc-pstudio-close').click();
  await expect.poll(async () => (await guideRecord(page)).active).toBeNull();
});
