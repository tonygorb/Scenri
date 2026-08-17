import { test, expect, type Page } from '@playwright/test';
import { isolate } from './harness.js';

/**
 * The product page on a phone and a tablet.
 *
 * The reference set is the one part of this page that cannot simply stack: a
 * store product can carry twenty-odd images, and a wrapping grid of them would
 * push the frame they belong to off the screen entirely. So the rail is one
 * scrolling row at every width, and the controls under it have to be reachable
 * with a thumb rather than a cursor.
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

async function seedProduct(p: Page, brandId: string, name: string, count: number): Promise<string> {
  return p.evaluate(
    async ([id, productName, n]) => {
      const shot = (i: number) =>
        new Promise<Blob>((res) => {
          const c = document.createElement('canvas');
          c.width = 40;
          c.height = 50;
          const ctx = c.getContext('2d')!;
          ctx.fillStyle = `hsl(${i * 37}, 70%, 45%)`;
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

test('a big reference set stays one row, and never widens the page', async ({ page }) => {
  const brand = await currentBrand(page);
  const id = await seedProduct(page, brand.id, 'Many angles', 12);
  await page.goto(`/${brand.slug}/products/${id}`);

  const rail = page.locator('.sc-refrail');
  await expect(rail).toBeVisible();

  // one row: every thumb shares a top edge, however many there are
  const tops = await page
    .locator('.sc-refrail-item')
    .evaluateAll((els) => Array.from(new Set(els.map((e) => Math.round(e.getBoundingClientRect().top)))));
  expect(tops, 'the rail wrapped instead of scrolling').toHaveLength(1);

  // it scrolls rather than stretching the document
  const scrolls = await rail.evaluate((el) => el.scrollWidth > el.clientWidth);
  expect(scrolls, 'twelve thumbs should overflow a phone rail').toBe(true);
  const overflows = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflows, 'the page itself must never scroll sideways').toBe(false);

  // and the frame it belongs to is still on screen with it
  await expect(page.locator('.sc-refstage-frame img')).toBeVisible();
});

test('every reference control is big enough for a thumb', async ({ page }) => {
  const brand = await currentBrand(page);
  const id = await seedProduct(page, brand.id, 'Touch me', 3);
  await page.goto(`/${brand.slug}/products/${id}`);

  await page.locator('.sc-refrail-item').nth(2).click();

  // The graphic may be smaller than the finger: what has to clear 44 is the
  // hit area, which the coarse-pointer rules grow with an invisible box.
  const reach = (sel: string) =>
    page.locator(sel).evaluateAll((els) =>
      els.map((el) => {
        const own = el.getBoundingClientRect().height;
        const after = getComputedStyle(el, '::after').height;
        const grown = after && after !== 'auto' ? Number.parseFloat(after) : 0;
        return Math.round(Math.max(own, grown));
      }),
    );

  for (const sel of ['.sc-refrail-item', '.sc-refact', '.sc-lookpage-acts .sc-btn']) {
    const heights = await reach(sel);
    expect(heights.length, `${sel} should be on the page`).toBeGreaterThan(0);
    for (const h of heights) expect(h, `${sel} is ${h}px tall`).toBeGreaterThanOrEqual(44);
  }
});

test('swapping a reference and starting a shot both work by touch', async ({ page }) => {
  const brand = await currentBrand(page);
  const id = await seedProduct(page, brand.id, 'Thumbs up', 4);
  await page.goto(`/${brand.slug}/products/${id}`);

  const shown = () => page.locator('.sc-refstage-frame img').getAttribute('src');
  const first = await shown();

  await page.locator('.sc-refrail-item').nth(1).tap();
  await expect.poll(shown).not.toBe(first);
  await expect(page.locator('.sc-refrail-item').nth(1)).toHaveAttribute('data-on', '');

  await page.locator('.sc-lookpage-acts .sc-btn-primary').tap();
  await expect(page).toHaveURL(new RegExp(`/create\\?product=${id}`));
});
