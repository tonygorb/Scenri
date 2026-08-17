import { test, expect, type Page } from '@playwright/test';
import { isolate } from './harness.js';

/**
 * One product, and the set of pictures a shot is built from.
 *
 * This page is the only place the reference set can be corrected, and the
 * compiler reads meaning straight off it: the first image is the one identity
 * hangs on, and only the first three reach an engine at all. A store import
 * routinely arrives with one image per colourway rather than one per angle, so
 * "which three, in what order" is the whole job of the page. Everything below
 * asserts that contract from the outside, the way a user meets it.
 *
 * The fixture brand's own product has no images, so each case seeds its own
 * through the real API rather than reaching into the library.
 */

// A scenri of this file's own, on an empty home, seeded from scratch.
isolate();

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

/**
 * A product with `count` distinct references, made the way the app makes one:
 * images into the content store, then one create call carrying their hashes.
 * The fills differ so the hashes differ — content addressing would otherwise
 * collapse five identical swatches into a single reference.
 */
async function seedProduct(p: Page, brandId: string, name: string, count: number): Promise<string> {
  return p.evaluate(
    async ([id, productName, n]) => {
      const shot = (i: number) =>
        new Promise<Blob>((res) => {
          const c = document.createElement('canvas');
          c.width = 40;
          c.height = 50;
          const ctx = c.getContext('2d')!;
          ctx.fillStyle = `hsl(${i * 47}, 70%, 45%)`;
          ctx.fillRect(0, 0, 40, 50);
          c.toBlob((b) => res(b!), 'image/png');
        });
      const hashes: string[] = [];
      for (let i = 0; i < (n as number); i++) {
        const fd = new FormData();
        fd.append('file', await shot(i), `angle-${i}.png`);
        const r = await fetch('/api/images', { method: 'POST', body: fd });
        hashes.push((await r.json()).hash);
      }
      const made = await fetch(`/api/brands/${id}/products`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: productName, imageHashes: hashes }),
      });
      return (await made.json()).productId as string;
    },
    [brandId, name, count] as const,
  );
}

const productsLibrary = (p: Page, brandId: string) =>
  p.evaluate(async (id) => (await fetch(`/api/brands/${id}/products-library`)).json(), brandId) as Promise<{
    products: any[];
  }>;

const stage = (p: Page) => p.locator('.sc-refstage-frame img');
const thumbs = (p: Page) => p.locator('.sc-refrail-item:not(.sc-refrail-add)');
const useFirst = (p: Page) => p.locator('.sc-refact-lead');
const remove = (p: Page) => p.locator('.sc-refact-aside');

test.describe('a product and its references', () => {
  test('one reference is a finished page, not a page missing four things', async ({ page }) => {
    const brand = await currentBrand(page);
    const id = await seedProduct(page, brand.id, 'Solo bottle', 1);
    await page.goto(`/${brand.slug}/products/${id}`);

    await expect(stage(page)).toBeVisible();
    // the one reference it has, and the way to add another — no row of empty
    // slots standing in for angles this product has never had
    await expect(thumbs(page)).toHaveCount(1);
    await expect(page.locator('.sc-refrail-add')).toHaveCount(1);
    await expect(page.locator('.sc-lookpage-note')).toContainText('One angle');
    // nothing to reorder, and nothing that can be taken away without emptying it
    await expect(useFirst(page)).toHaveCount(0);
    await expect(remove(page)).toHaveCount(0);
  });

  test('past the third, a reference is shown as one a shot never sees', async ({ page }) => {
    const brand = await currentBrand(page);
    const id = await seedProduct(page, brand.id, 'Full set', 4);
    await page.goto(`/${brand.slug}/products/${id}`);

    await expect(thumbs(page)).toHaveCount(4);
    // the cap is three, and the page says which one is outside it
    await expect(page.locator('.sc-refrail-item[data-spare]')).toHaveCount(1);
    await expect(thumbs(page).nth(3)).toHaveAttribute('data-spare', '');
    await expect(page.locator('.sc-lookpage-note')).toContainText('first three');
  });

  test('use first moves an image to the front and keeps the product it belongs to', async ({ page }) => {
    const brand = await currentBrand(page);
    const id = await seedProduct(page, brand.id, 'Reorder me', 3);
    await page.goto(`/${brand.slug}/products/${id}`);

    const before = (await productsLibrary(page, brand.id)).products.find((p) => p.id === id);
    await thumbs(page).nth(2).click();
    await useFirst(page).click();

    await expect
      .poll(async () => {
        const after = (await productsLibrary(page, brand.id)).products.find((p) => p.id === id);
        return after.shots.map((s: any) => s.file).join(',');
      })
      .toBe([before.shots[2], before.shots[0], before.shots[1]].map((s: any) => s.file).join(','));

    // the id is the thing every past shot's recipe points at: editing the set
    // must never mint a new product
    await expect(page).toHaveURL(new RegExp(`/products/${id}$`));
    const after = (await productsLibrary(page, brand.id)).products.find((p) => p.id === id);
    expect(after.name).toBe(before.name);
  });

  test('remove drops one, and the last one cannot be removed', async ({ page }) => {
    const brand = await currentBrand(page);
    const id = await seedProduct(page, brand.id, 'Shrink me', 2);
    await page.goto(`/${brand.slug}/products/${id}`);

    await expect(thumbs(page)).toHaveCount(2);
    await remove(page).click();

    await expect(page.locator('.sc-lookpage-note')).toContainText('One angle');
    await expect(thumbs(page)).toHaveCount(1);
    // a product with no reference cannot be generated from, so the offer is gone
    await expect(remove(page)).toHaveCount(0);
    const lib = (await productsLibrary(page, brand.id)).products.find((p) => p.id === id);
    expect(lib.shots).toHaveLength(1);
  });

  test('use in a shot opens Create with this product already in the brief', async ({ page }) => {
    const brand = await currentBrand(page);
    const id = await seedProduct(page, brand.id, 'Straight to work', 1);
    await page.goto(`/${brand.slug}/products/${id}`);

    await page.locator('.sc-lookpage-acts .sc-btn-primary').click();

    // `compose=1` rides along to focus the brief and is spent on arrival, so the
    // product is the part of the address that has to survive
    await expect(page).toHaveURL(new RegExp(`/create\\?product=${id}`));
    // the chip carries the product's own name, so the brief says what it is
    await expect(page.locator('.sc-token, [data-token]').filter({ hasText: 'Straight to work' })).toHaveCount(1);
  });

  test('renaming from the heading reaches the library', async ({ page }) => {
    const brand = await currentBrand(page);
    const id = await seedProduct(page, brand.id, 'Before', 1);
    await page.goto(`/${brand.slug}/products/${id}`);

    await page.locator('.sc-lookpage-titleedit').fill('After');
    // the write is debounced 500ms; give it a beat before asking the library
    await expect
      .poll(async () => (await productsLibrary(page, brand.id)).products.find((p) => p.id === id).name)
      .toBe('After');

    await page.goto(`/${brand.slug}/products`);
    await expect(page.locator('.sc-lookcard-cap').filter({ hasText: 'After' })).toHaveCount(1);
  });

  test('the category picker writes, and the choice survives a reload', async ({ page }) => {
    const brand = await currentBrand(page);
    const id = await seedProduct(page, brand.id, 'Uncategorised', 1);
    await page.goto(`/${brand.slug}/products/${id}`);

    await page.locator('.sc-catpick').click();
    await page.getByRole('menuitemradio', { name: 'Fragrance' }).click();

    await expect(page.locator('.sc-catpick')).toContainText('Fragrance');
    await page.reload();
    await expect(page.locator('.sc-catpick')).toContainText('Fragrance');
  });

  test('a failed upload says what went wrong and leaves the product alone', async ({ page }) => {
    const brand = await currentBrand(page);
    const id = await seedProduct(page, brand.id, 'Survivor', 2);
    await page.goto(`/${brand.slug}/products/${id}`);

    await page.route('**/products/*/shots', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      await route.fulfill({ status: 400, json: { error: 'that file is not an image we can read' } });
    });

    await page
      .locator('.sc-refrail-add input[type="file"], .sc-refstage-drop input[type="file"]')
      .first()
      .setInputFiles({ name: 'nope.png', mimeType: 'image/png', buffer: Buffer.from('not really a png') });

    await expect(page.locator('.sc-assetform-err')).toContainText('not an image we can read');
    // the failure is about one upload, not about the product
    await expect(stage(page)).toBeVisible();
    await expect(thumbs(page)).toHaveCount(2);
  });

  /**
   * Removing an image is one press with a way back, not a filing system.
   *
   * What happens underneath differs by where the image came from — an uploaded
   * one is deleted, a store one is excluded so the next import cannot hand it
   * straight back — and neither of those is something the page should make
   * anyone learn. Undo is the same write with the old list, so it restores the
   * position and not just the membership.
   */
  test('removing a reference offers the way back, and taking it puts the order back too', async ({ page }) => {
    const brand = await currentBrand(page);
    const id = await seedProduct(page, brand.id, 'Second thoughts', 3);
    await page.goto(`/${brand.slug}/products/${id}`);

    const before = (await productsLibrary(page, brand.id)).products.find((p) => p.id === id);

    // take out the middle one, so undo has an order to get wrong
    await thumbs(page).nth(1).click();
    await remove(page).click();

    const toast = page.locator('.sc-toast').filter({ hasText: 'Reference removed' });
    await expect(toast).toBeVisible();
    await expect(toast).toContainText('Reference 2 of 3');
    await expect(thumbs(page)).toHaveCount(2);

    await toast.getByRole('button', { name: 'Undo' }).click();

    await expect(thumbs(page)).toHaveCount(3);
    await expect
      .poll(async () =>
        (await productsLibrary(page, brand.id)).products
          .find((p) => p.id === id)
          .shots.map((s: any) => s.file)
          .join(','),
      )
      .toBe(before.shots.map((s: any) => s.file).join(','));
  });

  test('a long reference set pages from the arrows, and the add tile stays put', async ({ page }) => {
    const brand = await currentBrand(page);
    const id = await seedProduct(page, brand.id, 'Many colourways', 16);
    await page.goto(`/${brand.slug}/products/${id}`);

    const rail = page.locator('.sc-refrail');
    const add = page.locator('.sc-refrail-add');
    const next = page.getByRole('button', { name: 'Next references' });

    await expect(thumbs(page)).toHaveCount(16);
    await expect.poll(() => rail.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);

    // pinned outside the scroller, to the right of the thumbs
    await expect(add).toBeVisible();
    const [railBox, addBox] = await Promise.all([rail.boundingBox(), add.boundingBox()]);
    expect(railBox && addBox, 'rail and add should be on screen').toBeTruthy();
    expect(addBox!.x).toBeGreaterThan(railBox!.x + railBox!.width - 2);

    // a mouse must not pan this row — the wheel belongs to the page
    const beforeWheel = await rail.evaluate((el) => el.scrollLeft);
    await rail.hover();
    await page.mouse.wheel(0, 400);
    expect(await rail.evaluate((el) => el.scrollLeft)).toBe(beforeWheel);

    await expect(next).toBeHidden();
    await page.locator('.sc-refrail-shell').hover();
    await expect(next).toBeVisible();
    const stride = await rail.evaluate((el) => {
      const child = el.firstElementChild as HTMLElement | null;
      if (!child) return 0;
      return child.getBoundingClientRect().width + (Number.parseFloat(getComputedStyle(el).columnGap) || 0);
    });
    await next.click();
    await expect
      .poll(() => rail.evaluate((el) => el.scrollLeft))
      .toBeGreaterThan(stride * 0.8);
    await expect.poll(() => rail.evaluate((el) => el.scrollLeft)).toBeLessThan(stride * 1.5);
    await expect(add).toBeVisible();
  });

  test('a short reference set has no arrows', async ({ page }) => {
    const brand = await currentBrand(page);
    const id = await seedProduct(page, brand.id, 'Just two', 2);
    await page.goto(`/${brand.slug}/products/${id}`);

    await expect(thumbs(page)).toHaveCount(2);
    await expect(page.getByRole('button', { name: 'Next references' })).toBeHidden();
    await expect(page.getByRole('button', { name: 'Previous references' })).toBeHidden();
  });

  test('a product from the Scenri library can be used but not edited', async ({ page }) => {
    const brand = await currentBrand(page);
    const demoId = await page.evaluate(
      async () => (await (await fetch('/api/demo-products')).json()).demoProducts[0].id as string,
    );
    await page.goto(`/${brand.slug}/products/${demoId}`);

    await expect(page.locator('.sc-lookpage-crumb')).toContainText('Scenri library');
    await expect(page.locator('.sc-lookpage-acts .sc-btn-primary')).toBeVisible();
    // nothing here is the user's to change: no rename, no category, no add,
    // no remove, and no delete
    await expect(page.locator('.sc-lookpage-titleedit')).toHaveCount(0);
    await expect(page.locator('.sc-catpick')).toHaveCount(0);
    await expect(page.locator('.sc-refrail-add')).toHaveCount(0);
    await expect(remove(page)).toHaveCount(0);
    await expect(page.locator('.sc-btn-red')).toHaveCount(0);
  });
});
