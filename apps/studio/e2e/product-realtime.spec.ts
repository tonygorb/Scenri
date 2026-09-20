import { test, expect } from '@playwright/test';
import { isolate } from './harness.js';
import {
  askProductMenu,
  brandJson,
  currentBrand,
  expectSameSession,
  goCreate,
  goNav,
  holdNext,
  markSession,
  menuRow,
  openProduct,
  productCard,
  productNames,
  seedProduct,
  switchBrand,
} from './realtime.js';

/**
 * A product mutation reaches every surface in the same commit, or it is not done.
 *
 * A manual product lives in the brand document; the library the walls and
 * pickers read follows that document, and re-reads itself for the products an
 * import writes. Deleting one from its page re-read the brand's sets and shots
 * instead, so the card, the Home count and the picker all kept it until a
 * reload. Every test here loads one document and then moves only in the app.
 */
isolate();

const confirmDelete = async (page: import('@playwright/test').Page) => {
  await page.getByRole('button', { name: 'Delete product' }).click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: /Delete/ })
    .click();
};

test('deleting a product takes it off the wall, the Home count and the picker without a reload', async ({ page }) => {
  const brand = await currentBrand(page);
  await seedProduct(page.request, brand.id, 'Vanish Mug');
  await seedProduct(page.request, brand.id, 'Stays Mug');

  await page.goto(`/${brand.slug}/products`);
  await markSession(page);
  await expect(productCard(page, 'Vanish Mug')).toBeVisible();
  await goNav(page, 'Home');
  const count = page.locator('.sc-create-card[data-tone="product"] b');
  const before = Number((await count.textContent())?.replace(/\D/g, ''));

  await goNav(page, 'Products');
  await openProduct(page, 'Vanish Mug');
  await confirmDelete(page);

  await expect(page).toHaveURL(new RegExp(`/${brand.slug}/products$`));
  await expect(productCard(page, 'Vanish Mug')).toHaveCount(0);
  await expect(productCard(page, 'Stays Mug')).toBeVisible();
  expect(await productNames(page.request, brand.id)).not.toContain('Vanish Mug');

  await goNav(page, 'Home');
  await expect(count).toHaveText(new RegExp(`${before - 1}$`));

  await goCreate(page);
  await askProductMenu(page, 'Vanish');
  await expect(menuRow(page, 'Vanish Mug')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await askProductMenu(page, 'Stays');
  await expect(menuRow(page, 'Stays Mug')).toBeVisible();
  await expectSameSession(page);
});

test('Back after deleting a product does not land on its dead page', async ({ page }) => {
  const brand = await currentBrand(page);
  await seedProduct(page.request, brand.id, 'Backstep Mug');
  await page.goto(`/${brand.slug}/products`);
  await markSession(page);
  await openProduct(page, 'Backstep Mug');
  const dead = new URL(page.url()).pathname;
  await confirmDelete(page);
  await expect(page).toHaveURL(new RegExp(`/${brand.slug}/products$`));
  await page.goBack();
  await expect(page).not.toHaveURL(new RegExp(`${dead}$`));
  await expectSameSession(page);
});

test('a rename reaches the wall and the picker, and a later brand save does not undo it', async ({ page }) => {
  const brand = await currentBrand(page);
  const id = await seedProduct(page.request, brand.id, 'Before Mug');

  await page.goto(`/${brand.slug}/products`);
  await markSession(page);
  await openProduct(page, 'Before Mug');
  const saved = page.waitForResponse((r) => r.request().method() === 'PATCH' && r.url().includes(`/products/${id}`));
  await page.locator('.sc-lookpage-titleedit').fill('After Mug');
  await saved;

  await goNav(page, 'Products');
  await expect(productCard(page, 'After Mug')).toBeVisible();
  await expect(productCard(page, 'Before Mug')).toHaveCount(0);
  await goCreate(page);
  await askProductMenu(page, 'After');
  await expect(menuRow(page, 'After Mug')).toBeVisible();
  await page.keyboard.press('Escape');

  // A whole-brand save from Settings, built from the brand the studio holds.
  // With a stale copy it wrote the old name back to disk.
  await page.locator('.sc-org-btn').click();
  await page.locator('.sc-menu').getByText('Settings', { exact: true }).click();
  const tagline = page.getByLabel('Tagline');
  await tagline.fill('Made to last');
  const put = page.waitForResponse((r) => r.request().method() === 'PUT' && /\/api\/brands\/[^/]+$/.test(r.url()));
  await tagline.press('Enter');
  await put;
  const doc = await brandJson(page.request, brand.id);
  expect(doc.meta.tagline).toBe('Made to last');
  expect((doc.products as { id: string; name: string }[]).find((p) => p.id === id)?.name).toBe('After Mug');
  await expectSameSession(page);
});

test('a name and a category edited inside one pause are both saved', async ({ page }) => {
  const brand = await currentBrand(page);
  const id = await seedProduct(page.request, brand.id, 'Quick Mug');
  await page.goto(`/${brand.slug}/products`);
  await markSession(page);
  await openProduct(page, 'Quick Mug');

  await page.locator('.sc-lookpage-titleedit').fill('Quicker Mug');
  await page.locator('.sc-catpick').click();
  await page.getByRole('menuitemradio', { name: 'Fragrance' }).click();
  await expect
    .poll(async () => ((await brandJson(page.request, brand.id)).products as any[]).find((p) => p.id === id))
    .toMatchObject({ name: 'Quicker Mug', category: 'fragrance' });
  await expectSameSession(page);
});

test('a product in the brief that is then deleted is flagged, not silently kept', async ({ page }) => {
  const brand = await currentBrand(page);
  const id = await seedProduct(page.request, brand.id, 'Chip Mug');
  await page.goto(`/${brand.slug}/products`);
  await markSession(page);
  await openProduct(page, 'Chip Mug');
  await page.getByRole('button', { name: 'Use in a shot' }).click();
  await expect(page).toHaveURL(/\/create/);
  const chip = page.locator(`.sc-brief [data-tok^="p:${id}"]`);
  await expect(chip).toHaveCount(1);
  await page.locator('.sc-brief-line').click();
  await page.keyboard.press('End');
  await page.keyboard.type(' on a slate shelf');

  await goNav(page, 'Products');
  await openProduct(page, 'Chip Mug');
  await confirmDelete(page);
  await expect(page).toHaveURL(new RegExp(`/${brand.slug}/products$`));

  await goCreate(page);
  await expect(chip).toHaveAttribute('data-warn', '1');
  await expect(chip).toHaveAttribute('title', 'This product is no longer in your library. Remove it from the brief.');
  await expectSameSession(page);
});

// Two reads of the library crossed: the older one, with the product in it, lands last.
test('a slow library read that started before a delete cannot bring the product back', async ({ page }) => {
  const brand = await currentBrand(page);
  await seedProduct(page.request, brand.id, 'Slow Read Mug');
  const doomed = await seedProduct(page.request, brand.id, 'Doomed Mug');
  await page.goto(`/${brand.slug}/products`);
  await markSession(page);
  await expect(productCard(page, 'Doomed Mug')).toBeVisible();

  // a rename re-reads the library; hold that read, carrying Doomed Mug
  await openProduct(page, 'Slow Read Mug');
  const held = await holdNext(page, /\/products-library$/);
  await page.locator('.sc-lookpage-titleedit').fill('Slow Read Mug II');
  await held.caught;

  await goNav(page, 'Products');
  await openProduct(page, 'Doomed Mug');
  await confirmDelete(page);
  await expect(page).toHaveURL(new RegExp(`/${brand.slug}/products$`));
  await expect(productCard(page, 'Doomed Mug')).toHaveCount(0);

  held.release();
  await page.waitForTimeout(1_000);
  await expect(productCard(page, 'Doomed Mug')).toHaveCount(0);
  await expect(productCard(page, 'Slow Read Mug II')).toBeVisible();
  expect(doomed).toBeTruthy();
  await expectSameSession(page);
});

test('a library read for the brand you left never lands on the brand you are in', async ({ page }) => {
  const brand = await currentBrand(page);
  const other = (
    await (
      await page.request.post('/api/brands', { data: { brand: { specVersion: '0.1', meta: { name: 'Quiet Brand' } } } })
    ).json()
  ).id as string;
  await seedProduct(page.request, brand.id, 'Home Brand Mug');
  await page.goto(`/${brand.slug}/products`);
  await markSession(page);

  await openProduct(page, 'Home Brand Mug');
  const held = await holdNext(page, /\/products-library$/);
  await page.locator('.sc-lookpage-titleedit').fill('Home Brand Mug II');
  await held.caught;

  await switchBrand(page, 'Quiet Brand');
  await expect(page).toHaveURL(/\/quiet-brand(\/|$)/);
  await goNav(page, 'Products');
  held.release();
  await page.waitForTimeout(1_000);
  await expect(productCard(page, 'Home Brand Mug II')).toHaveCount(0);
  await expect(productCard(page, 'Home Brand Mug')).toHaveCount(0);
  expect(await productNames(page.request, other)).toEqual([]);
  await expectSameSession(page);
});

test('a product made from the dialog is on the wall, the Home count and the picker at once', async ({ page }) => {
  const brand = await currentBrand(page);
  await page.goto(`/${brand.slug}`);
  await markSession(page);
  const count = page.locator('.sc-create-card[data-tone="product"] b');
  const before = Number((await count.textContent())?.replace(/\D/g, '') || '0');

  await goNav(page, 'Products');
  await page
    .getByRole('button', { name: /Add product/ })
    .first()
    .click();
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );
  await page
    .locator('.sc-newdlg .sc-dropzone input[type="file"]')
    .first()
    .setInputFiles([{ name: 'front.png', mimeType: 'image/png', buffer: png }]);
  await expect(page.locator('.sc-assetform-ref')).toHaveCount(1);
  await page.locator('.sc-newdlg input[type="text"], .sc-newdlg .rt-TextFieldInput').first().fill('Dialog Mug');
  await page.locator('.sc-dlg-go').click();
  await expect(page.locator('.sc-newdlg')).toHaveCount(0);

  await expect(productCard(page, 'Dialog Mug')).toBeVisible();
  await goNav(page, 'Home');
  await expect(count).toHaveText(new RegExp(`${before + 1}$`));
  await goCreate(page);
  await askProductMenu(page, 'Dialog');
  await expect(menuRow(page, 'Dialog Mug')).toBeVisible();
  await expectSameSession(page);
});

test('a product the server refuses to make leaves no card and keeps the work', async ({ page }) => {
  const brand = await currentBrand(page);
  await page.route(/\/api\/brands\/[^/]+\/products$/, (route) =>
    route.request().method() === 'POST'
      ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'disk is full' }) })
      : route.fallback(),
  );
  await page.goto(`/${brand.slug}/products`);
  await markSession(page);
  await page
    .getByRole('button', { name: /Add product/ })
    .first()
    .click();
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64',
  );
  await page
    .locator('.sc-newdlg .sc-dropzone input[type="file"]')
    .first()
    .setInputFiles([{ name: 'front.png', mimeType: 'image/png', buffer: png }]);
  await page.locator('.sc-newdlg input[type="text"], .sc-newdlg .rt-TextFieldInput').first().fill('Refused Mug');
  await page.locator('.sc-dlg-go').click();

  await expect(page.locator('.sc-newdlg')).toContainText('disk is full');
  await expect(page.locator('.sc-assetform-ref')).toHaveCount(1);
  await expect(productCard(page, 'Refused Mug')).toHaveCount(0);
  expect(await productNames(page.request, brand.id)).not.toContain('Refused Mug');
  await expectSameSession(page);
});
