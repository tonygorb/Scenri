import { test, expect, type Page } from '@playwright/test';
import { isolate } from './harness.js';

/**
 * What's new — the version you are running.
 *
 * The shared server is enough here: this feature never touches the registry
 * (updates.spec.ts owns that machinery). What it does touch is one local read,
 * so the unread cases stub that read rather than writing acknowledgements into
 * the shared home and leaking them into the next spec.
 */

isolate();

const NOTES_URL = '**/api/release/notes';
const SEEN_URL = '**/api/release/seen';
const RELEASES_URL = 'https://github.com/tonygorb/scenri/releases';

const ENTRY = {
  version: '9.9.9',
  date: '2026-08-16',
  title: 'A short headline for this release.',
  sections: [
    { heading: 'Create', body: 'Improved asset selection and refinement.' },
    { heading: 'Scenes', body: '10 new creative Scenes.' },
    { heading: 'Fixes', body: 'Presenter consistency and mobile layout stability.' },
  ],
};

const notes = (over: Record<string, unknown> = {}) => ({
  version: ENTRY.version,
  entry: ENTRY,
  seen: ENTRY.version,
  changelogUrl: `https://github.com/tonygorb/scenri/releases/tag/v${ENTRY.version}`,
  releasesUrl: RELEASES_URL,
  ...over,
});

const stub = (page: Page, over: Record<string, unknown> = {}) =>
  page.route(NOTES_URL, (route) => route.fulfill({ json: notes(over) }));

async function stubUnread(page: Page, over: Record<string, unknown> = {}): Promise<string[]> {
  const acked: string[] = [];
  await stub(page, { seen: '0.0.1', ...over });
  await page.route(SEEN_URL, async (route) => {
    acked.push(String(route.request().postDataJSON()?.version));
    await route.fulfill({ json: { ok: true } });
  });
  return acked;
}

const dialog = (p: Page) => p.locator('.sc-wn');
const menuTrigger = (p: Page) => p.locator('.sc-org-btn');
const openByHand = async (p: Page) => {
  await menuTrigger(p).click();
  await p.locator('.sc-menu-item', { hasText: "What's new" }).click();
  await expect(dialog(p)).toBeVisible();
};

test('a release already acknowledged says nothing: no dialog, no dot', async ({ page }) => {
  await stub(page);
  await page.goto('/');
  await expect(page.locator('.sc-greet')).toBeVisible();
  await page.waitForTimeout(3500);
  await expect(dialog(page)).toHaveCount(0);
  await expect(menuTrigger(page).locator('.sc-upd-dot')).toHaveCount(0);
});

test('an unread release introduces itself once the screen is quiet', async ({ page }) => {
  await stubUnread(page);
  await page.goto('/');
  await expect(page.locator('.sc-greet')).toBeVisible();

  await expect(dialog(page)).toBeVisible({ timeout: 8000 });
  await expect(page.getByRole('dialog')).toHaveAccessibleName("What's new");
  await expect(page.locator('.sc-wn-sub')).toHaveText('Version 9.9.9 · 16 August 2026');
  await expect(page.locator('.sc-wn .sc-tag')).toHaveCount(0);
  await expect(page.locator('.sc-wn-lede')).toHaveText(ENTRY.title);
  await expect(page.locator('.sc-wn-head')).toHaveText(['Create', 'Scenes', 'Fixes']);
  await expect(page.locator('.sc-wn-link')).toHaveAttribute('href', RELEASES_URL);
  await expect(page.locator('.sc-wn .sc-btn-primary')).toHaveText('Got it');
});

test('the serif is spent once, on a headline', async ({ page }) => {
  await stubUnread(page);
  await page.goto('/');
  await expect(dialog(page)).toBeVisible({ timeout: 8000 });
  await expect(page.locator('.sc-wn .sc-accent')).toHaveCount(1);
  const font = await page.evaluate(() => getComputedStyle(document.querySelector('.sc-wn-lede') as Element).fontFamily);
  expect(font).toContain('Playfair');
});

test('a single-section release is the sentence, with no area heading', async ({ page }) => {
  const one = {
    version: '9.9.9',
    date: '2026-08-16',
    sections: [{ heading: 'Fixes', body: 'Notifications no longer fire twice.' }],
  };
  await stubUnread(page, { version: one.version, entry: one });
  await page.goto('/');
  await expect(dialog(page)).toBeVisible({ timeout: 8000 });
  await expect(page.locator('.sc-wn-txt')).toHaveText('Notifications no longer fire twice.');
  await expect(page.locator('.sc-wn-head')).toHaveCount(0);
});

test('closing it is the acknowledgement, and it does not come back', async ({ page }) => {
  const acked = await stubUnread(page);
  await page.goto('/');
  await expect(dialog(page)).toBeVisible({ timeout: 8000 });
  await page.keyboard.press('Escape');
  await expect(dialog(page)).toHaveCount(0);
  expect(acked).toEqual(['9.9.9']);
  await expect(menuTrigger(page).locator('.sc-upd-dot')).toHaveCount(0);
  await page.waitForTimeout(3500);
  await expect(dialog(page)).toHaveCount(0);
});

test('it never stacks on a dialog that already owns the screen', async ({ page }) => {
  await stubUnread(page);
  await page.goto('/e2e-fixture?settings=about');
  await expect(page.locator('.sc-set')).toBeVisible();
  await page.waitForTimeout(4000);
  await expect(dialog(page)).toHaveCount(0);

  await page
    .locator('.sc-set .sc-set-row')
    .filter({ hasText: "What's new" })
    .locator('button', { hasText: 'Show' })
    .click();
  await expect(dialog(page)).toBeVisible();
});

test('the brand menu carries it permanently, and marks it unread without relying on colour', async ({ page }) => {
  await stubUnread(page);
  await page.goto('/');
  await expect(dialog(page)).toBeVisible({ timeout: 8000 });
  await page.keyboard.press('Escape');

  await menuTrigger(page).click();
  const row = page.locator('.sc-menu-item', { hasText: "What's new" });
  await expect(row).toBeVisible();
  await expect(row.locator('.sc-menu-new')).toHaveCount(0);
  await row.click();
  await expect(dialog(page)).toBeVisible();
});

test('the unread marker is spoken as well as shown', async ({ page }) => {
  await stubUnread(page);
  await page.goto('/');
  await menuTrigger(page).click();
  const row = page.locator('.sc-menu-item', { hasText: "What's new" });
  await expect(row.locator('.sc-menu-new')).toBeVisible();
  await expect(row.locator('.sc-vh')).toHaveText(', not read yet');
});

test('a version that shipped without notes still opens, and still links out', async ({ page }) => {
  await stub(page, { entry: null });
  await page.goto('/');
  await expect(page.locator('.sc-greet')).toBeVisible();
  await openByHand(page);
  await expect(page.locator('.sc-wn-sub')).toHaveText('Version 9.9.9');
  await expect(page.locator('.sc-wn-txt')).toContainText('without a written summary');
  await expect(page.locator('.sc-wn-link')).toHaveAttribute('href', RELEASES_URL);
});

test('it opens without a ring on anything, and the trap still holds', async ({ page }) => {
  await stubUnread(page);
  await page.goto('/');
  await expect(dialog(page)).toBeVisible({ timeout: 8000 });

  // DialogSheet aims focus at the Radix Content, which is the element that
  // carries role="dialog", the accessible name and the focus trap. `.sc-wn` is
  // the card painted inside it, so the surface that takes focus is the one
  // holding the card, not the card itself.
  const onOpen = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    const cs = el ? getComputedStyle(el) : null;
    return {
      isDialog: el?.getAttribute('role') === 'dialog',
      holdsCard: !!el?.querySelector('.sc-wn'),
      outline: !cs || cs.outlineStyle === 'none' ? '0px' : cs.outlineWidth,
    };
  });
  expect(onOpen).toEqual({ isDialog: true, holdsCard: true, outline: '0px' });

  await expect(page.getByRole('dialog')).toHaveAccessibleName("What's new");

  const stops: string[] = [];
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press('Tab');
    stops.push(
      await page.evaluate(() => {
        const el = document.activeElement;
        if (!el?.closest('.sc-wn')) return 'ESCAPED';
        return el.getAttribute('aria-label') ?? el.textContent?.trim().slice(0, 20) ?? '';
      }),
    );
  }
  expect(stops).toEqual(['Close', 'All releases', 'Got it', 'Close']);
});

test('a maintenance release says nothing of its own', async ({ page }) => {
  await stub(page, {
    entry: { version: ENTRY.version, date: ENTRY.date, sections: [] },
    seen: '0.0.1',
  });
  await page.goto('/');
  await expect(page.locator('.sc-greet')).toBeVisible();
  await page.waitForTimeout(4000);

  await expect(dialog(page)).toHaveCount(0);
  await expect(menuTrigger(page).locator('.sc-upd-dot')).toHaveCount(0);

  await menuTrigger(page).click();
  const row = page.locator('.sc-menu-item', { hasText: "What's new" });
  await expect(row.locator('.sc-menu-new')).toHaveCount(0);
  await row.click();
  await expect(dialog(page)).toBeVisible();
  await expect(page.locator('.sc-wn-txt')).toContainText('Maintenance only');
});

test('a failed read says so, instead of accusing the release of having no notes', async ({ page }) => {
  await page.route(NOTES_URL, (route) => route.fulfill({ status: 404, json: { error: 'not found' } }));
  await page.goto('/');
  await expect(page.locator('.sc-greet')).toBeVisible();
  await page.waitForTimeout(3500);

  await expect(dialog(page)).toHaveCount(0);
  await expect(menuTrigger(page).locator('.sc-upd-dot')).toHaveCount(0);

  await openByHand(page);
  await expect(page.locator('.sc-wn-sub')).toHaveText('Release notes unavailable');
  await expect(page.locator('.sc-wn-txt')).toContainText('could not read its release notes');
  await expect(page.locator('.sc-wn-txt')).not.toContainText('without a written summary');
});

test('a development build says so, instead of blaming a release that never happened', async ({ page }) => {
  await stub(page, { version: '0.0.0', entry: null, changelogUrl: null });
  await page.goto('/');
  await expect(page.locator('.sc-greet')).toBeVisible();
  await page.waitForTimeout(3500);
  await expect(dialog(page)).toHaveCount(0);

  await openByHand(page);
  await expect(page.locator('.sc-wn-sub')).toHaveText('Development build');
  await expect(page.locator('.sc-wn-txt')).toContainText('running a development build');
  await expect(page.locator('.sc-wn-txt')).not.toContainText('without a written summary');
});

test('a project that has never released offers no link to an empty page', async ({ page }) => {
  await stub(page, { version: '0.0.0', entry: null, changelogUrl: null, releases: [], releasesUrl: null });
  await page.goto('/');
  await expect(page.locator('.sc-greet')).toBeVisible();
  await openByHand(page);
  await expect(page.locator('.sc-wn-sub')).toHaveText('Development build');
  await expect(page.locator('.sc-wn-link')).toHaveCount(0);
  await expect(page.locator('.sc-wn .sc-btn-primary')).toBeVisible();
});
