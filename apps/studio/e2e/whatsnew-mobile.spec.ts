import { test, expect, type Page } from '@playwright/test';
import { isolate } from './harness.js';

/**
 * The same dialog, docked to the bottom edge. A phone gets a sheet rather than
 * a shrunken desktop dialog.
 */

isolate();

// Both tests wait out the 2.5s auto-open settle; shorten it before boot.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('scenri:whatsnew-settle-ms', '300'));
});

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
        releasesUrl: 'https://github.com/tonygorb/scenri/releases',
      },
    }),
  );
  await page.route('**/api/release/seen', (route) => route.fulfill({ json: { ok: true } }));

  await page.goto('/');
  const sheet = page.locator('.sc-wn');
  await expect(sheet).toBeVisible({ timeout: 8000 });
  await expect(page.locator('.sc-wn-head')).toHaveText(['Create', 'Scenes']);
  await expect(page.locator('.sc-wn-link')).toHaveText(/All releases/);

  const box = await sheet.boundingBox();
  const viewport = page.viewportSize();
  if (!box || !viewport) throw new Error('no geometry');

  if (viewport.width < 768) {
    expect(Math.round(box.width)).toBe(viewport.width);
    expect(Math.round(box.y + box.height)).toBeGreaterThanOrEqual(viewport.height - 1);
  } else {
    expect(box.width).toBeLessThan(viewport.width);
    expect(box.y).toBeGreaterThan(0);
  }

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);

  await page.locator('.sc-wn .sc-btn-primary', { hasText: 'Got it' }).click();
  await expect(sheet).toHaveCount(0);
  expect(testInfo.project.name).toBeTruthy();
});

async function settledBox(p: Page, sel: string) {
  let last = (await p.locator(sel).boundingBox())!;
  for (let i = 0; i < 20; i++) {
    await p.waitForTimeout(50);
    const now = (await p.locator(sel).boundingBox())!;
    if (Math.abs(now.y - last.y) < 0.5) return now;
    last = now;
  }
  return last;
}

async function dragSheet(p: Page, grip: string, dy: number) {
  const box = await settledBox(p, grip);
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await p.mouse.move(x, y);
  await p.mouse.down();
  await p.mouse.move(x, y + dy, { steps: 10 });
  await p.waitForTimeout(200);
  await p.mouse.up();
}

test("What's new is dragged away, and springs back from a nudge", async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 0) >= 768, 'the sheet only exists below 768px');

  await page.route('**/api/release/notes', (route) =>
    route.fulfill({
      json: {
        version: ENTRY.version,
        entry: ENTRY,
        seen: '0.0.1',
        changelogUrl: 'https://github.com/tonygorb/scenri/releases/tag/v9.9.9',
        releasesUrl: 'https://github.com/tonygorb/scenri/releases',
      },
    }),
  );
  await page.route('**/api/release/seen', (route) => route.fulfill({ json: { ok: true } }));

  await page.goto('/');
  const sheet = page.locator('.sc-wn');
  await expect(sheet).toBeVisible({ timeout: 8000 });

  const pull = (dy: number) => dragSheet(page, '.sc-wn > .sc-shotsheet-grip', dy);
  await pull(24);
  await expect(sheet).toBeVisible();
  await expect.poll(() => sheet.evaluate((el) => el.style.transform)).toBe('');

  await pull(200);
  await expect(sheet).toHaveCount(0);
});
