import { test, expect } from '@playwright/test';
import { isolate } from './harness.js';
import {
  brief,
  pickFromPicker,
  takeWhatIsOffered,
  chips,
  coachBody,
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

test('the brief is built with them a part at a time, each theirs to pick or ours to take, and the shot is on us', async ({
  page,
}) => {
  test.setTimeout(90_000);
  slug = await setUpBrand(page, 'First Light');
  await expect(welcome(page)).toBeVisible();
  // the welcome is held behind the guide's own curtain, not the light dialog scrim
  await expect(page.locator('.sc-newdlg-scrim[data-tone="guide"]')).toHaveCSS('backdrop-filter', 'blur(6px)');
  await welcome(page).getByRole('button', { name: 'Make your first shot' }).click();
  await page.waitForURL(`**/${slug}/create`);

  // Nothing is in the brief until they put it there: the first part is asked for.
  await expect(coachTitle(page)).toHaveText('Start with what you are shooting');
  await expect(chips(page)).toHaveCount(0);
  await pointsAt(page, '[data-guide="compose.add"]');
  await expectHeld(page);
  await expect(page.locator('.sc-coach-veil')).toHaveCSS('backdrop-filter', 'blur(6px)');
  // the composer stays in view whole, and only the part being added can be used
  expect(await page.locator('[data-guide="compose"] .sc-promptcard').getAttribute('data-guide-stage')).toBe('');
  expect(await isInert(page, '.sc-topbar')).toBe(true);
  expect(await isInert(page, '[data-guide="compose.send"]')).toBe(true);

  // Their own pick answers it: the picker opens on the kind being asked for,
  // the guide follows into it, and both move on together.
  const panel = page.locator('.sc-attachpanel');
  await page.locator('[data-guide="compose.add"]').click();
  await expect(coachCard(page)).toHaveAttribute('data-side', 'right');
  expect(await isInert(page, '.sc-attachpanel')).toBe(false);
  await expect(panel.getByRole('tab', { name: /^Products/ })).toHaveAttribute('aria-selected', 'true');
  await pickFromPicker(page, 'Product');
  await expect(chips(page)).toHaveCount(1);
  await expect(coachTitle(page)).toHaveText('Now who shows it');
  await expect(panel.getByRole('tab', { name: /^Presenters/ })).toHaveAttribute('aria-selected', 'true');

  // Or ours is taken with one press, and lands in the brief the same way.
  await coachCard(page).getByRole('button', { name: 'Use ours' }).click();
  await expect(chips(page)).toHaveCount(2);
  await expect(coachTitle(page)).toHaveText('And where it happens');
  await expect(panel.getByRole('tab', { name: /^Scenes/ })).toHaveAttribute('aria-selected', 'true');
  await coachCard(page).getByRole('button', { name: 'Use ours' }).click();
  await expect(chips(page)).toHaveCount(3);
  // with nothing left to add, Next is what closes the picker
  await coachCard(page).getByRole('button', { name: 'Next' }).click();
  await expect(panel).toHaveCount(0);

  // The words are written for them when they ask, and the settings come with them.
  await expect(coachTitle(page)).toHaveText('Say how to shoot it');
  await pointsAt(page, '[data-guide="compose"] .sc-brief-line');
  await coachCard(page).getByRole('button', { name: 'Write one for me' }).click();
  expect(((await brief(page).textContent()) ?? '').length).toBeGreaterThan(120);
  await expect(coachTitle(page)).toHaveText('Set to suit this shot');
  await pointsAt(page, '[data-guide="compose.settings-row"]');
  // the settings are theirs to open, and the popover belongs to the step
  await page.locator('[data-guide="compose.shape"]').click();
  await expect(coachCard(page)).toHaveAttribute('data-state', 'shown');
  expect(await isInert(page, '.sc-setpop[data-state="open"]')).toBe(false);
  await page.keyboard.press('Escape');
  await expect(coachTitle(page)).toHaveText('Set to suit this shot');

  // A product of their own means this one is generated the real way.
  await coachCard(page).getByRole('button', { name: 'Next' }).click();
  await expect(coachTitle(page)).toHaveText('Make the shot');
  await expect(coachBody(page)).not.toContainText('on us');
  await pointsAt(page, '[data-guide="compose.send"]');
  expect((await guideRecord(page)).activeNodes).toHaveLength(0);
});

test('taking every part Scenri offers makes the first shot on us, with no engine asked', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto(`/${slug}/create`);
  // the brief from the test before was never sent, so this starts from nothing
  await expect(coachTitle(page)).toHaveText('Start with what you are shooting', { timeout: 20_000 });
  await takeWhatIsOffered(page);
  await expect(coachBody(page)).toContainText('on us');
  await page.locator('[data-guide="compose.send"]').click();

  await expect(coachTitle(page)).toHaveText('Your first shot', { timeout: 20_000 });
  await expect(coachCard(page)).toHaveAttribute('data-voice', 'card');
  await expectLetGo(page);
  const record = await guideRecord(page);
  expect(record.done.shot).toBeTruthy();
  expect(record.active?.task).toBe('first-shot');
  const made = record.activeNodes.find((n) => n.status === 'done' && n.images > 0);
  const node = (await (await page.request.get(`/api/nodes/${made?.id}`)).json()) as {
    engineId: string;
    images: string[];
  };
  expect(node.engineId).toBe('local');
  expect(node.images).toHaveLength(1);
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
  await expect(coachTitle(page)).toHaveText('Start with what you are shooting');

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
