import { test, expect, type Page } from '@playwright/test';
import { isolate } from './harness.js';

/**
 * What's new — the version you are running, not the one you could have.
 *
 * The shared server is enough here: this feature never touches the registry
 * (updates.spec.ts owns that machinery). What it does touch is one local read,
 * so the unread cases stub that read rather than writing acknowledgements into
 * the shared home and leaking them into the next spec.
 */

// A scenri of this file's own, on an empty home, seeded from scratch.
isolate();

const NOTES_URL = '**/api/release/notes';
const SEEN_URL = '**/api/release/seen';

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

/**
 * The app as it looks to someone who has not read this version's notes yet.
 *
 * The acknowledgement is captured rather than forwarded, on purpose: a real
 * POST would write a version this build has never heard of into the shared
 * home, and every later spec would then be met with a modal of its own.
 */
async function stubUnread(page: Page): Promise<string[]> {
  const acked: string[] = [];
  await page.route(NOTES_URL, (route) =>
    route.fulfill({
      json: {
        version: ENTRY.version,
        entry: ENTRY,
        seen: '0.0.1',
        changelogUrl: 'https://github.com/tonygorb/scenri/releases/tag/v9.9.9',
      },
    }),
  );
  await page.route(SEEN_URL, async (route) => {
    acked.push(String(route.request().postDataJSON()?.version));
    await route.fulfill({ json: { ok: true } });
  });
  return acked;
}

const dialog = (p: Page) => p.locator('.sc-wn');
const menuTrigger = (p: Page) => p.locator('.sc-org-btn');

test('a release already acknowledged says nothing: no dialog, no dot', async ({ page }) => {
  // What a fresh install looks like from the browser's side: the server seeds
  // the first boot of a home as already seen, so a person who has never used
  // scenri is not met with a modal about changes. (That the server does the
  // seeding is proven in releaseNotes.test.ts; this is the consequence.)
  await page.route(NOTES_URL, (route) =>
    route.fulfill({
      json: { version: ENTRY.version, entry: ENTRY, seen: ENTRY.version, changelogUrl: null },
    }),
  );
  await page.goto('/');
  await expect(page.locator('.sc-greet')).toBeVisible();
  await page.waitForTimeout(3500); // past the gate's settle window
  await expect(dialog(page)).toHaveCount(0);
  await expect(menuTrigger(page).locator('.sc-upd-dot')).toHaveCount(0);
});

test('an unread release introduces itself once the screen is quiet', async ({ page }) => {
  await stubUnread(page);
  await page.goto('/');
  await expect(page.locator('.sc-greet')).toBeVisible();

  await expect(dialog(page)).toBeVisible({ timeout: 8000 });
  // asserted through the accessible name rather than a Radix class: this is
  // exactly what a screen reader is handed when the dialog takes focus
  await expect(page.getByRole('dialog')).toHaveAccessibleName("What's new in scenri 9.9.9");
  await expect(page.locator('.sc-wn-sub')).toHaveText(ENTRY.title);
  await expect(page.locator('.sc-wn-head')).toHaveText(['Create', 'Scenes', 'Fixes']);
  await expect(page.locator('.sc-wn-link')).toHaveAttribute('href', /releases\/tag\/v9\.9\.9/);
  await expect(page.locator('.sc-wn .sc-btn-primary')).toHaveText('Got it');
});

test('closing it is the acknowledgement, and it does not come back', async ({ page }) => {
  const acked = await stubUnread(page);
  await page.goto('/');
  await expect(dialog(page)).toBeVisible({ timeout: 8000 });
  await page.keyboard.press('Escape');
  await expect(dialog(page)).toHaveCount(0);
  expect(acked).toEqual(['9.9.9']);

  // the dot goes with it, without waiting for a round trip
  await expect(menuTrigger(page).locator('.sc-upd-dot')).toHaveCount(0);

  // and it stays gone for the rest of the session
  await page.waitForTimeout(3500);
  await expect(dialog(page)).toHaveCount(0);
});

test('it never stacks on a dialog that already owns the screen', async ({ page }) => {
  await stubUnread(page);
  await page.goto('/e2e-fixture?settings=about');
  await expect(page.locator('.sc-set')).toBeVisible();
  await page.waitForTimeout(4000);
  await expect(dialog(page)).toHaveCount(0);

  // still reachable on purpose from inside Settings, where it stacks by request
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
  // read now, so no dot and no spoken marker
  await expect(row.locator('.sc-menu-new')).toHaveCount(0);
  await row.click();
  await expect(dialog(page)).toBeVisible();
});

test('the unread marker is spoken as well as shown', async ({ page }) => {
  await stubUnread(page);
  await page.goto('/');
  // open the menu before the gate fires, so the notes are still unread
  await menuTrigger(page).click();
  const row = page.locator('.sc-menu-item', { hasText: "What's new" });
  await expect(row.locator('.sc-menu-new')).toBeVisible();
  await expect(row.locator('.sc-vh')).toHaveText(', not read yet');
});

test('a version that shipped without notes still opens and still links out', async ({ page }) => {
  await page.route(NOTES_URL, (route) =>
    route.fulfill({
      json: {
        version: '9.9.9',
        entry: null,
        seen: '9.9.9',
        changelogUrl: 'https://github.com/tonygorb/scenri/releases/tag/v9.9.9',
      },
    }),
  );
  await page.goto('/');
  await expect(page.locator('.sc-greet')).toBeVisible();
  await menuTrigger(page).click();
  await page.locator('.sc-menu-item', { hasText: "What's new" }).click();
  await expect(dialog(page)).toBeVisible();
  await expect(page.locator('.sc-wn-txt')).toContainText('without a written summary');
  await expect(page.locator('.sc-wn-link')).toBeVisible();
});

test('it opens without a ring on anything, and the trap still holds', async ({ page }) => {
  await stubUnread(page);
  await page.goto('/');
  await expect(dialog(page)).toBeVisible({ timeout: 8000 });

  // Focus enters the dialog so it is announced and Escape works, but the
  // surface must not paint the control ring — a ring on arrival reads as an
  // error on a control nobody aimed at. Both halves live in one place:
  // focusSelfOnOpen (app/dialogs.ts) and .rt-BaseDialogContent:focus in
  // tokens.css.
  const onOpen = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    const cs = el ? getComputedStyle(el) : null;
    return {
      insideDialog: !!el?.closest('.sc-wn'),
      isSurface: !!el?.classList.contains('sc-wn'),
      outline: !cs || cs.outlineStyle === 'none' ? '0px' : cs.outlineWidth,
    };
  });
  expect(onOpen).toEqual({ insideDialog: true, isSurface: true, outline: '0px' });

  // the accessible name is still the release heading
  await expect(page.getByRole('dialog')).toHaveAccessibleName("What's new in scenri 9.9.9");

  // and tabbing cycles inside, starting at the close button
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
  expect(stops).toEqual(['Close', 'Full changelog', 'Got it', 'Close']);
});

test('a maintenance release says nothing at all, but is still reachable', async ({ page }) => {
  // A version that changed nothing a user would notice still gets a record —
  // that is what keeps the release atomic — but its record carries no
  // sections, and an empty dialog is worse than no dialog.
  await page.route(NOTES_URL, (route) =>
    route.fulfill({
      json: {
        version: '9.9.9',
        entry: { version: '9.9.9', date: '2026-08-16', sections: [] },
        seen: '0.0.1',
        changelogUrl: 'https://github.com/tonygorb/scenri/releases/tag/v9.9.9',
      },
    }),
  );
  await page.goto('/');
  await expect(page.locator('.sc-greet')).toBeVisible();
  await page.waitForTimeout(4000); // well past the gate's settle window

  await expect(dialog(page)).toHaveCount(0);
  await expect(menuTrigger(page).locator('.sc-upd-dot')).toHaveCount(0);

  // reachable on purpose, and honest about why it is empty
  await menuTrigger(page).click();
  const row = page.locator('.sc-menu-item', { hasText: "What's new" });
  await expect(row.locator('.sc-menu-new')).toHaveCount(0);
  await row.click();
  await expect(dialog(page)).toBeVisible();
  await expect(page.locator('.sc-wn-txt')).toContainText('Maintenance only');
  await expect(page.locator('.sc-wn-link')).toBeVisible();
});

test('a failed read says so, instead of accusing the release of having no notes', async ({ page }) => {
  // The state a stale dev server produces: /api/version answers, the release
  // route does not exist yet. "Could not read" and "nothing was written" are
  // different sentences and the dialog has to pick the right one.
  await page.route(NOTES_URL, (route) => route.fulfill({ status: 404, json: { error: 'not found' } }));
  await page.goto('/');
  await expect(page.locator('.sc-greet')).toBeVisible();
  await page.waitForTimeout(3500);

  // nothing auto-opens, and nothing claims to be unread
  await expect(dialog(page)).toHaveCount(0);
  await expect(menuTrigger(page).locator('.sc-upd-dot')).toHaveCount(0);

  await menuTrigger(page).click();
  await page.locator('.sc-menu-item', { hasText: "What's new" }).click();
  await expect(dialog(page)).toBeVisible();
  await expect(page.locator('.sc-wn-sub')).toHaveText('Release notes unavailable');
  await expect(page.locator('.sc-wn-txt')).toContainText('could not read its release notes');
  await expect(page.locator('.sc-wn-txt')).not.toContainText('without a written summary');
});

test('a development build says so, instead of blaming a release that never happened', async ({ page }) => {
  // 0.0.0 has never been tagged and the releases page of an unreleased project
  // is empty, so there is nowhere honest to point. No link is what tells the
  // dialog it is looking at a build, not a release nobody documented.
  await page.route(NOTES_URL, (route) =>
    route.fulfill({ json: { version: '0.0.0', entry: null, seen: '0.0.0', changelogUrl: null } }),
  );
  await page.goto('/');
  await expect(page.locator('.sc-greet')).toBeVisible();
  await page.waitForTimeout(3500);
  await expect(dialog(page)).toHaveCount(0); // never on its own

  await menuTrigger(page).click();
  await page.locator('.sc-menu-item', { hasText: "What's new" }).click();
  await expect(dialog(page)).toBeVisible();
  await expect(page.locator('.sc-wn-sub')).toHaveText('Development build');
  await expect(page.locator('.sc-wn-txt')).toContainText('running a development build');
  await expect(page.locator('.sc-wn-txt')).not.toContainText('without a written summary');
  // no dead-end link to an empty releases page
  await expect(page.locator('.sc-wn-link')).toHaveCount(0);
});
