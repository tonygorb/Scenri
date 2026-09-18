import { test, expect, type Page } from '@playwright/test';
import { isolate } from './harness.js';

/**
 * The brand menu on a hand's width, and on a tablet.
 *
 * On a phone the menu is a sheet, and an uncapped brand list put Settings and
 * Shut down twenty rows down it: the same wall the desktop panel had, one thumb
 * further away. The list keeps its own cap in the sheet, so with twenty brands
 * the whole menu still fits the sheet and the way out is on screen. The tablet
 * leg is the pointer panel at a short screen.
 *
 * Runs on the mobile (Pixel 5) and tablet (iPad Mini landscape) projects.
 */

// A Scenri of this file's own, on an empty home, seeded from scratch.
isolate();

const api = async (p: Page, path: string, init?: RequestInit) =>
  p.evaluate(
    async ([u, i]) => {
      const r = await fetch(u as string, i as RequestInit);
      return r.json();
    },
    [path, init ?? undefined],
  );

test('twenty brands, and the way out is still on screen', async ({ page }) => {
  await page.goto('/');
  await page.waitForURL((u) => {
    const seg = u.pathname.split('/').filter(Boolean);
    return seg.length === 1 && seg[0] !== 'setup';
  });
  for (let i = 0; i < 19; i++) {
    await api(page, '/api/brands', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ brand: { specVersion: '0.1', meta: { name: `Brand ${String.fromCharCode(65 + i)}` } } }),
    });
  }
  await page.reload();
  await page.locator('.sc-org-btn').click();

  const quit = page.locator('.sc-menu-item[data-quit]');
  await expect(quit).toBeVisible();
  // the list scrolls inside itself, so the surface around it does not have to
  const list = await page.locator('.sc-menu-brands').evaluate((el) => ({ h: el.clientHeight, s: el.scrollHeight }));
  expect(list.s).toBeGreaterThan(list.h);
  // it ends on a whole row, never through the middle of one
  const cut = await page.locator('.sc-menu-brands').evaluate((el) => {
    const edge = el.getBoundingClientRect().bottom;
    return [...el.children]
      .map((c) => c.getBoundingClientRect())
      .filter((r) => r.top < edge - 0.5 && r.bottom > edge + 0.5).length;
  });
  expect(cut).toBe(0);
  const sheet = page.locator('.sc-menu-sheet');
  if (await sheet.count()) {
    await page.waitForTimeout(500); // the sheet rises from below the fold
    const fit = await sheet.evaluate((el) => ({ h: el.clientHeight, s: el.scrollHeight }));
    expect(fit.s).toBeLessThanOrEqual(fit.h + 1);
  }
  await expect(quit).toBeInViewport();
});
