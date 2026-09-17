import { test, expect, type Page } from '@playwright/test';
import { isolate } from './harness.js';
import { noWelcomeWait, setUpBrand, tourCard, tourTitle, tourX, welcome } from './firstUse.js';

/**
 * One voice at a time. Someone new is learning the version they installed, so
 * its notes never open over the welcome or a tour, and once first use ends
 * they count as read. The next version introduces itself as usual.
 */
isolate({ brand: false, env: { SCENRI_NO_GUIDE: '0' } });
test.describe.configure({ mode: 'serial' });

const SETTLE_MS = 300;
const ENTRY = {
  version: '9.9.9',
  date: '2026-08-16',
  sections: [{ heading: 'Create', body: 'Improved asset selection and refinement.' }],
};
const dialog = (p: Page) => p.locator('.sc-wn');

async function stubNotes(page: Page, version: string, seen: string): Promise<string[]> {
  const acked: string[] = [];
  await page.route('**/api/release/notes', (route) =>
    route.fulfill({
      json: { version, entry: { ...ENTRY, version }, seen, changelogUrl: null, releasesUrl: null },
    }),
  );
  await page.route('**/api/release/seen', async (route) => {
    acked.push(String(route.request().postDataJSON()?.version));
    await route.fulfill({ json: { ok: true } });
  });
  return acked;
}

test.beforeEach(async ({ page }) => {
  await noWelcomeWait(page);
  await page.addInitScript((ms) => localStorage.setItem('scenri:whatsnew-settle-ms', String(ms)), SETTLE_MS);
});

test('unread notes wait through the welcome and the tours, then count as read when first use ends', async ({
  page,
}) => {
  const acked = await stubNotes(page, '9.9.9', '9.9.8');
  const slug = await setUpBrand(page, 'One Voice');
  await expect(welcome(page)).toBeVisible();
  await page.waitForTimeout(SETTLE_MS * 5);
  await expect(dialog(page)).toHaveCount(0);

  await welcome(page).getByRole('button', { name: 'Take the tour' }).click();
  await expect(tourTitle(page)).toHaveText('Every shot starts as a brief');
  await page.waitForTimeout(SETTLE_MS * 5);
  await expect(dialog(page)).toHaveCount(0);
  await tourX(page).click();
  await expect(tourCard(page)).toHaveCount(0);
  await page.waitForTimeout(SETTLE_MS * 5);
  await expect(dialog(page)).toHaveCount(0);

  // Still carried by the menu, unread.
  await page.locator('.sc-org-btn').click();
  await expect(page.locator('.sc-menu-item', { hasText: "What's new" })).toContainText('not read yet');
  await page.keyboard.press('Escape');

  // A second closed tour turns tours off: first use is over, on this version.
  await page.goto(`/${slug}/create`);
  await expect(tourTitle(page)).toHaveText('Bring in what stays the same');
  await tourX(page).click();
  await expect.poll(() => acked).toEqual(['9.9.9']);
  await page.waitForTimeout(SETTLE_MS * 5);
  await expect(dialog(page)).toHaveCount(0);
});

test('the next version introduces itself on a quiet screen', async ({ page }) => {
  await stubNotes(page, '9.9.10', '9.9.9');
  await page.goto('/one-voice');
  await expect(page.locator('.sc-greet')).toBeVisible();
  await expect(dialog(page)).toBeVisible({ timeout: 8000 });
});
