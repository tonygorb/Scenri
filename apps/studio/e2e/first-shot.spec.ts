import { test, expect } from '@playwright/test';
import { isolate } from './harness.js';
import {
  brief,
  chips,
  coachCard,
  coachTitle,
  expectHeld,
  expectLetGo,
  expectNoGuide,
  guideRecord,
  isInert,
  noWelcomeWait,
  ownBrand,
  pickFromPicker,
  pickTheIngredients,
  pointsAt,
  readTheOpening,
  setUpBrand,
  steps,
  welcome,
} from './firstUse.js';

/**
 * The first shot, as someone new meets it (DESIGN.md, "First use"): a tutor
 * that says one thing, waits for the real result, follows the screen that
 * result opens, and shuts up where the product already speaks. Every moment is
 * derived from what the product holds, so taking something back asks for it
 * again and a reload lands where they left off.
 */
isolate({ brand: false, env: { SCENRI_NO_GUIDE: '0', SCENRI_DEMO_DELAY_MS: '1200' } });
test.describe.configure({ mode: 'serial' });

let slug = '';

test.beforeEach(async ({ page }) => {
  await noWelcomeWait(page);
  await page.setViewportSize({ width: 1440, height: 900 });
});

test('one thing at a time, from the welcome to a finished picture', async ({ page }) => {
  test.setTimeout(90_000);
  slug = await setUpBrand(page, 'First Light');
  await expect(welcome(page)).toBeVisible();
  // the welcome is held behind the tutor's own curtain, not the light dialog scrim
  await expect(page.locator('.sc-newdlg-scrim[data-tone="guide"]')).toHaveCSS('backdrop-filter', 'blur(6px)');
  await welcome(page).getByRole('button', { name: 'Make your first shot' }).click();
  await page.waitForURL(`**/${slug}/create`);

  // It opens by saying what this place is, over the thing that does it.
  await expect(coachTitle(page)).toContainText('This is Create');
  await expectHeld(page);
  await expect(page.locator('.sc-coach-veil')).toHaveCSS('backdrop-filter', 'blur(3px)');
  await coachCard(page).getByRole('button', { name: 'Start' }).click();

  // Then one ask, on the one control that answers it.
  await expect(coachTitle(page)).toHaveText('Choose a product');
  await expect(coachCard(page).locator('.sc-coach-count')).toContainText('1 of 4');
  await pointsAt(page, '[data-guide="compose.add"]');
  await expect(chips(page)).toHaveCount(0);

  // The picker is the same moment: it opens on the kind being asked for, with
  // nothing else in it, and the tutor follows it.
  await page.locator('[data-guide="compose.add"]').click();
  await expect(coachCard(page)).toHaveAttribute('data-side', 'right');
  // the rail is still there, held rather than taken away, with the kind it is
  // asking for the only one at full strength
  await expect(page.locator('.sc-attachpanel [role="tab"][data-on]')).toHaveText(/Products/);
  await expect(page.locator('.sc-attachpanel .sc-ap-sec-title')).toContainText('Products');
  await pickFromPicker(page, 'Product');

  // A real pick is what moves it on, and the picker moves with it.
  await expect(chips(page)).toHaveCount(1);
  await expect(coachTitle(page)).toHaveText('Choose a presenter');
  await expect(page.locator('.sc-attachpanel .sc-ap-sec-title')).toContainText('Presenters');
  await pickFromPicker(page, 'Presenter');
  await expect(coachTitle(page)).toHaveText('Choose a scene');
  await expect(page.locator('.sc-attachpanel .sc-ap-sec-title')).toContainText('Scenes');
  await pickFromPicker(page, 'Scene');

  // Nothing left to add: the picker closes itself rather than asking them to.
  await expect(page.locator('.sc-attachpanel')).toHaveCount(0);
  await expect(chips(page)).toHaveCount(3);
  await expect(coachTitle(page)).toHaveText('Say how to shoot it, then make it');

  // The caret is already in the brief, at the end of what is there, and the
  // words and the making are one moment: nothing moves while they write.
  await expect.poll(() => page.evaluate(() => document.activeElement?.className ?? '')).toContain('sc-brief-line');
  await page.keyboard.type('a worn table in late afternoon light');
  await expect(brief(page)).toContainText('a worn table in late afternoon light');
  await expect(coachTitle(page)).toHaveText('Say how to shoot it, then make it');
  await pointsAt(page, '[data-guide="compose.send"]');
  expect((await guideRecord(page)).activeNodes).toHaveLength(0);
  await page.locator('[data-guide="compose.send"]').click();

  // The wait is a note on the tile being made, and it holds nothing. A demo
  // engine can beat the assertion to it, so either note is the same promise.
  await expect(coachTitle(page)).toHaveText(/Making your shot|Your first shot/, { timeout: 20_000 });
  await expect(coachCard(page)).toHaveAttribute('data-voice', 'card');
  await expectLetGo(page);

  // A finished picture is what ends it, never the press that asked for it.
  await expect(coachTitle(page)).toHaveText('Your first shot', { timeout: 30_000 });
  const record = await guideRecord(page);
  expect(record.done.shot).toBeTruthy();
  expect(record.active?.task).toBe('first-shot');
});

test('opening the shot it made finishes the task, and refining waits to be asked for', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto(`/${slug}/create`);
  await expect(coachTitle(page)).toHaveText('Your first shot');
  const shot = (await guideRecord(page)).activeNodes.find((n) => n.status === 'done' && n.images > 0);
  await page.locator(`.sc-feed .sc-cell[data-fb-node="${shot?.id}"] .sc-cell-open`).click();
  await page.waitForURL(`**/shots/${shot?.id}**`);
  await expect.poll(async () => (await guideRecord(page)).active).toBeNull();
  await expect(coachCard(page)).toHaveCount(0);

  // Opening a shot is not asking to learn refining; using its composer is.
  await page.locator('.sc-ovl .sc-brief-line').click();
  await expect.poll(async () => (await guideRecord(page)).active?.task).toBe('refine');
  await expect(page.locator('.sc-ovl .sc-coach .sc-coach-title')).toHaveText('Change one thing');
  await page.keyboard.type('warmer light');
  await page.getByRole('button', { name: 'Refine', exact: true }).click();
  await expect(page.locator('.sc-ovl .sc-coach .sc-coach-title')).toHaveText('Here is the change', { timeout: 40_000 });
  await page.locator('.sc-ovl .sc-coach').getByRole('button', { name: 'Done' }).click();
  await expect.poll(async () => (await guideRecord(page)).active).toBeNull();
  expect((await guideRecord(page)).done.refine).toBeTruthy();
});

test('a reload lands on the same moment, and the X ends only the guidance', async ({ page }) => {
  const own = await ownBrand(page, 'Reload');
  await page.goto(`/${own}/create`);
  await readTheOpening(page);
  await pickTheIngredients(page);
  await page.reload();
  // the brief survived, so the tutor picks up at the words rather than the start
  await expect(coachTitle(page)).toHaveText('Say how to shoot it, then make it', { timeout: 20_000 });

  await coachCard(page).getByRole('button', { name: 'Close guide' }).click();
  await expect(coachCard(page)).toHaveCount(0);
  await expectLetGo(page);
  await expect(page.getByText('Continue it any time from Learn, under Help.')).toBeVisible();
  // their work is untouched and the page is theirs again
  await expect(chips(page)).toHaveCount(3);
  expect(await isInert(page, '[data-guide="compose.send"]')).toBe(false);
  // the task is paused, not dropped: still in hand, so it can be continued as it was
  const record = await guideRecord(page);
  expect(record.active).toMatchObject({ task: 'first-shot', paused: true });
  expect(record.dismissed).toContain('first-shot');
  // and a reload does not bring the tutor back on its own
  await page.reload();
  await expectNoGuide(page);
});

test('First steps lists four real things, ticks what exists, hides with an Undo', async ({ page }) => {
  await page.goto(`/${slug}`);
  await expect(steps(page).locator('.sc-steps-item')).toHaveText([
    /Make your first shot/,
    /Create a presenter/,
    /Build a scene/,
    /Refine a shot/,
  ]);
  await expect(steps(page).locator('.sc-steps-item[data-state="done"]')).toHaveCount(2);
  await expect(steps(page).locator('.sc-steps-count')).toHaveText('2 of 4');
  await steps(page).getByRole('button', { name: 'Hide first steps' }).click();
  await expect(steps(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(steps(page)).toBeVisible();
});

test('a scene has its own task, held in the dialog it is made in', async ({ page }) => {
  await page.goto(`/${slug}`);
  await steps(page).locator('.sc-steps-item', { hasText: 'Build a scene' }).click();
  await expect(page).toHaveURL(/new=scene/);
  const layer = page.locator('.sc-newdlg-layer');
  await expect(layer.locator('.sc-coach .sc-coach-title')).toHaveText('Build a scene');
  await expect(layer.locator('.sc-coach-veil')).toHaveCount(1);
  // the dialog itself stays usable under the curtain
  await layer.getByPlaceholder('Name this place').fill('Terrace');
  await expect(layer.getByPlaceholder('Name this place')).toHaveValue('Terrace');
  await layer.getByRole('button', { name: 'Close', exact: true }).first().click();
  // closing the dialog does not end the task: First steps continues it
  expect((await guideRecord(page)).active?.task).toBe('scene');
  await expect(steps(page).locator('.sc-steps-item[data-state="active"]')).toHaveText(/Continue your scene/);
});
