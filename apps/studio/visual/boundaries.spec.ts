import { test } from '@playwright/test';
import { isolate } from '../e2e/harness.js';
import { discover, prep, shot, type Discovered } from './shared.js';

/**
 * Breakpoint-boundary shots: one width immediately below and immediately above
 * each major layout threshold, on the two surfaces that own the most
 * responsive behaviour. The values are Scenri's real boundaries (767/768,
 * 1023/1024, 1279/1280) — never generic ladder steps.
 */

isolate({ scene: true });

let d: Discovered;
test.beforeAll(async ({ request }) => {
  d = await discover(request);
});

const WIDTHS = [766, 768, 1022, 1024, 1278, 1280] as const;

for (const width of WIDTHS) {
  test(`create at ${width}`, async ({ page }) => {
    await prep(page);
    await page.setViewportSize({ width, height: 982 });
    await page.goto(`/${d.slug}/create`);
    await shot(page, `create-${width}`);
  });

  test(`products at ${width}`, async ({ page }) => {
    await prep(page);
    await page.setViewportSize({ width, height: 982 });
    await page.goto(`/${d.slug}/products`);
    await shot(page, `products-${width}`);
  });
}
