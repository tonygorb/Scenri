import { expect, test } from '@playwright/test';
import { currentBrand, dropPhotos, isolate } from './harness.js';

/**
 * Adding a product, all the way through the studio.
 *
 * Photographs are facts and need no approval: one is a product, and Save is
 * one write. What the studio adds on top is the drawn views, one at a time,
 * each held for Keep or Try again, and none of them reaching the product
 * until Save names it. The demo engine stands in for a drawing engine here
 * (SCENRI_DEMO_BUILDS), slowed a beat so the drawing state can be seen; with
 * no reader on this machine the studio plans from the fallback category, and
 * says so.
 */
isolate({ env: { SCENRI_DEMO_BUILDS: '1', SCENRI_DEMO_STAGGER_MS: '900' } });

const INPUT = '.sc-newdlg input[type="file"]';
const primary = (p: import('@playwright/test').Page) => p.locator('.sc-dlg-go');
const ghost = (p: import('@playwright/test').Page) => p.locator('.sc-pstudio-verbs .sc-btn-ghost');
const line = (p: import('@playwright/test').Page) => p.locator('.sc-pstudio-line');
const thumbs = (p: import('@playwright/test').Page) => p.locator('.sc-refrail-item:not(.sc-refrail-add)');
const library = (p: import('@playwright/test').Page, brandId: string) =>
  p.evaluate(async (id) => (await fetch(`/api/brands/${id}/products-library`)).json(), brandId) as Promise<{
    products: any[];
  }>;

test.describe('the product studio', () => {
  test('one photograph is a product: saved as is, in one write, with the toast that follows', async ({ page }) => {
    const brand = await currentBrand(page);
    const name = `Studio Tin ${Date.now()}`;
    await page.goto(`/${brand.slug}/products?new=product`);
    await dropPhotos(page, INPUT, 1);

    await expect(page.locator('.sc-refstage-frame img')).toBeVisible();
    await expect(thumbs(page)).toHaveCount(1);
    await expect(line(page)).toContainText('One photograph');
    // a drawing engine is here and the plan is not covered, so the studio offers to draw
    await expect(primary(page)).toHaveText('Build views');
    await expect(ghost(page)).toHaveText('Save as is');

    await page.getByRole('textbox', { name: 'Name' }).fill(name);
    await ghost(page).click();
    await expect(page.locator('.sc-newdlg')).toHaveCount(0);

    const lib = await library(page, brand.id);
    const made = lib.products.find((p: any) => p.name === name);
    expect(made, 'the product is in the library').toBeTruthy();
    expect(made.shots).toHaveLength(1);
    expect(made.shots[0].source).toBe('photo');
    expect(made.cover).toBe(made.shots[0].file);

    const toast = page.locator('.sc-toast').filter({ hasText: name });
    await expect(toast.getByRole('button', { name: 'Add details' })).toBeVisible();
    await toast.getByRole('button', { name: 'Use in a shot' }).click();
    await expect(page).toHaveURL(/\/create$/);
  });

  test('three photographs fill every seat: nothing is offered, the product just saves', async ({ page }) => {
    const brand = await currentBrand(page);
    await page.goto(`/${brand.slug}/products?new=product`);
    await dropPhotos(page, INPUT, 3, 73);
    await expect(thumbs(page)).toHaveCount(3);
    await expect(line(page)).toContainText('3 photographs');
    await expect(primary(page)).toHaveText('Save product');
    await expect(ghost(page)).toHaveCount(0);
  });

  test('a drawn view is kept after the photograph; a refused one never reaches the product, and its bytes go', async ({
    page,
  }) => {
    const brand = await currentBrand(page);
    const name = `Drawn Tin ${Date.now()}`;
    await page.goto(`/${brand.slug}/products?new=product`);
    await dropPhotos(page, INPUT, 1, 89);
    await expect(primary(page)).toHaveText('Build views');
    await primary(page).click();

    // one view at a time, in the same frame, with a clock
    await expect(page.locator('.sc-pstudio-drawing')).toBeVisible();
    await expect(line(page)).toContainText('Drawing the three-quarter view');
    await expect(primary(page)).toHaveText('Keep', { timeout: 15_000 });
    const first = await page.locator('[data-candidate] img').getAttribute('src');
    expect(first).toMatch(/\/api\/images\/[a-f0-9]{32}$/);

    // Try again: the candidate leaves, a correction line opens, and the redraw replaces it
    await ghost(page).click();
    await expect(page.locator('#sc-pstudio-fix')).toBeVisible();
    await page.locator('#sc-pstudio-fix').fill('The strap is wider.');
    await expect(primary(page)).toHaveText('Draw again');
    await primary(page).click();
    await expect(primary(page)).toHaveText('Keep', { timeout: 15_000 });
    const second = await page.locator('[data-candidate] img').getAttribute('src');
    expect(second).not.toBe(first);

    // the refused view's bytes are gone from the store
    // past the browser's cache: a content-addressed picture is served immutable
    const gone = await page.evaluate(async (src) => (await fetch(src as string, { cache: 'no-store' })).status, first);
    expect(gone).toBe(404);

    // Keep: it joins the board after the photograph, and the next planned view follows
    await primary(page).click();
    await expect(thumbs(page)).toHaveCount(2);
    await expect(thumbs(page).nth(1)).toHaveAttribute('data-source', 'derived');
    await expect(line(page)).toContainText('Drawing the front view');
    await expect(primary(page)).toHaveText('Keep', { timeout: 15_000 });
    // not this one: skip it, and the board is complete
    await ghost(page).click();
    await expect(primary(page)).toHaveText('Draw again');
    await ghost(page).click();
    await expect(primary(page)).toHaveText('Save product');
    await expect(thumbs(page)).toHaveCount(2);

    await page.getByRole('textbox', { name: 'Name' }).fill(name);
    await primary(page).click();
    await expect(page.locator('.sc-newdlg')).toHaveCount(0);

    const lib = await library(page, brand.id);
    const made = lib.products.find((p: any) => p.name === name);
    expect(made.shots.map((s: any) => s.source)).toEqual(['photo', 'derived']);
    expect(made.shots[1].angle).toBe('three-quarter');
    expect(made.shots[1].file).toBe(`asset:${second!.split('/').pop()}`);
    // the cover is the photograph, never the drawn view
    expect(made.cover).toBe(made.shots[0].file);
  });

  test('a reload mid-draw keeps the board and picks the drawing back up', async ({ page }) => {
    const brand = await currentBrand(page);
    await page.goto(`/${brand.slug}/products?new=product`);
    await dropPhotos(page, INPUT, 1, 101);
    await expect(primary(page)).toHaveText('Build views');
    await primary(page).click();
    await expect(page.locator('.sc-pstudio-drawing')).toBeVisible();

    await page.reload();
    await expect(thumbs(page)).toHaveCount(1);
    await expect(primary(page)).toHaveText('Keep', { timeout: 15_000 });
    await primary(page).click();
    await expect(thumbs(page)).toHaveCount(2);
  });

  test('closing ends the attempt with one Undo, and the next opening is clean', async ({ page }) => {
    const brand = await currentBrand(page);
    await page.goto(`/${brand.slug}/products?new=product`);
    await dropPhotos(page, INPUT, 1, 113);
    await expect(thumbs(page)).toHaveCount(1);

    // no confirm, ever: leaving is allowed to just work
    await page.keyboard.press('Escape');
    await expect(page.locator('.sc-newdlg')).toHaveCount(0);
    await expect(page.locator('[role="alertdialog"]')).toHaveCount(0);

    const toast = page.locator('.sc-toast').filter({ hasText: 'Product discarded' });
    await expect(toast).toBeVisible();
    await toast.getByRole('button', { name: 'Undo' }).click();
    await expect(thumbs(page)).toHaveCount(1);

    await page.keyboard.press('Escape');
    await expect(page.locator('.sc-newdlg')).toHaveCount(0);
    await page.goto(`/${brand.slug}/products?new=product`);
    await expect(page.locator('.sc-assetwell')).toBeVisible();
    await expect(thumbs(page)).toHaveCount(0);
  });

  test('a file that is not an image is refused, and nothing can be saved', async ({ page }) => {
    const brand = await currentBrand(page);
    await page.goto(`/${brand.slug}/products?new=product`);
    await page
      .locator(INPUT)
      .first()
      .setInputFiles([{ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('not a picture') }]);
    await expect(thumbs(page)).toHaveCount(0);
    await expect(primary(page)).toHaveAttribute('aria-disabled', 'true');
  });
});
