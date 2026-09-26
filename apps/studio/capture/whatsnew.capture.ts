import { type APIRequestContext, expect, test } from '@playwright/test';
import { isolate } from '../e2e/harness.js';
import { prep } from '../visual/shared.js';
import { seedBrand, seedScene, shoot, stubLocalAccess } from './shoot.js';

/**
 * The What's New pictures, one test per file, named as the file is:
 * `pnpm capture:whatsnew -g 0.19.0` shoots one release's. An empty home and a
 * public fictional brand from the demo catalog, so no library of anyone's shows.
 */
isolate({ brand: false });

let seeded: Promise<{ id: string; slug: string }> | null = null;
const brand = (request: APIRequestContext) => {
  seeded ??= seedBrand(request, 'Aldergate');
  return seeded;
};

test('0.19.0-home-examples', async ({ page, request }) => {
  const { slug } = await brand(request);
  // Tall enough that the composer, which floats at the bottom, stays under the frame.
  await page.setViewportSize({ width: 1440, height: 1200 });
  await prep(page, 'dark');
  await page.goto(`/${slug}`);
  const wall = page.locator('.sc-masonry[data-wall] img');
  await expect(wall.first()).toBeVisible();
  // The examples themselves, large: the kinds of example above them, three full
  // cards, and the next row starting, so it reads as a wall rather than a page.
  // A masonry wall is not in row order in the document, so the first row is read by position.
  const tabs = await page.getByText('All examples', { exact: true }).first().boundingBox();
  // the pictures themselves, not the presenter faces pinned on some of them
  const boxes = (await Promise.all((await wall.all()).slice(0, 24).map((l) => l.boundingBox()))).filter(
    (b): b is NonNullable<typeof b> => b !== null && b.width > 150,
  );
  const top = Math.min(...boxes.map((b) => b.y));
  const row = boxes.filter((b) => b.y - top < 24).sort((a, b) => a.x - b.x);
  if (!tabs || row.length < 3) throw new Error('Home did not lay out');
  const [first, , third] = row;
  // Edges in the gutters: nothing of a fourth card shows at the side.
  const x = first.x - 8;
  const width = Math.floor((third.x + third.width + 8 - x) / 8) * 8;
  await shoot(page, '0.19.0-home-examples', { x, y: tabs.y - 16, width, height: (width * 5) / 8 }, { pad: 0 });
});

test('0.19.0-use-this-view', async ({ page, request }) => {
  const { slug } = await brand(request);
  await prep(page, 'dark');
  await page.goto(`/${slug}/scenes/waterline-caustics`);
  const tiles = page.locator('.sc-refset li');
  await expect(tiles.nth(2)).toBeVisible();
  // the scene's name down to its pictures' captions: the rail alone is too wide for 16:10
  const title = await page.locator('main h1').boundingBox();
  const rail = await page.locator('.sc-refset-rail').boundingBox();
  if (!title || !rail) throw new Error('the scene page did not lay out');
  const top = title.y - 12;
  await shoot(
    page,
    '0.19.0-use-this-view',
    { x: rail.x, y: top, width: rail.width, height: rail.y + rail.height + 24 - top },
    { pad: 0, hover: tiles.nth(1).locator('.sc-sceneview-frame') },
  );
});

test('0.17.0-select-scenes', async ({ page, request }) => {
  const { id, slug } = await brand(request);
  // two full rows of the compact wall, so the bar sits on the divider and no catalog card shows
  const scenes = [
    'clay-court',
    'chalk-steps',
    'hand-studio',
    'paper-garden',
    'martini-hour',
    'glass-block-room',
    'tonal-apricot-ledge',
    'sunlit-color-field',
    'palm-shade-garden',
    'linen-morning-room',
    'waterline-caustics',
    'travertine-window-light',
  ];
  for (const s of scenes) await seedScene(request, id, s);
  await prep(page, 'dark');
  await page.goto(`/${slug}/scenes`);
  const cards = page.locator('.sc-owned .sc-lookcard');
  await expect(cards.locator('img')).toHaveCount(scenes.length);
  await page.getByRole('radio', { name: /Compact/ }).click();
  for (const n of [7, 8, 10]) await cards.nth(n).locator('.sc-lookcard-pick').click();
  await expect(page.locator('.sc-picked-n')).toContainText('3');
  // the second row's middle four and the bar under them, edges in the gutters between columns
  const row = [7, 8, 9, 10].map((n) => cards.nth(n));
  await shoot(page, '0.17.0-select-scenes', [...row, page.locator('.sc-picked')], {
    pad: 10,
    align: ['center', 'end'],
  });
});

test('0.16.0-local-access', async ({ page, request }) => {
  const { slug } = await brand(request);
  await stubLocalAccess(page, new Date('2026-08-18T12:00:00').getTime());
  await prep(page, 'dark');
  await page.goto(`/${slug}?settings=phone`);
  const dialog = page.getByRole('dialog');
  await expect(dialog.locator('.sc-phone')).toBeVisible();
  // Settings from under the top bar down to the line under the QR code: New code and This computer
  // are not this release's, and a band above the top bar's edge would carry its tab underline
  const panel = await dialog.locator('.sc-newdlg').boundingBox();
  const bar = await page.locator('.sc-topbar').boundingBox();
  const next = await dialog.locator('.sc-phone + .sc-set-row b').boundingBox();
  if (!panel || !bar || !next) throw new Error('Settings did not lay out');
  const room = next.y - 1 - (bar.y + bar.height + 1);
  const width = Math.floor((room * 1.6) / 8) * 8;
  const height = (width * 5) / 8;
  const x = panel.x + (panel.width - width) / 2;
  const y = bar.y + bar.height + 1 + (room - height) / 2;
  await shoot(page, '0.16.0-local-access', { x, y, width, height }, { pad: 0 });
});
