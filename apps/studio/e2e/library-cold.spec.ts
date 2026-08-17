import { test, expect, type Page } from '@playwright/test';
import { isolate } from './harness.js';

/**
 * The library pages in the state every real brand is actually in.
 *
 * A brand only leaves the cold state by authoring an asset of its own, which
 * most never do — so this is not a first-run screen, it is the screen. The one
 * claim every case here makes is that the filter row is *already there*: it is
 * gated on the wall it filters, never on ownership, so nothing about it can
 * arrive while you are looking at the wall.
 *
 * The bookmark case is a regression test with a specific history. Its siblings
 * in brand.spec.ts ask for `isolate({ scene: true })`, so they run warm, and a
 * build that inserted the whole row on the first bookmark passed all three of
 * them while shoving the wall down 77px under the cursor.
 */
isolate();

const api = async (p: Page, path: string, init?: RequestInit) =>
  p.evaluate(
    async ([u, i]) => {
      const r = await fetch(u as string, i as RequestInit);
      return r.json();
    },
    [path, init ?? undefined],
  );

async function currentBrand(p: Page): Promise<{ id: string; slug: string; json: any }> {
  await p.goto('/');
  await p.waitForURL((u) => {
    const seg = u.pathname.split('/').filter(Boolean);
    return seg.length === 1 && seg[0] !== 'setup';
  });
  const slug = decodeURIComponent(new URL(p.url()).pathname.split('/')[1]);
  const brands = (await api(p, '/api/brands')) as any[];
  const b = brands.find((x) => x.slug === slug);
  return { id: b.id, slug, json: b.json };
}

/** The top of the wall, which is the thing that must not move. */
const wallTop = async (p: Page) => {
  const box = await p.locator('.sc-masonry').first().boundingBox();
  return box?.y ?? null;
};

test.describe('the library pages, cold', () => {
  test('scenes: the row is on the wall before the first bookmark, not after it', async ({ page }) => {
    const brand = await currentBrand(page);
    await page.goto(`/${brand.slug}/scenes`);

    // The offer still leads, and still owns the only CTA on the page.
    await expect(page.locator('.sc-canvas-empty')).toBeVisible();
    await expect(page.locator('.sc-filterbar-cta')).toHaveCount(0);

    // The row is already here, under the seam, on the catalog it filters.
    const bar = page.locator('.sc-filterbar');
    await expect(bar).toBeVisible();
    const tab = page.getByRole('tab', { name: /Bookmarks/ });
    await expect(tab).toContainText('0');

    // Empty bookmarks in the cold state keeps the catalog up — nothing to hide.
    await tab.click();
    await expect(page).toHaveURL(/[?&]bookmarked=1/);
    await expect(page.locator('.sc-lib-zero')).toHaveCount(0);
    await expect(page.locator('.sc-coll').first()).toBeVisible();
    await page.getByRole('tab', { name: /Every scene/ }).click();

    // The claim. A bookmark may change the count and nothing else.
    const before = await wallTop(page);
    const height = (await bar.boundingBox())?.height;
    await page.locator('.sc-lookcard-bookmark').first().click();
    await expect(tab).toContainText('1');
    expect(await wallTop(page)).toBe(before);
    expect((await bar.boundingBox())?.height).toBe(height);

    // And picking the tab leaves the offer and the row where they are.
    const barY = (await bar.boundingBox())?.y;
    await tab.click();
    await expect(page).toHaveURL(/[?&]bookmarked=1/);
    await expect(page.locator('.sc-canvas-empty')).toBeVisible();
    expect((await bar.boundingBox())?.y).toBe(barY);
    await expect(page.locator('[data-wall] .sc-lookcard')).toHaveCount(1);
  });

  test('scenes: searching does not take the row away with the sections', async ({ page }) => {
    const brand = await currentBrand(page);
    await page.goto(`/${brand.slug}/scenes`);

    // Searching flips the wall from collection sections to one flat grid. The
    // row used to live inside that branch, so typing in it unmounted it.
    const bar = page.locator('.sc-filterbar');
    const height = (await bar.boundingBox())?.height;
    await page.locator('.sc-libsearch-toggle').click();
    await page.locator('.sc-libsearch input').fill('ice');
    await expect(page.locator('.sc-coll')).toHaveCount(0);
    await expect(bar).toBeVisible();
    expect((await bar.boundingBox())?.height).toBe(height);
  });

  test('scenes: an empty bookmarks tab still answers a search that finds nothing', async ({ page }) => {
    const brand = await currentBrand(page);
    // The tab keeps the catalog up here, so a search can still empty the wall.
    // Suppressing both messages left this state completely silent — a blank
    // page under a filled-in search box.
    await page.goto(`/${brand.slug}/scenes?bookmarked=1&q=zzzzz`);
    const zero = page.locator('.sc-lib-zero');
    await expect(zero).toBeVisible();
    await expect(zero).toContainText('zzzzz');
    // ...and it names no facet: the wall it searched was the whole catalog.
    await expect(zero).not.toContainText('Bookmarks');
  });

  test('scenes: a deep-linked vertical shows which tab it landed on', async ({ page }) => {
    const brand = await currentBrand(page);
    // Without a row this narrowed the wall with nothing on screen saying so.
    await page.goto(`/${brand.slug}/scenes?vertical=Beauty`);
    await expect(page.getByRole('tab', { name: /Beauty/ })).toHaveAttribute('aria-selected', 'true');
  });

  test('presenters: same row, same place', async ({ page }) => {
    const brand = await currentBrand(page);
    await page.goto(`/${brand.slug}/presenters`);
    await expect(page.locator('.sc-canvas-empty')).toBeVisible();
    await expect(page.locator('.sc-filterbar')).toBeVisible();
    await expect(page.locator('.sc-filterbar-cta')).toHaveCount(0);
    await expect(page.getByRole('tab', { name: /Every presenter/ })).toBeVisible();
  });

  test('products: same row, same place', async ({ page }) => {
    const brand = await currentBrand(page);
    // The fixture ships one product, which is warm. Take it away.
    await api(page, `/api/brands/${brand.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ brand: { ...brand.json, products: [] } }),
    });

    await page.goto(`/${brand.slug}/products`);
    await expect(page.locator('.sc-canvas-empty')).toBeVisible();
    await expect(page.locator('.sc-filterbar')).toBeVisible();
    await expect(page.locator('.sc-filterbar-cta')).toHaveCount(0);
    // The row carries the page's only h1 now that the cold state has one.
    await expect(page.locator('h1')).toHaveCount(1);
  });
});
