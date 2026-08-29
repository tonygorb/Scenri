import { test, expect, type Page } from '@playwright/test';
import { isolate } from './harness.js';

/**
 * Making a product, all the way through.
 *
 * The one flow that costs nothing and finishes immediately, so it is the one
 * that can be driven end to end in a test: pick two images, name it, and the
 * product is in the library before the dialog has closed.
 *
 * It is also where the draft contract is cheapest to prove. Closing this dialog
 * ends the attempt and never asks first: the way back from an accident is the
 * Undo offered afterwards, which costs nothing on the closes you meant.
 */

// A Scenri of this file's own, on an empty home, seeded from scratch.
isolate();

/** A tiny real PNG, built in the page rather than committed as a fixture. */
const PNG = (hex: string) =>
  `data:image/png;base64,${Buffer.from(
    // 1x1 is enough: sharp normalises it server-side and the test only cares
    // that bytes became a shot.
    hex === 'a'
      ? 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
      : 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64',
  ).toString('base64')}`;

const bytes = (which: 'a' | 'b') => Buffer.from(PNG(which).split(',')[1], 'base64');

async function currentBrand(p: Page): Promise<{ slug: string; id: string }> {
  await p.goto('/');
  await p.waitForURL((u) => {
    const seg = u.pathname.split('/').filter(Boolean);
    return seg.length === 1 && seg[0] !== 'setup';
  });
  const slug = decodeURIComponent(new URL(p.url()).pathname.split('/')[1]);
  const brands = (await p.evaluate(async () => (await fetch('/api/brands')).json())) as any[];
  return { slug, id: brands.find((b) => b.slug === slug).id };
}

test.describe('a new product', () => {
  test('two images and a name become one product with two shots', async ({ page }) => {
    const brand = await currentBrand(page);
    const name = `Test Tin ${Date.now()}`;

    await page.goto(`/${brand.slug}/products?new=product`);
    await page
      .locator('.sc-newdlg .sc-dropzone input[type="file"]')
      .first()
      .setInputFiles([
        { name: 'front.png', mimeType: 'image/png', buffer: bytes('a') },
        { name: 'side.png', mimeType: 'image/png', buffer: bytes('b') },
      ]);
    await expect(page.locator('.sc-assetform-ref')).toHaveCount(2);

    await page.locator('.sc-newdlg input[type="text"], .sc-newdlg .rt-TextFieldInput').first().fill(name);
    await page.locator('.sc-dlg-go').click();

    await expect(page.locator('.sc-newdlg')).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`/${brand.slug}/products$`));

    const lib = (await page.evaluate(
      async (id) => (await fetch(`/api/brands/${id}/products-library`)).json(),
      brand.id,
    )) as any;
    const made = lib.products.find((p: any) => p.name === name);
    expect(made, 'the product is in the library').toBeTruthy();
    // one write, two shots — not a create followed by N shot uploads
    expect(made.shots).toHaveLength(2);
    expect(made.shots.every((s: any) => s.locked)).toBe(true);
  });

  test('the success toast offers the two things anyone does next', async ({ page }) => {
    const brand = await currentBrand(page);
    await page.goto(`/${brand.slug}/products?new=product`);
    await page
      .locator('.sc-newdlg .sc-dropzone input[type="file"]')
      .first()
      .setInputFiles([{ name: 'front.png', mimeType: 'image/png', buffer: bytes('a') }]);
    await page.locator('.sc-newdlg input[type="text"], .sc-newdlg .rt-TextFieldInput').first().fill('Toast Tin');
    await page.locator('.sc-dlg-go').click();

    const toast = page.locator('.sc-toast').filter({ hasText: 'Toast Tin' });
    await expect(toast).toBeVisible();
    await expect(toast.getByRole('button', { name: 'Add details' })).toBeVisible();
    await expect(toast.getByRole('button', { name: 'Use in a shot' })).toBeVisible();

    await toast.getByRole('button', { name: 'Use in a shot' }).click();
    // Both seeds are spent on arrival now (Create.tsx): `compose=1` focuses the
    // brief, `product=` is applied to it, and neither is left in the address for
    // the next mount to apply a second time. So what this asserts is the
    // destination, not a param that is on its way out.
    await expect(page).toHaveURL(/\/create$/);
  });

  test('closing ends the attempt, and so does sending', async ({ page }) => {
    const brand = await currentBrand(page);
    const typed = `Draft Tin ${Date.now()}`;

    await page.goto(`/${brand.slug}/products?new=product`);
    const field = () => page.locator('.sc-newdlg input[type="text"], .sc-newdlg .rt-TextFieldInput').first();
    await field().fill(typed);
    // the debounce is 400ms; give the write a beat before pulling the rug
    await page.waitForTimeout(600);

    // no confirm, ever — leaving is allowed to just work
    await page.keyboard.press('Escape');
    await expect(page.locator('.sc-newdlg')).toHaveCount(0);
    await expect(page.locator('[role="alertdialog"]')).toHaveCount(0);

    // A form nobody sent is not a draft: the next one opens clean.
    await page.goto(`/${brand.slug}/products?new=product`);
    await expect(field()).toHaveValue('');
    await field().fill(typed);

    // send it, and the draft is spent
    await page
      .locator('.sc-newdlg .sc-dropzone input[type="file"]')
      .first()
      .setInputFiles([{ name: 'front.png', mimeType: 'image/png', buffer: bytes('a') }]);
    await page.locator('.sc-dlg-go').click();
    await expect(page.locator('.sc-newdlg')).toHaveCount(0);

    await page.goto(`/${brand.slug}/products?new=product`);
    await expect(field()).toHaveValue('');
  });

  test('a file that is not an image is refused in the dialog’s own error slot', async ({ page }) => {
    const brand = await currentBrand(page);
    await page.goto(`/${brand.slug}/products?new=product`);
    await page
      .locator('.sc-newdlg .sc-dropzone input[type="file"]')
      .first()
      .setInputFiles([{ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('not a picture') }]);
    // the input only accepts image/*, so nothing uploads and nothing is claimed
    await expect(page.locator('.sc-assetform-ref')).toHaveCount(0);
    await expect(page.locator('.sc-dlg-go')).toHaveAttribute('aria-disabled', 'true');
  });
});
