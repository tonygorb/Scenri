import { test, expect } from '@playwright/test';
import { isolate } from './harness.js';
import {
  answerSettings,
  brief,
  coachCard,
  coachTitle,
  expectHeld,
  expectNoGuide,
  guideRecord,
  isInert,
  noWelcomeWait,
  pickOneOfEach,
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

test('a take that fails is said on its tile, survives a reload, and building again resumes the guide', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/${slug}`);
  await steps(page).locator('.sc-steps-item', { hasText: 'First shot' }).click();
  await expect(coachTitle(page)).toHaveText('Add your ingredients');
  await page.locator('[data-guide="compose.add"]').click();
  await pickOneOfEach(page);
  await coachCard(page).getByRole('button', { name: 'Continue' }).click();
  await brief(page).click();
  await page.keyboard.press('End');
  await page.keyboard.type(' at dusk');
  await page.keyboard.press('Enter');
  await answerSettings(page);
  await page.locator('[data-guide="compose.send"]').click();

  await expect(coachTitle(page)).toHaveText("That one didn't work", { timeout: 15_000 });
  await expect(coachCard(page)).toHaveAttribute('data-voice', 'card');
  const record = await guideRecord(page);
  expect(record.done.shot).toBeUndefined();
  expect(record.active?.task).toBe('first-shot');

  await page.reload();
  await expect(coachTitle(page)).toHaveText("That one didn't work");

  await page.locator('[data-guide="compose.add"]').click();
  await expect(coachTitle(page)).toHaveText('Add a product, a presenter and a scene');
  await expectHeld(page);
});

test('on a phone the coach follows into the picker above it, and every card fits the screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/${slug}/create`);
  await page.locator('[data-guide="compose.add"]').click();
  await expect(coachTitle(page)).toHaveText('Add a product, a presenter and a scene');
  await expect(coachCard(page)).toHaveAttribute('data-side', 'top');
  await expect(coachCard(page)).toHaveAttribute('data-state', 'shown');
  const fit = await page.evaluate(() => {
    const c = document.querySelector('.sc-coach')?.getBoundingClientRect();
    const p = document.querySelector('.sc-attachpanel')?.getBoundingClientRect();
    if (!c || !p) return null;
    return { inside: c.left >= 0 && c.right <= innerWidth && c.top >= 0, above: c.bottom <= p.top };
  });
  expect(fit).toEqual({ inside: true, above: true });

  // a phone's picker closes from the composer's own toggle
  await page.locator('[data-guide="compose.add"]').click();
  await expect(page.locator('.sc-attachpanel')).toHaveCount(0);
  await expect(coachCard(page)).toHaveAttribute('data-state', 'shown');
  const c = await coachCard(page).boundingBox();
  expect(c && c.x >= 0 && c.x + c.width <= 390 && c.y >= 0 && c.y + c.height <= 844).toBe(true);
});

test('a narrow composer asks shape, number and size at its one settings control, and it has to be opened and answered', async ({
  page,
}) => {
  test.setTimeout(60_000);
  const shells: [number, number, string][] = [
    [900, 800, '.sc-morepop'],
    [390, 844, '.sc-shotsheet'],
  ];
  for (const [width, height, shell] of shells) {
    await page.setViewportSize({ width, height });
    await page.goto(`/${slug}/create`);
    await expect(coachCard(page)).toHaveAttribute('data-state', 'shown');
    // build the brief the way the guide asks, from wherever the last test left it
    for (let i = 0; i < 20; i++) {
      const now = await coachTitle(page).textContent();
      if (now === 'Describe the shot') break;
      const pickerOpen = (await page.locator('.sc-attachpanel').count()) > 0;
      if (now === "That one didn't work" || (!pickerOpen && /^(Add your ingredients|Now add)/.test(now ?? '')))
        await page.locator('[data-guide="compose.add"]').click();
      else if (pickerOpen && /^Add a /.test(now ?? '')) await pickOneOfEach(page);
      else if (await coachCard(page).getByRole('button', { name: 'Continue' }).isVisible())
        await coachCard(page).getByRole('button', { name: 'Continue' }).click();
      await page.waitForTimeout(200);
    }
    await expect(coachTitle(page)).toHaveText('Describe the shot');
    if (!(await brief(page).textContent())?.includes('dusk')) {
      await brief(page).click();
      await page.keyboard.press('End');
      await page.keyboard.type(' at dusk');
    }
    await coachCard(page).getByRole('button', { name: 'Continue' }).click();

    await expect(coachTitle(page)).toHaveText('Choose shape, number and size');
    // the brief is not what this step asks for, so it cannot be used
    expect(await isInert(page, '[data-guide="compose"] .sc-brief-line')).toBe(true);
    await page.locator('[data-guide="compose.settings"]').click();
    const open = page.locator(`${shell}[data-state="open"]`);
    await expect(open).toBeVisible();
    // what the control opened is part of the step, never a dialog that pauses it
    await expect(coachTitle(page)).toHaveText('Choose shape, number and size');
    await open.locator('[role="radio"][aria-checked="true"]').first().click();
    await page.keyboard.press('Escape');
    await expect(open).toHaveCount(0);
    await expect(coachTitle(page)).toHaveText('Make it');
  }
});
