import { test, expect } from '@playwright/test';
import { isolate } from './harness.js';
import {
  brief,
  chips,
  coachBody,
  coachCard,
  coachTitle,
  expectHeld,
  expectNoGuide,
  guideRecord,
  isInert,
  noWelcomeWait,
  pickFromPicker,
  setUpBrand,
  takeWhatIsOffered,
  steps,
  welcome,
} from './firstUse.js';

/**
 * The first shot when it is not on us and not going well: the welcome
 * declined, a brief changed so the shot is really generated, every take
 * refused by the engine, a phone, and a brief emptied back to nothing.
 */
isolate({ brand: false, env: { SCENRI_NO_GUIDE: '0', SCENRI_DEMO_FAIL_SLOT: '0' } });
test.describe.configure({ mode: 'serial' });

let slug = '';

/** A brand of this test's own, with the first shot in hand: no state from the test before. */
async function ownBrand(page: import('@playwright/test').Page, name: string): Promise<string> {
  const made = await page.request.post('/api/brands', {
    data: { brand: { specVersion: '0.1', meta: { name }, products: [{ id: 'lamp', name: 'Ribbed lamp' }] } },
  });
  const { id } = (await made.json()) as { id: string };
  const brands = (await (await page.request.get('/api/brands')).json()) as { id: string; slug: string }[];
  await page.request.post('/api/guide', { data: { start: { task: 'first-shot', brandId: id } } });
  return brands.find((b) => b.id === id)?.slug as string;
}

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

test('a brief of their own is really generated, and a take that fails is said on its tile', async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/${slug}`);
  await steps(page).locator('.sc-steps-item', { hasText: 'First shot' }).click();
  await expect(coachTitle(page)).toHaveText('Start with what you are shooting', { timeout: 20_000 });

  // Their own pick for every part, so Scenri has no picture for this one: it
  // goes to the engine, which refuses it.
  await page.locator('[data-guide="compose.add"]').click();
  await pickFromPicker(page, 'Product');
  await expect(coachTitle(page)).toHaveText('Now who shows it');
  await pickFromPicker(page, 'Presenter');
  await expect(coachTitle(page)).toHaveText('And where it happens');
  await pickFromPicker(page, 'Scene');
  await coachCard(page).getByRole('button', { name: 'Next' }).click();
  await expect(page.locator('.sc-attachpanel')).toHaveCount(0);
  await expect(chips(page)).toHaveCount(3);

  await expect(coachTitle(page)).toHaveText('Say how to shoot it');
  await brief(page).click();
  await page.keyboard.type('at dusk, by the window');
  await coachCard(page).getByRole('button', { name: 'Next' }).click();
  await expect(coachTitle(page)).toHaveText('Set to suit this shot');
  // one take, so the one refused slot is the whole take
  await page.locator('[data-guide="compose.count"]').click();
  await page.locator('.sc-setpop[data-state="open"] [role="radio"]').first().click();
  await coachCard(page).getByRole('button', { name: 'Next' }).click();
  await expect(coachTitle(page)).toHaveText('Make the shot');
  await expect(coachBody(page)).not.toContainText('on us');
  await page.locator('[data-guide="compose.send"]').click();

  await expect(coachTitle(page)).toHaveText("That one didn't work", { timeout: 20_000 });
  await expect(coachCard(page)).toHaveAttribute('data-voice', 'card');
  const record = await guideRecord(page);
  expect(record.done.shot).toBeUndefined();
  expect(record.active?.task).toBe('first-shot');

  await page.reload();
  await expect(coachTitle(page)).toHaveText("That one didn't work");

  // The send emptied the brief, so building again starts from the first part.
  await page.locator('[data-guide="compose.add"]').click();
  await expect(coachTitle(page)).toHaveText('Start with what you are shooting');
  await expect(coachCard(page)).toHaveAttribute('data-side', 'right');
  await expectHeld(page);
});

test('on a phone the coach follows into the picker above it, and every card fits the screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const own = await ownBrand(page, 'Phone Take');
  await page.goto(`/${own}/create`);
  await expect(coachTitle(page)).toHaveText('Start with what you are shooting', { timeout: 20_000 });
  await page.locator('[data-guide="compose.add"]').click();
  await expect(coachCard(page)).toHaveAttribute('data-side', 'top');
  await expect(coachCard(page)).toHaveAttribute('data-state', 'shown');
  const fit = await page.evaluate(() => {
    const c = document.querySelector('.sc-coach')?.getBoundingClientRect();
    const p = document.querySelector('.sc-attachpanel')?.getBoundingClientRect();
    if (!c || !p) return null;
    return { inside: c.left >= 0 && c.right <= innerWidth && c.top >= 0, above: c.bottom <= p.top };
  });
  expect(fit).toEqual({ inside: true, above: true });

  // a phone's picker closes from the card's own Next, and from the composer's toggle
  await page.locator('[data-guide="compose.add"]').click();
  await expect(page.locator('.sc-attachpanel')).toHaveCount(0);
  await expect(coachCard(page)).toHaveAttribute('data-state', 'shown');
  const c = await coachCard(page).boundingBox();
  expect(c && c.x >= 0 && c.x + c.width <= 390 && c.y >= 0 && c.y + c.height <= 844).toBe(true);
});

test('a narrow composer says the settings at its one control, which stays theirs to open', async ({ page }) => {
  test.setTimeout(60_000);
  const shells: [number, number, string][] = [
    [900, 800, '.sc-morepop'],
    [390, 844, '.sc-shotsheet'],
  ];
  for (const [width, height, shell] of shells) {
    await page.setViewportSize({ width, height });
    const own = await ownBrand(page, `Narrow ${width}`);
    await page.goto(`/${own}/create`);
    await expect(coachTitle(page)).toHaveText('Start with what you are shooting', { timeout: 20_000 });
    await takeWhatIsOffered(page);
    await coachCard(page).getByRole('button', { name: 'Back' }).click();
    await expect(coachTitle(page)).toHaveText('Set to suit this shot');
    // the brief is not what this step is about, so it cannot be used
    expect(await isInert(page, '[data-guide="compose"] .sc-brief-line')).toBe(true);
    await page.locator('[data-guide="compose.settings"]').click();
    const open = page.locator(`${shell}[data-state="open"]`);
    await expect(open).toBeVisible();
    // what the control opened is part of the step, never a dialog that pauses it
    await expect(coachTitle(page)).toHaveText('Set to suit this shot');
    await open.locator('[role="radio"]').first().click();
    await page.keyboard.press('Escape');
    await expect(open).toHaveCount(0);
    await coachCard(page).getByRole('button', { name: 'Next' }).click();
    await expect(coachTitle(page)).toHaveText('Make the shot');
  }
});

test('what Scenri put in is theirs to take out, and the guide asks for it again', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const own = await ownBrand(page, 'Empty It');
  await page.goto(`/${own}/create`);
  await expect(coachTitle(page)).toHaveText('Start with what you are shooting', { timeout: 20_000 });
  for (const label of ['Use ours', 'Use ours', 'Use ours']) {
    await coachCard(page).getByRole('button', { name: label }).click();
    await page.waitForTimeout(150);
  }
  await expect(chips(page)).toHaveCount(3);
  await expect(coachTitle(page)).toHaveText('Say how to shoot it');
  await brief(page).click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('Backspace');
  await expect(chips(page)).toHaveCount(0);
  await expect(coachTitle(page)).toHaveText('Start with what you are shooting');
});
