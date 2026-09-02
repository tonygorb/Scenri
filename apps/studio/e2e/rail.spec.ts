import { test, expect, type Page } from '@playwright/test';
import { isolate } from './harness.js';

// The Create rail is a second door into the same brief as the composer. These
// pin the contract the two share: a tile ticks when its chip is in, a ticked
// tile's click takes the chip out, every category opens three across, and the
// rail sits out with the composer's own sentence when a door is shut.

// A Scenri of this file's own, on an empty home, seeded from scratch.
isolate(test);

const line = (p: Page) => p.locator('.sc-brief-line');
const chips = (p: Page) => p.locator('.sc-brief-line .sc-token');
const rail = (p: Page) => p.locator('.sc-assets');
const group = (p: Page, name: string) =>
  rail(p).locator('.sc-agroup', { has: p.locator('.sc-agroup-t', { hasText: name }) });
const tiles = (p: Page, name: string) => group(p, name).locator('.sc-acard');
const columns = async (grid: ReturnType<Page['locator']>) =>
  grid.evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').filter(Boolean).length);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.waitForURL((u) => {
    const seg = u.pathname.split('/').filter(Boolean);
    return seg.length === 1 && seg[0] !== 'setup';
  });
  await page.goto(`${new URL(page.url()).pathname}/create`);
  await line(page).waitFor();
  await rail(page).waitFor();
  // start from an empty brief whatever the last test left
  await line(page).click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.press('Backspace');
  await expect(chips(page)).toHaveCount(0);
});

test('every category opens three across and closes to the quick row of four', async ({ page }) => {
  for (const name of ['Products', 'Presenters', 'Scenes', 'Recent shots']) {
    const g = group(page, name);
    if ((await g.count()) === 0) continue; // a section with nothing in it draws nothing
    const head = g.locator('.sc-agroup-t');
    await head.click();
    await expect(g).toHaveAttribute('data-mode', 'open');
    expect(await columns(g.locator('.sc-acard-grid'))).toBe(3);
    await head.click();
    await expect(g).not.toHaveAttribute('data-mode', 'open');
    expect(await columns(g.locator('.sc-arow'))).toBe(4);
  }
});

test('a rail tile ticks when its chip is in, and its click takes the chip out again', async ({ page }) => {
  const product = tiles(page, 'Products').first();
  await product.click();
  await expect(chips(page)).toHaveCount(1);
  await expect(chips(page).first()).toHaveAttribute('data-kind', 'product');
  await expect(product).toHaveAttribute('aria-pressed', 'true');
  await product.click();
  await expect(chips(page)).toHaveCount(0);
  await expect(product).toHaveAttribute('aria-pressed', 'false');

  const presenter = tiles(page, 'Presenters').first();
  await presenter.click();
  await expect(chips(page).first()).toHaveAttribute('data-kind', 'character');
  await expect(presenter).toHaveAttribute('aria-pressed', 'true');
  await presenter.click();
  await expect(chips(page)).toHaveCount(0);

  const scene = tiles(page, 'Scenes').first();
  await scene.click();
  await expect(chips(page).first()).toHaveAttribute('data-kind', 'template');
  await expect(scene).toHaveAttribute('aria-pressed', 'true');
  await scene.click();
  await expect(chips(page)).toHaveCount(0);
  await expect(scene).toHaveAttribute('aria-pressed', 'false');
});

test('a recent shot rides as a reference and unticks from the rail', async ({ page }) => {
  const shot = tiles(page, 'Recent shots').first();
  await expect(shot).toBeVisible();
  await shot.click();
  await expect(chips(page)).toHaveCount(1);
  await expect(chips(page).first()).toHaveAttribute('data-kind', 'ref');
  await expect(shot).toHaveAttribute('aria-pressed', 'true');
  await shot.click();
  await expect(chips(page)).toHaveCount(0);
  await expect(shot).toHaveAttribute('aria-pressed', 'false');
});

test('a brand colour ticks and unticks like everything else', async ({ page }) => {
  const swatch = group(page, 'Brand colors').locator('.sc-aswatch-tile > button:first-child').first();
  await expect(swatch).toBeVisible();
  await swatch.click();
  await expect(chips(page)).toHaveCount(1);
  await expect(chips(page).first()).toHaveAttribute('data-kind', 'color');
  await expect(swatch).toHaveAttribute('aria-pressed', 'true');
  await swatch.click();
  await expect(chips(page)).toHaveCount(0);
  await expect(swatch).toHaveAttribute('aria-pressed', 'false');
});

test('at the ceiling the unticked tiles sit out and say why, the ticked ones still untick', async ({ page }) => {
  const g = group(page, 'Products');
  await g.locator('.sc-agroup-t').click();
  // the open shape arrives after a short fade; count once it is drawn
  await expect(g.locator('.sc-acard-grid')).toBeVisible();
  const cards = tiles(page, 'Products');
  await expect.poll(() => cards.count()).toBeGreaterThanOrEqual(13);
  for (let i = 0; i < 12; i++) {
    await cards.nth(i).click();
    await expect(chips(page)).toHaveCount(i + 1);
  }
  // the attached tiles are lifted to the front, so the thirteenth is unticked
  await expect(cards.nth(12)).toHaveAttribute('aria-disabled', 'true');
  await cards.nth(12).hover();
  await expect(page.getByRole('tooltip')).toContainText('Remove one to add another');
  // a ticked tile is still live: it is the way out
  await expect(cards.first()).not.toHaveAttribute('aria-disabled', 'true');
  await cards.first().click();
  await expect(chips(page)).toHaveCount(11);
  await expect(cards.nth(12)).not.toHaveAttribute('aria-disabled', 'true');
});
