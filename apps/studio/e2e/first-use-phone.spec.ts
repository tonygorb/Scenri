import { expect, test } from '@playwright/test';
import { isolate } from './harness.js';
import { chips, coachCard, coachTitle, noWelcomeWait, ownBrand, pickFromPicker, pointsAt } from './firstUse.js';

/**
 * The tutor on a phone (DESIGN.md, "First use"): the same card it is on a
 * desktop, pointing at the same control, with the same words. A phone only
 * changes where there is room for it, never what it is, so every moment is
 * checked here the way it is checked at 1440: whole on screen, clear of what
 * it asks about, and its pointer on the thing itself.
 */
isolate({ brand: false, env: { SCENRI_NO_GUIDE: '0' } });
test.describe.configure({ mode: 'serial' });

/** What a card must be at any moment, plus the size a thumb needs. */
async function card(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const el = document.querySelector<HTMLElement>('.sc-coach');
    if (!el) return null;
    const c = el.getBoundingClientRect();
    const lit = [...document.querySelectorAll<HTMLElement>('[data-guide-stage]')].map((s) => s.getBoundingClientRect());
    const buttons = [...el.querySelectorAll<HTMLElement>('button:not(.sc-coach-x)')].map(
      (b) => b.getBoundingClientRect().height,
    );
    return {
      onScreen: c.left >= 0 && c.top >= 0 && c.right <= innerWidth && c.bottom <= innerHeight,
      clear: lit.every((t) => c.bottom <= t.top + 1 || c.top >= t.bottom - 1 || c.right <= t.left + 1),
      touchable: buttons.every((h) => h >= 44),
      hasClose: !!el.querySelector('.sc-coach-x'),
    };
  });
}

const good = { onScreen: true, clear: true, touchable: true, hasClose: true };

test('every moment is the same card it is on a desktop, whole and clear of its target', async ({ page }) => {
  test.setTimeout(60_000);
  await noWelcomeWait(page);
  await page.setViewportSize({ width: 390, height: 844 });
  const slug = await ownBrand(page, 'Pocket');
  // The welcome is its own dialog and holds the page first; this is the walk after it.
  await page.request.post('/api/guide', { data: { welcome: 'declined' } });
  await page.goto(`/${slug}/create`);

  // The greeting, with nothing to point at: centred on the page it arrived on.
  await expect(coachTitle(page)).toContainText('This is Create', { timeout: 20_000 });
  await expect(coachCard(page)).toHaveAttribute('data-side', 'centre');
  await expect.poll(() => card(page)).toEqual(good);
  await coachCard(page).getByRole('button', { name: 'Start' }).click();

  // The ask before the picker points at the one control it is about.
  await expect(coachTitle(page)).toHaveText('Choose a product');
  await pointsAt(page, '[data-guide="compose.add"]');
  await page.locator('[data-guide="compose.add"]').click();

  // The picker, which the card stands clear of at every kind.
  for (const kind of ['Product', 'Presenter', 'Scene'] as const) {
    await expect.poll(() => card(page)).toEqual(good);
    await pickFromPicker(page, kind);
  }

  // The writing moment: the line being written in is not behind the card.
  await expect(coachTitle(page)).toHaveText('Say how to shoot it, then make it');
  await expect(chips(page)).toHaveCount(3);
  await expect.poll(() => card(page)).toEqual(good);
});

test('a screen shortened the way a keyboard shortens it keeps the card whole', async ({ page }) => {
  await noWelcomeWait(page);
  await page.setViewportSize({ width: 390, height: 844 });
  const slug = await ownBrand(page, 'Thumbs');
  await page.request.post('/api/guide', { data: { welcome: 'declined' } });
  await page.goto(`/${slug}/create`);
  await expect(coachTitle(page)).toContainText('This is Create', { timeout: 20_000 });
  // Playwright cannot raise a keyboard, and a shortened screen is what one does.
  await page.setViewportSize({ width: 390, height: 500 });
  await expect.poll(() => card(page)).toEqual(good);
});
