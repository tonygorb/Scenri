import { test, expect } from '@playwright/test';
import { isolate } from './harness.js';
import {
  coachCard,
  coachTitle,
  expectHeld,
  isInert,
  noWelcomeWait,
  pickFromPicker,
  setUpBrand,
  welcome,
} from './firstUse.js';

/**
 * One action at a time, and only that one (DESIGN.md, "First use"): at every
 * moment of the first shot, exactly what the tutor asks for can be used and
 * everything else is held, including the rest of the picker.
 */
isolate({ brand: false, env: { SCENRI_NO_GUIDE: '0' } });

test('only the one action', async ({ page }) => {
  test.setTimeout(90_000);
  await noWelcomeWait(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  const slug = await setUpBrand(page, 'Locked');
  await welcome(page).getByRole('button', { name: 'Make your first shot' }).click();
  await page.waitForURL(`**/${slug}/create`);
  await expect(coachTitle(page)).toContainText('This is Create');
  await expectHeld(page);
  // the opening holds everything: the only thing to do is read it
  for (const sel of ['.sc-topbar', '[data-guide="compose.add"]', '[data-guide="compose.send"]'])
    expect(await isInert(page, sel), sel).toBe(true);
  await coachCard(page).getByRole('button', { name: 'Start' }).click();

  await expect(coachTitle(page)).toHaveText('Choose a product');
  expect(await isInert(page, '[data-guide="compose.add"]')).toBe(false);
  for (const sel of ['[data-guide="compose"] .sc-brief-line', '[data-guide="compose.send"]', '.sc-topbar'])
    expect(await isInert(page, sel), sel).toBe(true);

  await page.locator('[data-guide="compose.add"]').click();
  await expect(coachCard(page)).toHaveAttribute('data-state', 'shown');
  await expect.poll(() => isInert(page, '.sc-attachpanel .sc-ap-head')).toBe(true);
  // inside the picker: the shelf, and nothing else
  expect(await isInert(page, '.sc-attachpanel .sc-ap-body')).toBe(false);
  for (const sel of ['.sc-attachpanel .sc-ap-head', '[data-guide="compose.add"]'])
    expect(await isInert(page, sel), sel).toBe(true);
  // search, Upload image and the picker's own close are not this moment's business
  expect(await page.locator('.sc-ap-head button:not([inert] *)').count()).toBe(0);

  await pickFromPicker(page, 'Product');
  await pickFromPicker(page, 'Presenter');
  await pickFromPicker(page, 'Scene');
  // The last moment is both halves of one act: write the line, then make it.
  // Those two are usable, the rest of the page is not.
  await expect(coachTitle(page)).toHaveText('Say how to shoot it, then make it');
  await expect.poll(() => page.evaluate(() => document.activeElement?.className ?? '')).toContain('sc-brief-line');
  for (const sel of ['[data-guide="compose"] .sc-brief-line', '[data-guide="compose.send"]'])
    expect(await isInert(page, sel), sel).toBe(false);
  for (const sel of ['[data-guide="compose.add"]', '.sc-topbar', '[data-guide="compose.settings-row"]'])
    expect(await isInert(page, sel), sel).toBe(true);
  await page.keyboard.type('at dusk');
  await expect(coachTitle(page)).toHaveText('Say how to shoot it, then make it');
});
