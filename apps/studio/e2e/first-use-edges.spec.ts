import { test, expect } from '@playwright/test';
import { isolate } from './harness.js';
import {
  brief,
  chips,
  coachCard,
  coachTitle,
  expectLetGo,
  guideRecord,
  noWelcomeWait,
  ownBrand,
  pickFromPicker,
  pickTheIngredients,
  readTheOpening,
  setUpBrand,
  learnButton,
  learnDialog,
  lessonRow,
  welcome,
} from './firstUse.js';

/**
 * The edges of first use (DESIGN.md, "First use"): someone who is already part
 * way, someone who goes back, someone who presses twice, someone who wanders
 * off. Every moment is derived from what the product holds, so all of these
 * are the same question asked again rather than special cases.
 */
isolate({ brand: false, env: { SCENRI_NO_GUIDE: '0' } });
test.describe.configure({ mode: 'serial' });

test.beforeEach(async ({ page }) => {
  await noWelcomeWait(page);
  await page.setViewportSize({ width: 1440, height: 900 });
});

test('it asks for what is missing, whatever is already there', async ({ page }) => {
  await setUpBrand(page, 'Part Way');
  await welcome(page).locator('.sc-welcome-foot').getByRole('button', { name: 'Not now' }).click();
  // the answer is kept before the next write, or the two race at the server
  await expect.poll(async () => (await guideRecord(page)).welcome).toBe('declined');

  // a brief with a product in it is asked about the presenter, never the product
  const own = await ownBrand(page, 'Halfway');
  await page.goto(`/${own}/create`);
  await readTheOpening(page);
  await page.locator('[data-guide="compose.add"]').click();
  await pickFromPicker(page, 'Product');
  await expect(coachTitle(page)).toHaveText('Choose a presenter');
  await page.reload();
  // coming back to a brief already begun: no opening, and the same ask
  await expect(coachTitle(page)).toHaveText('Choose a presenter', { timeout: 20_000 });

  // a second product of the same kind still answers the ask it was asked for
  await page.locator('[data-guide="compose.add"]').click();
  await pickFromPicker(page, 'Presenter');
  await pickFromPicker(page, 'Scene');
  await expect(coachTitle(page)).toHaveText('Say how to shoot it, then make it');
});

test('there is no Back where nothing can be taken back', async ({ page }) => {
  const own = await ownBrand(page, 'Back Again');
  await page.goto(`/${own}/create`);
  await readTheOpening(page);
  await expect(coachTitle(page)).toHaveText('Choose a product');
  // nothing has been put in the brief yet, so there is nothing for Back to do
  await expect(coachCard(page).getByRole('button', { name: 'Back' })).toHaveCount(0);
  await expect(chips(page)).toHaveCount(0);
});

test('Escape ends the guidance and leaves everything usable', async ({ page }) => {
  const own = await ownBrand(page, 'Escaped');
  await page.goto(`/${own}/create`);
  await readTheOpening(page);
  // Escape belongs to whatever is open: the picker takes the first one.
  await page.locator('[data-guide="compose.add"]').click();
  await expect(page.locator('.sc-attachpanel')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.sc-attachpanel')).toHaveCount(0);
  await expect(coachTitle(page)).toHaveText('Choose a product');
  // with nothing else open it is the way out of the guidance
  await page.keyboard.press('Escape');
  await expect(coachCard(page)).toHaveCount(0);
  await expectLetGo(page);
  expect((await guideRecord(page)).active).toMatchObject({ task: 'first-shot', paused: true });
});

test('pressing twice, wandering off, and coming back all land on the same moment', async ({ page }) => {
  const own = await ownBrand(page, 'Twice');
  await page.goto(`/${own}/create`);
  // Start pressed twice is one advance
  await expect(coachTitle(page)).toContainText('This is Create', { timeout: 20_000 });
  const start = coachCard(page).getByRole('button', { name: 'Start' });
  await start.click();
  await expect(coachTitle(page)).toHaveText('Choose a product');

  // the picker opened and closed again leaves the ask exactly where it was
  await page.locator('[data-guide="compose.add"]').click();
  await expect(page.locator('.sc-attachpanel')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.sc-attachpanel')).toHaveCount(0);
  await expect(coachTitle(page)).toHaveText('Choose a product');

  // away to another page: nothing is drawn there, and coming back resumes
  await page.goto(`/${own}/products`);
  await expect(coachCard(page)).toHaveCount(0);
  await page.goto(`/${own}/create`);
  await expect(coachTitle(page)).toHaveText('Choose a product', { timeout: 20_000 });
});

test('a task belongs to its own brand, and another brand is not guided by it', async ({ page }) => {
  const a = await ownBrand(page, 'Brand A');
  const b = await ownBrand(page, 'Brand B', 'scene');
  await page.goto(`/${a}/create`);
  // the task in hand is brand B's, so brand A shows nothing and has nothing in hand
  await expect(coachCard(page)).toHaveCount(0);
  await page.goto(`/${a}`);
  await learnButton(page).click();
  await expect(learnDialog(page).locator('.sc-learn-status', { hasText: /^Step/ })).toHaveCount(0);
  await page.goto(`/${b}`);
  await learnButton(page).click();
  await expect(lessonRow(page, 'Build a scene').locator('.sc-learn-status')).toHaveText(/^Step \d of 5$/);
});

test('someone who built the brief their own way is not asked for it again', async ({ page }) => {
  const own = await ownBrand(page, 'Own Way');
  await page.goto(`/${own}/create`);
  await readTheOpening(page);
  await pickTheIngredients(page);
  await page.keyboard.type('at dusk');
  // words and ingredients are all there: the only thing left is to make it
  await expect(coachTitle(page)).toHaveText('Say how to shoot it, then make it');
  await expect(brief(page)).toContainText('at dusk');
});

test('Enter makes the shot, and a reload while it draws keeps the wait', async ({ page }) => {
  test.setTimeout(60_000);
  const own = await ownBrand(page, 'By Enter');
  await page.goto(`/${own}/create`);
  await readTheOpening(page);
  await pickTheIngredients(page);
  await page.keyboard.type('at dusk');
  // the product's own rule still holds: Enter in the brief sends it
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await guideRecord(page)).activeNodes.length, { timeout: 20_000 }).toBeGreaterThan(0);
  await expect(coachTitle(page)).toHaveText(/Scenri is making it|Your first shot/, { timeout: 20_000 });

  await page.reload();
  await expect(coachTitle(page)).toHaveText(/Scenri is making it|Your first shot/, { timeout: 30_000 });
});

test('in the walk a chip comes in through its ask and leaves only through Back; Enter on + opens only the picker', async ({
  page,
}) => {
  const slug = await ownBrand(page, 'Quick Hands');
  await page.goto(`/${slug}/create`);
  await readTheOpening(page);
  await expect(coachTitle(page)).toHaveText('Choose a product');
  await expect(coachCard(page)).toHaveAttribute('data-state', 'shown');
  // Enter on the focused + is the +'s own press: Create once also opened
  // whichever shot was selected behind it, and the tutor went with it
  await page.locator('[data-guide="compose.add"]').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.sc-attachpanel')).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/${slug}/create$`));
  for (const kind of ['Product', 'Presenter', 'Scene'] as const) await pickFromPicker(page, kind);
  await expect(coachTitle(page)).toHaveText('Say how to shoot it, then make it');
  // a sigil is a character while the walk is on: no menu, no chip
  await page.keyboard.type(' $ @');
  await expect(page.locator('.sc-cmd')).toHaveCount(0);
  await expect(chips(page)).toHaveCount(3);
  // a chip's own panel changes it but offers no Remove: Back is the one way out
  await chips(page).first().click();
  await expect(page.locator('.sc-swap, .sc-swapsheet').first()).toBeVisible();
  await expect(page.locator('.sc-swap-remove')).toHaveCount(0);
  // and a foot with nothing in it is not drawn as an empty band (one that
  // carries the chip's warning, as the demo engine's does, is still shown)
  await expect(page.locator('.sc-swap .sc-swap-foot:empty')).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(chips(page)).toHaveCount(3);
});
