import { test, expect, type Page } from '@playwright/test';
import { isolate } from './harness.js';
import { chapters, expectOneRhythm, readChapters, settledChapters } from './homeChapters.js';

/**
 * Home is one page in three chapters: the use-case wall with the row that
 * filters it, then the Presenters and Scenes shelves.
 *
 * The shelves used to be bare grids with no air above them: at 2560 they drew
 * seven columns under a five-column wall, each heading sat on the bottom edge
 * of the grid before it, and the wall's filter row stayed stuck over both.
 * Geometry, not pixels, and no card counts assumed: this home carries the
 * bundled catalog, not the full library.
 */

// A Scenri of this file's own, on an empty home, seeded from scratch.
isolate();

async function openHome(page: Page) {
  await page.goto('/');
  // a brand is the whole first segment now: one segment, and not the wizard
  await page.waitForURL((u) => {
    const seg = u.pathname.split('/').filter(Boolean);
    return seg.length === 1 && seg[0] !== 'setup';
  });
  await page.locator('[data-wall] .sc-lookcard').first().waitFor();
}

/** How many a shelf can show: the catalog, as this home serves it. */
async function catalogCounts(page: Page) {
  const presenters = (await (await page.request.get('/api/presenters')).json()).presenters.length as number;
  const scenes = (await (await page.request.get('/api/scenes')).json()).scenes.length as number;
  return { presenters, scenes };
}

test('the shelves share the wall grid and one section beat, in both densities', async ({ page }) => {
  // the width where the shelves drew seven columns under the wall's five
  await page.setViewportSize({ width: 2560, height: 1300 });
  await openHome(page);
  await settledChapters(page);

  const large = await readChapters(page);
  expectOneRhythm(large);
  const { presenters, scenes } = await catalogCounts(page);
  expect(large[1].cards).toBe(Math.min(8, presenters));
  expect(large[2].cards).toBe(Math.min(8, scenes));

  // one Grid size for the whole page: compact reflows the shelves with the wall
  await page.locator('.sc-density-opt[aria-label="Compact"]').click();
  await expect.poll(async () => (await readChapters(page))[1].cards).toBe(Math.min(14, presenters));
  const compact = await readChapters(page);
  expectOneRhythm(compact);
  expect(compact[0].cols).toBeGreaterThan(large[0].cols);
  expect(compact[2].cards).toBe(Math.min(14, scenes));
});

test('a phone-width Home keeps the same beat', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openHome(page);
  await settledChapters(page);
  expectOneRhythm(await readChapters(page));
});

test('the filter row leaves with the wall it filters', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openHome(page);
  await settledChapters(page);

  const rowTop = () =>
    page.evaluate(() => {
      const pane = document.querySelector('.sc-home')!.getBoundingClientRect();
      const row = document.querySelector('.sc-filterbar')!.getBoundingClientRect();
      return { top: Math.round(row.top - pane.top), bottom: Math.round(row.bottom - pane.top) };
    });

  // halfway down the wall the row is stuck under the nav
  await page
    .locator('[data-wall] .sc-lookcard')
    .nth(4)
    .evaluate((c) => c.scrollIntoView({ block: 'start' }));
  expect((await rowTop()).top).toBe(0);

  // once Presenters reaches the top, the row has gone with the wall
  await chapters(page)
    .nth(1)
    .evaluate((s) => s.scrollIntoView({ block: 'start' }));
  expect((await rowTop()).bottom).toBeLessThanOrEqual(0);
});

test('a shelf keeps its heading and the wall grid while its cards load', async ({ page }) => {
  await page.setViewportSize({ width: 1728, height: 1000 });
  let release!: () => void;
  const held = new Promise<void>((r) => {
    release = r;
  });
  await page.route('**/api/presenters', async (route) => {
    await held;
    await route.continue();
  });
  await openHome(page);

  const shelf = chapters(page).nth(1);
  await expect(shelf.locator('h2')).toHaveText('Presenters');
  await expect(shelf.locator('.sc-masonry[aria-hidden]')).toBeVisible();
  const loading = await readChapters(page);
  expect(loading[1].cols).toBe(loading[0].cols);
  const headTop = await shelf.locator('h2').evaluate((h) => Math.round(h.getBoundingClientRect().top));

  release();
  await expect(shelf.locator('.sc-masonry[aria-hidden]')).toHaveCount(0);
  await expect(shelf.locator('.sc-lookcard').first()).toBeVisible();
  // the heading was there all along, so nothing above the grid moved
  expect(await shelf.locator('h2').evaluate((h) => Math.round(h.getBoundingClientRect().top))).toBe(headTop);
});
