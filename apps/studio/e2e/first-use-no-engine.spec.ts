import { test, expect, type Page } from '@playwright/test';
import { isolate } from './harness.js';
import { coachCard, coachTitle, expectHeld, noWelcomeWait, pointsAt, setUpBrand, welcome } from './firstUse.js';

/**
 * Someone new with nothing to generate with: the welcome says so up front, and
 * the first shot starts at the setup the composer already offers. Their
 * version's notes wait through all of it and count as read once first use ends.
 */
isolate({ brand: false, env: { SCENRI_NO_GUIDE: '0', SCENRI_DEMO_ENGINE: '0' } });

const SETTLE_MS = 300;
const dialog = (p: Page) => p.locator('.sc-wn');

test("the first shot begins at the setup, and What's New waits and then counts as read", async ({ page }) => {
  test.setTimeout(60_000);
  await noWelcomeWait(page);
  await page.addInitScript((ms) => localStorage.setItem('scenri:whatsnew-settle-ms', String(ms)), SETTLE_MS);
  const acked: string[] = [];
  await page.route('**/api/release/notes', (route) =>
    route.fulfill({
      json: {
        version: '9.9.9',
        entry: { version: '9.9.9', date: '2026-09-17', sections: [{ heading: 'Create', body: 'Better picks.' }] },
        seen: '9.9.8',
        changelogUrl: null,
        releasesUrl: null,
      },
    }),
  );
  await page.route('**/api/release/seen', async (route) => {
    acked.push(String(route.request().postDataJSON()?.version));
    await route.fulfill({ json: { ok: true } });
  });
  await page.setViewportSize({ width: 1440, height: 900 });

  await setUpBrand(page, 'No Engine');
  await expect(welcome(page)).toContainText('It starts with a short setup for image generation.');
  await page.waitForTimeout(SETTLE_MS * 5);
  await expect(dialog(page)).toHaveCount(0);

  await welcome(page).getByRole('button', { name: 'Make your first shot' }).click();
  await expect(coachTitle(page)).toHaveText('Connect image generation');
  await pointsAt(page, '[data-guide="compose.engine"]');
  await expectHeld(page);
  await page.waitForTimeout(SETTLE_MS * 5);
  await expect(dialog(page)).toHaveCount(0);

  // The setup is the composer's own; the guide waits under it.
  await page.locator('[data-guide="compose.engine"]').click();
  await expect(page).toHaveURL(/setup=/);
  await expect(coachCard(page)).toHaveCount(0);
  await expect(dialog(page)).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(coachTitle(page)).toHaveText('Connect image generation');

  await coachCard(page).getByRole('button', { name: 'Close guide' }).click();
  await expect(coachCard(page)).toHaveCount(0);
  await page.waitForTimeout(SETTLE_MS * 5);
  await expect(dialog(page)).toHaveCount(0);
  expect(acked).toContain('9.9.9');
});
