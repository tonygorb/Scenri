import { expect, type Page, test } from '@playwright/test';
import { currentBrand, dropPhotos, isolate } from './harness.js';

/**
 * The product studio on a phone: the same sheet the composer chips use, the
 * product large, the board as one row, the verbs stacked with the primary on
 * top, every control a finger can hit, and a page that never scrolls
 * sideways.
 */
isolate({ env: { SCENRI_DEMO_BUILDS: '1' } });

const INPUT = '.sc-newdlg input[type="file"]';
/** The tablet project runs this file too; the sheet only exists below 768px. */
const isPhone = (p: Page) => (p.viewportSize()?.width ?? 0) < 768;

test.describe('the product studio on a phone', () => {
  test('is a bottom sheet with the product large and the board as one row', async ({ page }) => {
    test.skip(!isPhone(page), 'a tablet gets the centred dialog');
    const brand = await currentBrand(page);
    await page.goto(`/${brand.slug}/products?new=product`);
    await dropPhotos(page, INPUT, 2, 53);
    await expect(page.locator('.sc-refrail-item:not(.sc-refrail-add)')).toHaveCount(2);

    const sheet = await page.locator('.sc-newdlg').boundingBox();
    const view = page.viewportSize()!;
    expect(sheet).toBeTruthy();
    // docked to the bottom edge, never a floating card
    expect(Math.abs(sheet!.y + sheet!.height - view.height)).toBeLessThan(2);
    expect(sheet!.width).toBe(view.width);

    // the page under the sheet never widens
    const widths = await page.evaluate(() => ({
      doc: document.documentElement.scrollWidth,
      win: window.innerWidth,
    }));
    expect(widths.doc).toBeLessThanOrEqual(widths.win);
  });

  test('every control clears the touch target, and the primary sits above the quiet way out', async ({ page }) => {
    const brand = await currentBrand(page);
    await page.goto(`/${brand.slug}/products?new=product`);
    await dropPhotos(page, INPUT, 1, 59);
    await expect(page.locator('.sc-dlg-go')).toHaveText('Build views');

    for (const sel of ['.sc-refrail-item', '.sc-dlg-go', '.sc-pstudio-verbs .sc-btn-ghost', '.sc-catpick']) {
      const boxes = await page.locator(sel).evaluateAll((els) =>
        els.map((el) => {
          const own = el.getBoundingClientRect().height;
          const after = Number.parseFloat(getComputedStyle(el, '::after').height) || 0;
          return Math.max(own, after);
        }),
      );
      for (const h of boxes) expect(h, sel).toBeGreaterThanOrEqual(44);
    }
    // stacked only on a phone; a tablet keeps the two verbs on one row
    if (isPhone(page)) {
      const go = await page.locator('.sc-dlg-go').boundingBox();
      const out = await page.locator('.sc-pstudio-verbs .sc-btn-ghost').boundingBox();
      expect(go!.y).toBeLessThan(out!.y);
    }
  });
});
