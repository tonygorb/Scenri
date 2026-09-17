import { expect, test } from '@playwright/test';
import { isolate } from './harness.js';
import { chips, coachCard, coachTitle, noWelcomeWait, ownBrand, pickFromPicker } from './firstUse.js';

/**
 * The tutor on a phone (DESIGN.md, "First use"): a sheet on the bottom edge,
 * never a callout floating over a four-inch canvas. What it asks about is lit
 * in place and the sheet sits above it, so the control or the field being
 * asked for is never behind the words (WCAG 2.4.11). Its buttons keep a 44px
 * touch target, and it clears the home indicator.
 */
isolate({ brand: false, env: { SCENRI_NO_GUIDE: '0' } });
test.describe.configure({ mode: 'serial' });

/** The sheet, what it must not cover, and the size of what a thumb has to hit. */
async function sheet(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const card = document.querySelector<HTMLElement>('.sc-coach');
    if (!card) return null;
    const c = card.getBoundingClientRect();
    const lit = [...document.querySelectorAll<HTMLElement>('[data-guide-stage]')].map((el) =>
      el.getBoundingClientRect(),
    );
    const buttons = [...card.querySelectorAll<HTMLElement>('button')].map((b) => b.getBoundingClientRect().height);
    return {
      side: card.dataset.side ?? '',
      onScreen: c.left >= 0 && c.top >= 0 && c.right <= innerWidth && c.bottom <= innerHeight,
      // Edge to edge: a sheet, not a callout floating over the page.
      wide: Math.round(c.left) === 0 && Math.round(c.right) === innerWidth,
      // Resting on something: the bottom edge, or the top of whatever is lit
      // below it, with nothing between them.
      snug: Math.round(innerHeight - c.bottom) <= 2 || lit.some((t) => Math.abs(Math.round(t.top - c.bottom)) <= 2),
      clear: lit.every((t) => c.bottom <= t.top + 1 || c.top >= t.bottom - 1),
      touchable: buttons.every((h) => h >= 44),
      hasClose: !!card.querySelector('.sc-coach-x'),
    };
  });
}

const docked = {
  side: 'sheet',
  onScreen: true,
  wide: true,
  snug: true,
  clear: true,
  touchable: true,
  hasClose: true,
};

test('every moment of the first shot is a sheet that clears what it asks about', async ({ page }) => {
  test.setTimeout(60_000);
  await noWelcomeWait(page);
  await page.setViewportSize({ width: 390, height: 844 });
  const slug = await ownBrand(page, 'Pocket');
  // The welcome is its own dialog and holds the page first; this is the walk after it.
  await page.request.post('/api/guide', { data: { welcome: 'declined' } });
  await page.goto(`/${slug}/create`);

  // The greeting, with nothing to point at.
  await expect(coachTitle(page)).toContainText('This is Create', { timeout: 20_000 });
  await expect.poll(() => sheet(page)).toEqual(docked);
  await coachCard(page).getByRole('button', { name: 'Start' }).click();

  // The ask before the picker: the composer is lit at the bottom, the sheet above it.
  await expect(coachTitle(page)).toHaveText('Choose a product');
  await expect.poll(() => sheet(page)).toEqual(docked);
  await page.locator('[data-guide="compose.add"]').click();

  // The picker, which takes the bottom of the screen for itself.
  for (const kind of ['Product', 'Presenter', 'Scene'] as const) {
    await expect.poll(() => sheet(page)).toEqual(docked);
    await pickFromPicker(page, kind);
  }

  // The writing moment: the sheet must not sit over the line being written in.
  await expect(coachTitle(page)).toHaveText('Say how to shoot it, then make it');
  await expect(chips(page)).toHaveCount(3);
  await expect.poll(() => sheet(page)).toEqual(docked);
});

test('a screen shortened the way a keyboard shortens it keeps the sheet whole', async ({ page }) => {
  await noWelcomeWait(page);
  await page.setViewportSize({ width: 390, height: 844 });
  const slug = await ownBrand(page, 'Thumbs');
  await page.request.post('/api/guide', { data: { welcome: 'declined' } });
  await page.goto(`/${slug}/create`);
  await expect(coachTitle(page)).toContainText('This is Create', { timeout: 20_000 });
  // Playwright cannot raise a keyboard, and a shortened screen is what one does.
  await page.setViewportSize({ width: 390, height: 500 });
  await expect.poll(async () => (await sheet(page))?.onScreen).toBe(true);
  await expect.poll(() => sheet(page)).toEqual(docked);
});
