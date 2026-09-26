import { test, expect, type Page } from '@playwright/test';
import { isolate } from './harness.js';

/**
 * Settings on a hand's width, and on a tablet.
 *
 * A phone shows one level at a time: the index, then a page over it with
 * Back. Opened without a page in mind it starts on the index; sent to a page,
 * Brand kit included, it opens that page. Each page opens with the sentence a
 * desktop shows beside its name. A tablet is wide enough for the rail and the
 * page side by side.
 *
 * Runs on the mobile (Pixel 5) and tablet (iPad Mini landscape) projects.
 */

isolate();

const slugOf = async (p: Page) => {
  await p.goto('/');
  await p.waitForURL((u) => {
    const seg = u.pathname.split('/').filter(Boolean);
    return seg.length === 1 && seg[0] !== 'setup';
  });
  return new URL(p.url()).pathname.split('/').filter(Boolean)[0];
};
const isPhone = (p: Page) => (p.viewportSize()?.width ?? 1024) < 768;
const dialog = (p: Page) => p.getByRole('dialog');

test('a link to Brand kit opens the kit, not the index, with its sentence', async ({ page }) => {
  test.skip(!isPhone(page), 'a tablet shows the rail and the page together');
  const slug = await slugOf(page);
  await page.goto(`/${slug}?settings=brand`);
  await expect(dialog(page).getByRole('heading', { name: 'Brand kit' })).toBeVisible();
  await expect(dialog(page).getByRole('button', { name: 'Settings' })).toBeVisible();
  await expect(page.locator('.sc-set-lede')).toContainText('What every shot for');
});

test('Settings from the brand menu starts on the index; a page and Back return to it', async ({ page }) => {
  test.skip(!isPhone(page), 'a tablet shows the rail and the page together');
  await slugOf(page);
  await page.locator('.sc-org-btn').click();
  // on a phone the brand menu is a sheet; its rows are the same items
  await page.locator('.sc-menu-item', { hasText: /^Settings$/ }).click();
  await expect(dialog(page).getByRole('heading', { name: 'Settings' })).toBeVisible();

  // one idea per row, under the two plain labels
  for (const name of [
    'Brand kit',
    'Usage',
    'Providers',
    'Appearance',
    'Library',
    'Local access',
    'Updates',
    'About',
    'Danger zone',
  ]) {
    await expect(dialog(page).getByRole('button', { name, exact: true })).toBeVisible();
  }

  await dialog(page).getByRole('button', { name: 'Local access', exact: true }).click();
  await expect(dialog(page).getByRole('heading', { name: 'Local access' })).toBeVisible();
  await expect(page.locator('.sc-set-lede')).toHaveText(
    'Open Scenri on your phone, tablet or another computer, or from your desktop.',
  );
  await dialog(page).getByRole('button', { name: 'Settings' }).click();
  // Back puts the keyboard on the row that was open
  await expect(dialog(page).getByRole('button', { name: 'Local access', exact: true })).toBeFocused();
});

test('a tablet shows the rail beside the page, one idea per page', async ({ page }) => {
  test.skip(isPhone(page), 'a phone shows one level at a time');
  const slug = await slugOf(page);
  await page.goto(`/${slug}?settings=library`);
  await expect(page.locator('.sc-set-head h2')).toHaveText('Library');
  await expect(page.locator('.sc-set .sc-set-row', { hasText: 'Export everything' })).toBeVisible();
  await expect(page.locator('.sc-set-rail .sc-set-item')).toHaveCount(9);
  // every group in the rail has its plain label, the deletes included
  await expect(page.locator('.sc-set-rail .sc-set-group')).toHaveText(['This brand', 'Studio', 'Delete']);
});

// A kit field wrote itself only when it blurred, and Back took the page away
// with the caret still in it: the words on screen were never saved (S2-02).
test('a kit edit still being typed is kept when Back takes the page away', async ({ page }) => {
  const slug = await slugOf(page);
  const brandId = ((await (await page.request.get('/api/brands')).json()) as { id: string; slug: string }[]).find(
    (b) => b.slug === slug,
  )?.id;
  await page.locator('.sc-org-btn').click();
  await page.locator('.sc-menu-item', { hasText: /^Settings$/ }).click();
  const tagline = dialog(page).getByLabel('Tagline');
  if (isPhone(page)) await dialog(page).getByRole('button', { name: 'Brand kit', exact: true }).click();
  await tagline.click();
  await page.keyboard.type('Kept on a phone');
  await expect(tagline).toBeFocused();
  await page.goBack();
  await expect(tagline).toHaveCount(0);
  await expect
    .poll(async () => {
      const brands = (await (await page.request.get('/api/brands')).json()) as { id: string; json: any }[];
      return brands.find((b) => b.id === brandId)?.json?.meta?.tagline;
    })
    .toBe('Kept on a phone');
});
