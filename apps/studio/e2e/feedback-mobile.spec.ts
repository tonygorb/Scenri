import { expect, type Page, test } from '@playwright/test';

/**
 * The touch entry point.
 *
 * Right-click does not exist here and long-press already belongs to the
 * browser's own image and selection menus, so the picker is the whole
 * interaction — and it is the same code path as the desktop one, reached from
 * a menu row instead of a top-bar button because that bar has no room at this
 * width.
 */

const pop = (p: Page) => p.locator('.sc-fb-pop');

async function openCreate(p: Page) {
  await p.goto('/');
  await p.waitForFunction(() => {
    const seg = location.pathname.split('/').filter(Boolean);
    return seg.length >= 1 && seg[0] !== 'setup';
  });
  const slug = (await p.evaluate(() => location.pathname.split('/').filter(Boolean)[0])) as string;
  await p.goto(`/${slug}/create`);
  await p.waitForSelector('.sc-topbar');
}

test('the entry point moves into the brand menu, and the picker works by tap', async ({ page }) => {
  await openCreate(page);

  const menu = page.locator('.sc-topbar-end .sc-brandmenu, .sc-topbar-end button').last();
  await menu.click();
  const row = page.locator('[role="menuitem"]', { hasText: 'Report a problem' });
  test.skip((await row.count()) === 0, 'not an alpha build');

  // There is no standing button anywhere now: right-click is the way in on a
  // desktop, and this row is the way in on a touch device, which has none.
  await expect(page.locator('.sc-topbar-end .sc-icon-btn[aria-label*="Report"]')).toHaveCount(0);

  await row.click();
  await expect(page.locator('.sc-fb-picker')).toBeVisible();

  const tile = page.locator('.sc-cell[data-fb-node]').first();
  test.skip((await tile.count()) === 0, 'seed has no finished shot');
  const box = (await tile.boundingBox())!;
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  await expect(pop(page)).toBeVisible();

  // the composer must clear the keyboard and the home indicator
  const bottom = await pop(page).evaluate((el) => {
    const r = el.getBoundingClientRect();
    return window.innerHeight - r.bottom;
  });
  expect(bottom).toBeGreaterThanOrEqual(0);
});
