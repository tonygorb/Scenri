import { test, expect } from '@playwright/test';
import { isolate } from './harness.js';

/**
 * The same dialog, docked to the bottom edge. A phone gets a sheet rather than
 * a shrunken desktop dialog, and everything that matters — the version, the
 * sections, the way out — has to survive the change of geometry.
 */

// A scenri of this file's own, on an empty home, seeded from scratch.
isolate();

const ENTRY = {
  version: '9.9.9',
  date: '2026-08-16',
  sections: [
    { heading: 'Create', body: 'Improved asset selection and refinement.' },
    { heading: 'Scenes', body: '10 new creative Scenes.' },
  ],
};

test("What's new is a bottom sheet on a phone, and closes by hand", async ({ page }, testInfo) => {
  await page.route('**/api/release/notes', (route) =>
    route.fulfill({
      json: {
        version: ENTRY.version,
        entry: ENTRY,
        seen: '0.0.1',
        changelogUrl: 'https://github.com/tonygorb/scenri/releases/tag/v9.9.9',
      },
    }),
  );

  // captured, never forwarded: a real POST would write a version this build has
  // never heard of into the shared home, and every later spec would then be met
  // with a modal of its own
  await page.route('**/api/release/seen', (route) => route.fulfill({ json: { ok: true } }));

  await page.goto('/');
  const sheet = page.locator('.sc-wn');
  await expect(sheet).toBeVisible({ timeout: 8000 });
  await expect(page.locator('.sc-wn-head')).toHaveText(['Create', 'Scenes']);

  const box = await sheet.boundingBox();
  const viewport = page.viewportSize();
  if (!box || !viewport) throw new Error('no geometry');

  if (viewport.width < 768) {
    // docked: full width, sitting on the bottom edge
    expect(Math.round(box.width)).toBe(viewport.width);
    expect(Math.round(box.y + box.height)).toBeGreaterThanOrEqual(viewport.height - 1);
  } else {
    // a tablet is wide enough for the centred dialog, and must not be a sheet
    expect(box.width).toBeLessThan(viewport.width);
    expect(box.y).toBeGreaterThan(0);
  }
  // the page behind it must never scroll sideways because of this
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);

  await page.locator('.sc-wn .sc-btn-primary', { hasText: 'Got it' }).click();
  await expect(sheet).toHaveCount(0);
  expect(testInfo.project.name).toBeTruthy();
});
