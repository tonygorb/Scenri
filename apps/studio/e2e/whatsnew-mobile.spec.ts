import { test, expect } from '@playwright/test';
import { isolate } from './harness.js';

/**
 * The same dialog, docked to the bottom edge. A phone gets a sheet rather than
 * a shrunken desktop dialog, and everything that matters — the version, the
 * sections, the releases behind them, the way out — has to survive the change
 * of geometry.
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

/** One of them touches every area, so its summary is long enough to wrap. */
const HISTORY = [
  {
    version: '9.9.8',
    date: '2026-08-09',
    title: 'A headline the earlier list deliberately does not show.',
    sections: [
      { heading: 'Presenters', body: 'a' },
      { heading: 'Products', body: 'b' },
      { heading: 'Scenes', body: 'c' },
      { heading: 'Updates', body: 'd' },
    ],
  },
  {
    version: '9.9.7',
    date: '2026-08-02',
    sections: [{ heading: 'Fixes', body: 'Drafts survive a brand switch.' }],
  },
];

test("What's new is a bottom sheet on a phone, and closes by hand", async ({ page }, testInfo) => {
  await page.route('**/api/release/notes', (route) =>
    route.fulfill({
      json: {
        version: ENTRY.version,
        entry: ENTRY,
        releases: [ENTRY, ...HISTORY],
        seen: '0.0.1',
        changelogUrl: 'https://github.com/tonygorb/scenri/releases/tag/v9.9.9',
        releasesUrl: 'https://github.com/tonygorb/scenri/releases',
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
  // the footnote survives the change of geometry, and so does the way out
  await expect(page.locator('.sc-wn-rel')).toHaveCount(HISTORY.length);
  await expect(page.locator('.sc-wn-rel-sum').first()).toHaveText('Presenters, Products, Scenes, Updates');
  await expect(page.locator('.sc-wn-link')).toHaveText(/All releases/);

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
  // the page behind it must never scroll sideways because of this, and neither
  // must a release title long enough to want to
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  const summary = await page.locator('.sc-wn-rel-sum').first().boundingBox();
  expect((summary?.x ?? 0) + (summary?.width ?? 0)).toBeLessThanOrEqual(box.x + box.width + 1);

  await page.locator('.sc-wn .sc-btn-primary', { hasText: 'Got it' }).click();
  await expect(sheet).toHaveCount(0);
  expect(testInfo.project.name).toBeTruthy();
});
