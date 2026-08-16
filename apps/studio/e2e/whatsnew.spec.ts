import { test, expect, type Page } from '@playwright/test';
import { isolate } from './harness.js';

/**
 * What's new — the version you are running, and the few behind it.
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

/** Two written releases behind the one running, newest first. */
const HISTORY = [
  {
    version: '9.9.8',
    date: '2026-08-09',
    title: 'Sets, and a steadier feed.',
    sections: [{ heading: 'Create', body: 'Sets group a shoot without moving anything.' }],
  },
  {
    version: '9.9.7',
    date: '2026-08-02',
    sections: [
      { heading: 'Products', body: 'Uploads keep their background.' },
      { heading: 'Fixes', body: 'The composer no longer loses a draft on a brand switch.' },
    ],
  },
];

/** Everything the route answers, with only the parts a case cares about set. */
const notes = (over: Record<string, unknown> = {}) => ({
  version: ENTRY.version,
  entry: ENTRY,
  releases: [ENTRY, ...HISTORY],
  seen: ENTRY.version,
  changelogUrl: `https://github.com/tonygorb/scenri/releases/tag/v${ENTRY.version}`,
  releasesUrl: RELEASES_URL,
  ...over,
});

const stub = (page: Page, over: Record<string, unknown> = {}) =>
  page.route(NOTES_URL, (route) => route.fulfill({ json: notes(over) }));

/**
 * The app as it looks to someone who has not read this version's notes yet.
 *
 * The acknowledgement is captured rather than forwarded, on purpose: a real
 * POST would write a version this build has never heard of into the shared
 * home, and every later spec would then be met with a modal of its own.
 */
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
  // What a fresh install looks like from the browser's side: the server seeds
  // the first boot of a home as already seen, so a person who has never used
  // scenri is not met with a modal about changes. (That the server does the
  // seeding is proven in releaseNotes.test.ts; this is the consequence.)
  await stub(page);
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
  // The title is the surface, not the version — asserted through the
  // accessible name, which is exactly what a screen reader is handed when the
  // dialog takes focus.
  await expect(page.getByRole('dialog')).toHaveAccessibleName("What's new");
  // The version is a fact under it, spoken as a sentence rather than as two
  // bare numbers.
  await expect(page.locator('.sc-wn-sub')).toHaveText('Version 9.9.9 · 16 August 2026');
  await expect(page.locator('.sc-wn-lede')).toHaveText(ENTRY.title);
  await expect(page.locator('.sc-wn-head')).toHaveText(['Create', 'Scenes', 'Fixes']);
  await expect(page.locator('.sc-wn-link')).toHaveAttribute('href', RELEASES_URL);
  await expect(page.locator('.sc-wn .sc-btn-primary')).toHaveText('Got it');
});

test('the releases behind it are a footnote: three at most, never the one running', async ({ page }) => {
  await stubUnread(page);
  await page.goto('/');
  await expect(dialog(page)).toBeVisible({ timeout: 8000 });

  await expect(page.locator('.sc-wn-earlier-lb')).toHaveText('Earlier releases');
  await expect(page.locator('.sc-wn-rel')).toHaveCount(HISTORY.length);
  await expect(page.locator('.sc-wn-rel-meta')).toHaveText([
    'Version 9.9.8 · 9 August 2026',
    'Version 9.9.7 · 2 August 2026',
  ]);
  // A release with a headline says it; one without names the areas it touched,
  // which is a fact already in the record rather than a summary invented here.
  await expect(page.locator('.sc-wn-rel-sum')).toHaveText(['Sets, and a steadier feed.', 'Products, Fixes']);
  // The running version is the hero above, never also a row below.
  await expect(page.locator('.sc-wn-rel-meta').filter({ hasText: '9.9.9' })).toHaveCount(0);
});

test('a long history stays three rows and the same dialog', async ({ page }) => {
  const many = Array.from({ length: 50 }, (_, i) => ({
    version: `9.9.${9 - i}`,
    date: '2026-08-16',
    sections: [{ heading: 'Fixes', body: `Round ${i}.` }],
  }));
  await stubUnread(page, { version: many[0].version, entry: many[0], releases: many });
  await page.goto('/');
  await expect(dialog(page)).toBeVisible({ timeout: 8000 });
  await expect(page.locator('.sc-wn-rel')).toHaveCount(3);

  const box = await dialog(page).boundingBox();
  expect(box?.height ?? 0).toBeLessThanOrEqual(640);
});

test('a first release shows no empty heading over nothing', async ({ page }) => {
  await stubUnread(page, { releases: [ENTRY] });
  await page.goto('/');
  await expect(dialog(page)).toBeVisible({ timeout: 8000 });
  await expect(page.locator('.sc-wn-head')).toHaveCount(3); // the hero is intact
  await expect(page.locator('.sc-wn-earlier')).toHaveCount(0);
  await expect(page.locator('.sc-wn-rel')).toHaveCount(0);
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

test('a version that shipped without notes still opens, and still has a history', async ({ page }) => {
  await stub(page, { entry: null, releases: HISTORY });
  await page.goto('/');
  await expect(page.locator('.sc-greet')).toBeVisible();
  await openByHand(page);
  await expect(page.locator('.sc-wn-sub')).toHaveText('Version 9.9.9');
  await expect(page.locator('.sc-wn-txt')).toContainText('without a written summary');
  // the archive is still where everything else lives
  await expect(page.locator('.sc-wn-link')).toHaveAttribute('href', RELEASES_URL);
  await expect(page.locator('.sc-wn-rel')).toHaveCount(HISTORY.length);
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

  await expect(page.getByRole('dialog')).toHaveAccessibleName("What's new");

  // Three stops and no more: the earlier releases are prose, not controls, so
  // reading the history costs a keyboard user nothing.
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

test('a maintenance release says nothing of its own, but still shows what came before', async ({ page }) => {
  // A version that changed nothing a user would notice still gets a record —
  // that is what keeps the release atomic — but its record carries no
  // sections. It never interrupts, and opening it by hand is now worth doing:
  // the releases behind it are the answer to why you came.
  await stub(page, {
    entry: { version: ENTRY.version, date: ENTRY.date, sections: [] },
    releases: HISTORY,
    seen: '0.0.1',
  });
  await page.goto('/');
  await expect(page.locator('.sc-greet')).toBeVisible();
  await page.waitForTimeout(4000); // well past the gate's settle window

  await expect(dialog(page)).toHaveCount(0);
  await expect(menuTrigger(page).locator('.sc-upd-dot')).toHaveCount(0);

  await menuTrigger(page).click();
  const row = page.locator('.sc-menu-item', { hasText: "What's new" });
  await expect(row.locator('.sc-menu-new')).toHaveCount(0);
  await row.click();
  await expect(dialog(page)).toBeVisible();
  await expect(page.locator('.sc-wn-txt')).toContainText('Maintenance only');
  await expect(page.locator('.sc-wn-rel')).toHaveCount(HISTORY.length);
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

  await openByHand(page);
  await expect(page.locator('.sc-wn-sub')).toHaveText('Release notes unavailable');
  await expect(page.locator('.sc-wn-txt')).toContainText('could not read its release notes');
  await expect(page.locator('.sc-wn-txt')).not.toContainText('without a written summary');
  await expect(page.locator('.sc-wn-earlier')).toHaveCount(0);
});

test('a development build says so, instead of blaming a release that never happened', async ({ page }) => {
  // 0.0.0 has never been tagged, so there is no page for *this build*. That
  // absence is what tells the dialog it is looking at a build rather than a
  // release nobody documented — the archive of everything already published
  // is a separate question and still answers.
  await stub(page, { version: '0.0.0', entry: null, changelogUrl: null, releases: HISTORY });
  await page.goto('/');
  await expect(page.locator('.sc-greet')).toBeVisible();
  await page.waitForTimeout(3500);
  await expect(dialog(page)).toHaveCount(0); // never on its own

  await openByHand(page);
  await expect(page.locator('.sc-wn-sub')).toHaveText('Development build');
  await expect(page.locator('.sc-wn-txt')).toContainText('running a development build');
  await expect(page.locator('.sc-wn-txt')).not.toContainText('without a written summary');
  await expect(page.locator('.sc-wn-rel')).toHaveCount(HISTORY.length);
});

test('a project that has never released offers no link to an empty page', async ({ page }) => {
  await stub(page, { version: '0.0.0', entry: null, changelogUrl: null, releases: [], releasesUrl: null });
  await page.goto('/');
  await expect(page.locator('.sc-greet')).toBeVisible();
  await openByHand(page);
  await expect(page.locator('.sc-wn-sub')).toHaveText('Development build');
  await expect(page.locator('.sc-wn-link')).toHaveCount(0);
  await expect(page.locator('.sc-wn-earlier')).toHaveCount(0);
  // the one button is still reachable, pushed to the edge on its own
  await expect(page.locator('.sc-wn .sc-btn-primary')).toBeVisible();
});
