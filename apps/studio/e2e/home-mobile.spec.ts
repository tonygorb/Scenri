import { test, expect, type Page } from '@playwright/test';
import { isolate } from './harness.js';

/**
 * Home without the dock.
 *
 * On a phone the docked composer is unmounted and a showcase tile deep-links
 * into Create via `?showcase=` — Create applies the recipe and fires the one
 * "Starting from" toast. A tablet keeps the desktop grammar: the tile stages
 * into the dock in place and nothing navigates.
 *
 * Runs on the mobile (Pixel 5) and tablet (iPad Mini landscape) projects; the
 * tablet leg doubles as the ≥768px-unchanged guard.
 */

// A scenri of this file's own, on an empty home, seeded from scratch.
isolate();

const dock = (p: Page) => p.locator('.sc-canvas-dock');
const tile = (p: Page) => p.locator('[data-wall] .sc-lookcard').first();
const startToast = (p: Page) => p.locator('.sc-toast', { hasText: 'Starting from' });

const isPhone = (p: Page) => (p.viewportSize()?.width ?? 0) < 768;

/** Touch grammar everywhere on the wall: first tap arms, the pill fires. */
async function recreateFirstTile(p: Page) {
  const card = tile(p);
  await card.locator('.sc-lookcard-open').tap();
  await expect(card).toHaveAttribute('data-armed', 'true');
  await card.locator('.sc-lookcard-use').tap();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  // a brand is the whole first segment now: one segment, and not the wizard
  await page.waitForURL((u) => {
    const seg = u.pathname.split('/').filter(Boolean);
    return seg.length === 1 && seg[0] !== 'setup';
  });
  await tile(page).waitFor();
});

test('a phone hides the dock and a tile opens Create', async ({ page }) => {
  test.skip(!isPhone(page), 'the dock stays docked from 768px up');

  // unmounted, not hidden — nothing focusable left behind
  await expect(dock(page)).toHaveCount(0);
  await expect(page.locator('.sc-dock-fade')).toHaveCount(0);

  // the 230px reserved for the dock came back to the scroll
  const padding = await page
    .locator('.sc-main')
    .evaluate((el) => Number.parseFloat(getComputedStyle(el).paddingBottom));
  expect(padding).toBeLessThan(100);

  await recreateFirstTile(page);
  await page.waitForURL((u) => u.pathname.endsWith('/create'));

  // Create's apply fires the toast — exactly once (Home's staging toast must
  // not also fire on this path). Immediate count, not toHaveCount: a duplicate
  // that expires would otherwise slip past the poll.
  await expect(startToast(page).first()).toBeVisible();
  expect(await startToast(page).count()).toBe(1);

  // the recipe landed and Create still has its own dock
  await expect(dock(page)).toBeVisible();
});

test('a tablet keeps the docked composer on Home', async ({ page }) => {
  test.skip(isPhone(page), 'phones trade the dock for navigation');

  await expect(dock(page)).toBeVisible();

  const hub = new URL(page.url()).pathname;
  await recreateFirstTile(page);

  // staged in place: Home's toast, no navigation
  await expect(startToast(page).first()).toBeVisible();
  expect(new URL(page.url()).pathname).toBe(hub);
  await expect(dock(page)).toBeVisible();
});
