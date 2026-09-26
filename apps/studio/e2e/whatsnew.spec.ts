import { test, expect, type Locator, type Page } from '@playwright/test';
import { isolate } from './harness.js';
import { FIRST_USE } from '../src/firstUse.js';

/**
 * What's new, the dialog: one headline update, introduced once.
 *
 * The page it links to has its own file (whats-new-page.spec.ts). This one is
 * about when the dialog opens by itself, what it shows, and that every way out
 * of it is the acknowledgement.
 *
 * The notes read is stubbed in every test, and the stub answers the way the
 * server does (`notesFor` below), so a test can never hold the app to a
 * history the server could not send. Acknowledgements are routed and recorded
 * too, so nothing here writes into this file's home.
 */

isolate();

/**
 * The auto-open settle is 2.5s in production. Several assertions below prove
 * a negative ("no dialog appears") and must out-wait it, so the suite
 * shortens it before boot and waits five times the shortened value.
 */
const SETTLE_MS = 300;
const OUTWAIT_MS = SETTLE_MS * 5;
test.beforeEach(async ({ page }) => {
  await page.addInitScript((ms) => localStorage.setItem('scenri:whatsnew-settle-ms', String(ms)), SETTLE_MS);
});

const HOME = '/e2e-fixture';
const PAGE = '/e2e-fixture/whats-new';
const NOTES_URL = '**/api/release/notes';
const SEEN_URL = '**/api/release/seen';
const RELEASES_URL = 'https://github.com/tonygorb/scenri/releases';

type Picture = { file: string; alt: string };
type Section = { heading: string; body: string; image?: Picture };
type Rec = { version: string; date: string; title?: string; sections: Section[] };

/** Two pictures that ship in this build (src/assets/whatsnew), and one that does not. */
const PIC_A: Picture = { file: '0.19.0-home-examples.webp', alt: "Home's example wall, with tabs above it." };
const PIC_MISSING: Picture = { file: '9.9.9-missing.webp', alt: 'A picture this build does not carry.' };

const HEADLINE: Rec = {
  version: '9.9.9',
  date: '2026-08-16',
  title: 'A short headline for this release',
  sections: [
    { heading: 'Create', body: 'Improved asset selection and refinement.', image: PIC_A },
    { heading: 'Scenes', body: '10 new creative Scenes.' },
    { heading: 'Fixes', body: 'Presenter consistency and mobile layout stability.' },
  ],
};
const headline = (
  version: string,
  title: string,
  sections: Section[] = [{ heading: 'Create', body: 'Better picks.' }],
): Rec => ({
  version,
  date: '2026-08-10',
  title,
  sections,
});
const small = (version: string, body = 'Notifications no longer fire twice.'): Rec => ({
  version,
  date: '2026-08-12',
  sections: [{ heading: 'Fixes', body }],
});
const maintenance = (version: string): Rec => ({ version, date: '2026-08-16', sections: [] });

const cmp = (a: string, b: string): number => {
  const x = a.split('.').map(Number);
  const y = b.split('.').map(Number);
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
};

/**
 * What GET /api/release/notes answers for these records (routes/updates.ts and
 * whatsNewWindow in release/notes.data.ts): `recent`, `unseen` and `lead` are
 * derived here the way the server derives them, never written by hand.
 */
function notesFor(records: Rec[], running: string, seen: string | null, over: Record<string, unknown> = {}) {
  const released = running !== '0.0.0';
  const recent: Rec[] = [];
  let headlines = 0;
  for (const r of records) {
    if (headlines === 5) break;
    if (r.sections.length === 0) continue;
    if (released && cmp(r.version, running) > 0) continue;
    recent.push(r);
    if (r.title) headlines++;
  }
  const unseen = seen === null || !released ? [] : recent.filter((r) => cmp(seen, r.version) < 0).map((r) => r.version);
  return {
    version: running,
    entry: records.find((r) => r.version === running) ?? null,
    seen,
    recent,
    unseen,
    lead: recent.find((r) => r.title && unseen.includes(r.version))?.version ?? null,
    changelogUrl: released ? `${RELEASES_URL}/tag/v${running}` : null,
    releasesUrl: records.some((r) => r.sections.length > 0) ? RELEASES_URL : null,
    ...over,
  };
}

/**
 * This machine's notes, kept the way the server keeps them: `seen` only rises,
 * and a read after an acknowledgement answers from the new mark. Returns every
 * version the studio acknowledged, in order.
 */
async function serve(page: Page, records: Rec[], running: string, seen: string | null): Promise<string[]> {
  const acked: string[] = [];
  let mark = seen;
  await page.route(NOTES_URL, (route) => route.fulfill({ json: notesFor(records, running, mark) }));
  await page.route(SEEN_URL, async (route) => {
    const v = String(route.request().postDataJSON()?.version);
    acked.push(v);
    if (mark === null || cmp(v, mark) > 0) mark = v;
    await route.fulfill({ json: { ok: true } });
  });
  return acked;
}

const dialog = (p: Page) => p.locator('.sc-wn');
const dot = (p: Page) => p.locator('.sc-help-btn .sc-upd-dot');
const menuTrigger = (p: Page) => p.locator('.sc-help-btn');
const heading = (p: Page) => p.locator('#sc-wn-title');
const decoded = (img: Locator) =>
  img.evaluate((el) => (el as HTMLImageElement).complete && (el as HTMLImageElement).naturalWidth > 0);
const onPage = (u: URL) => u.pathname === PAGE && !u.searchParams.has('whatsnew');

test('a headline already read says nothing: no dialog, no dot', async ({ page }) => {
  const acked = await serve(page, [HEADLINE], '9.9.9', '9.9.9');
  await page.goto(HOME);
  await expect(page.locator('.sc-greet')).toBeVisible();
  await page.waitForTimeout(OUTWAIT_MS);
  await expect(dialog(page)).toHaveCount(0);
  await expect(dot(page)).toHaveCount(0);
  expect(acked).toEqual([]);
});

test('a headline update introduces itself once the screen is quiet, picture first, and Got it reads it for good', async ({
  page,
}) => {
  const acked = await serve(page, [HEADLINE], '9.9.9', '9.9.8');
  await page.goto(HOME);
  await expect(page.locator('.sc-greet')).toBeVisible();

  await expect(dialog(page)).toBeVisible({ timeout: 8000 });
  const box = page.getByRole('dialog');
  await expect(box).toHaveAccessibleName("What's new");
  // the update's own headline is what the dialog is described by
  await expect(box).toHaveAccessibleDescription(HEADLINE.title as string);

  // the picture leads, and it is the real file from the build, decoded
  await expect(dialog(page).locator('.sc-newdlg-body > :first-child')).toHaveClass(/\bsc-wn-pic\b/);
  const img = dialog(page).locator('figure.sc-wn-pic > img');
  await expect(img).toBeVisible();
  await expect(img).toHaveAttribute('alt', PIC_A.alt);
  await expect.poll(() => decoded(img)).toBe(true);
  await expect(dialog(page).locator('figure.sc-wn-pic')).toHaveAttribute('data-ready');

  await expect(dialog(page).locator('.sc-wn-when time')).toHaveText('16 August 2026');
  await expect(dialog(page).locator('.sc-wn-ver')).toHaveText('Version 9.9.9');
  await expect(dialog(page).locator('h3.sc-wn-hed')).toHaveText(HEADLINE.title as string);
  await expect(dialog(page).locator('ul.sc-wn-hls > li.sc-wn-hl')).toHaveText([
    'Create: Improved asset selection and refinement.',
    'Scenes: 10 new creative Scenes.',
    'Fixes: Presenter consistency and mobile layout stability.',
  ]);
  await expect(dialog(page).locator('.sc-wn-hl-h')).toHaveText(['Create', 'Scenes', 'Fixes']);
  await expect(dialog(page).locator('.sc-wn .sc-tag, .sc-wn .sc-accent')).toHaveCount(0);

  // the only update waiting is the one on screen
  const link = dialog(page).locator('a.sc-wn-link');
  await expect(link).toHaveText('See all updates');
  await expect(link).toHaveAttribute('href', PAGE);

  await dialog(page).getByRole('button', { name: 'Got it' }).click();
  await expect(dialog(page)).toHaveCount(0);
  await expect.poll(() => acked).toEqual(['9.9.9']);
  await expect(dot(page)).toHaveCount(0);

  // the server now holds 9.9.9 as read: a reload introduces nothing
  await page.reload();
  await expect(page.locator('.sc-greet')).toBeVisible();
  await page.waitForTimeout(OUTWAIT_MS);
  await expect(dialog(page)).toHaveCount(0);
  await expect(dot(page)).toHaveCount(0);
  expect(acked).toEqual(['9.9.9']);
});

const WAYS_OUT: ReadonlyArray<readonly [string, (p: Page) => Promise<unknown>]> = [
  ['Escape', (p) => p.keyboard.press('Escape')],
  ['the X', (p) => dialog(p).getByRole('button', { name: 'Close' }).click()],
  ['the backdrop', (p) => p.mouse.click(8, 8)],
  ['browser Back', (p) => p.goBack()],
];

for (const [way, leave] of WAYS_OUT) {
  test(`closing it by ${way} counts as read, and it does not come back`, async ({ page }) => {
    const acked = await serve(page, [HEADLINE], '9.9.9', '9.9.8');
    await page.goto(HOME);
    await expect(dialog(page)).toBeVisible({ timeout: 8000 });
    await leave(page);
    await expect(dialog(page)).toHaveCount(0);
    await expect(page).toHaveURL((u) => u.pathname === HOME && !u.searchParams.has('whatsnew'));
    await expect.poll(() => acked).toEqual(['9.9.9']);
    await expect(dot(page)).toHaveCount(0);
    await page.waitForTimeout(OUTWAIT_MS);
    await expect(dialog(page)).toHaveCount(0);
    expect(acked).toEqual(['9.9.9']);
  });
}

test('a single-area headline is its sentence, with no run-in heading', async ({ page }) => {
  const one = headline('9.9.9', 'Notifications, once', [
    { heading: 'Fixes', body: 'Notifications no longer fire twice.' },
  ]);
  await serve(page, [one], '9.9.9', '9.9.8');
  await page.goto(HOME);
  await expect(dialog(page)).toBeVisible({ timeout: 8000 });
  await expect(dialog(page).locator('.sc-wn-hl')).toHaveText(['Notifications no longer fire twice.']);
  await expect(dialog(page).locator('.sc-wn-hl-h')).toHaveCount(0);
  // no picture on the record: the dialog opens on when, not on an empty frame
  await expect(dialog(page).locator('.sc-wn-pic')).toHaveCount(0);
  await expect(dialog(page).locator('.sc-newdlg-body > :first-child')).toHaveClass(/\bsc-wn-when\b/);
});

test('a picture this build does not carry leaves no frame: the update reads as words', async ({ page }) => {
  const rec: Rec = {
    ...HEADLINE,
    sections: [{ heading: 'Create', body: 'Improved asset selection.', image: PIC_MISSING }, HEADLINE.sections[1]],
  };
  await serve(page, [rec], '9.9.9', '9.9.8');
  await page.goto(HOME);
  await expect(dialog(page)).toBeVisible({ timeout: 8000 });
  await expect(dialog(page).locator('.sc-wn-hed')).toHaveText(HEADLINE.title as string);
  await expect(dialog(page).locator('.sc-wn-hl')).toHaveCount(2);
  await expect(dialog(page).locator('figure, img, .sc-wn-pic')).toHaveCount(0);
  await expect(dialog(page).locator('.sc-newdlg-body > :first-child')).toHaveClass(/\bsc-wn-when\b/);
});

test('after several updates it leads with the newest headline, and its link counts the rest and leads to them', async ({
  page,
}) => {
  const records = [HEADLINE, small('9.9.8'), headline('9.9.7', 'An earlier headline')];
  const acked = await serve(page, records, '9.9.9', '9.9.6');
  await page.goto(HOME);
  await expect(dialog(page)).toBeVisible({ timeout: 8000 });
  await expect(dialog(page).locator('.sc-wn-hed')).toHaveText(HEADLINE.title as string);
  const link = dialog(page).locator('a.sc-wn-link');
  await expect(link).toHaveText('See 2 more updates');

  await link.click();
  await expect(page).toHaveURL(onPage);
  await expect(dialog(page)).toHaveCount(0);
  // the keyboard goes to the page it was sent to, not back to whatever the dialog opened over
  await expect(heading(page)).toBeFocused();
  await expect(page.locator('.sc-wn-row')).toHaveCount(3);
  // Leaving by the link closes the dialog and opens the page in one step, and
  // both read everything: that is one acknowledgement, not one each.
  await expect.poll(() => acked.length).toBeGreaterThan(0);
  await page.waitForTimeout(OUTWAIT_MS);
  expect(acked, 'the link to the page acknowledged 9.9.9 more than once').toEqual(['9.9.9']);

  // the link replaced the dialog's entry: Back is the page it opened over, and it stays quiet
  await page.goBack();
  await expect(page).toHaveURL((u) => u.pathname === HOME && !u.searchParams.has('whatsnew'));
  await page.waitForTimeout(OUTWAIT_MS);
  await expect(dialog(page)).toHaveCount(0);
  expect(acked).toEqual(['9.9.9']);
});

test('a small update never opens anything: Help carries the dot and a spoken marker, and its row reads it', async ({
  page,
}) => {
  const records = [small('9.9.9'), headline('9.9.8', 'The headline already read')];
  const acked = await serve(page, records, '9.9.9', '9.9.8');
  await page.goto(HOME);
  await expect(page.locator('.sc-greet')).toBeVisible();
  await expect(dot(page)).toBeVisible();
  await page.waitForTimeout(OUTWAIT_MS);
  await expect(dialog(page)).toHaveCount(0);
  await expect(dot(page)).toBeVisible();
  expect(acked).toEqual([]);

  await menuTrigger(page).click();
  const row = page.locator('.sc-help-menu .sc-menu-item', { hasText: "What's new" });
  await expect(row.locator('.sc-menu-new')).toBeVisible();
  await expect(row.locator('.sc-vh')).toHaveText(', not read yet');
  await expect(row).toHaveAccessibleName(/^What's new\s*, not read yet$/);

  await row.click();
  await expect(page).toHaveURL(onPage);
  await expect(heading(page)).toBeFocused();
  await expect.poll(() => acked).toEqual(['9.9.9']);
  await expect(dot(page)).toHaveCount(0);

  // the menu that led here finishes leaving before it is asked for again
  await expect(page.locator('.sc-help-menu')).toHaveCount(0);
  await menuTrigger(page).click();
  const after = page.locator('.sc-help-menu .sc-menu-item', { hasText: "What's new" });
  await expect(after).toBeVisible();
  await expect(after.locator('.sc-menu-new')).toHaveCount(0);
  await expect(after.locator('.sc-vh')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(OUTWAIT_MS);
  await expect(dialog(page)).toHaveCount(0);
  expect(acked).toEqual(['9.9.9']);
});

test("it never opens over the What's new page, and arriving there reads everything", async ({ page }) => {
  const acked = await serve(page, [HEADLINE], '9.9.9', '9.9.8');
  await page.goto(PAGE);
  await expect(heading(page)).toBeVisible();
  await expect.poll(() => acked).toEqual(['9.9.9']);
  await page.waitForTimeout(OUTWAIT_MS);
  await expect(dialog(page)).toHaveCount(0);
  await expect(dot(page)).toHaveCount(0);
  expect(acked).toEqual(['9.9.9']);
});

test('it waits while Learn owns the address, and introduces itself once Learn closes', async ({ page }) => {
  test.skip(!FIRST_USE, 'first use is paused (src/firstUse.ts)');
  const acked = await serve(page, [HEADLINE], '9.9.9', '9.9.8');
  await page.goto(`${HOME}?learn=lessons`);
  const learn = page.getByRole('dialog', { name: 'Learn' });
  await expect(learn).toBeVisible();
  await page.waitForTimeout(OUTWAIT_MS);
  await expect(dialog(page)).toHaveCount(0);
  expect(acked).toEqual([]);

  // held, not dropped: once Learn has gone, the quiet moment comes
  await page.keyboard.press('Escape');
  await expect(learn).toHaveCount(0);
  await expect(page).not.toHaveURL(/learn=/);
  await expect(dialog(page)).toBeVisible({ timeout: 8000 });
  await page.keyboard.press('Escape');
  await expect.poll(() => acked).toEqual(['9.9.9']);
});

test('it waits while Settings is open, and Updates, Show leaves Settings for the page', async ({ page }) => {
  const acked = await serve(page, [HEADLINE], '9.9.9', '9.9.8');
  await page.goto(`${HOME}?settings=updates`);
  await expect(page.locator('.sc-set')).toBeVisible();
  await page.waitForTimeout(OUTWAIT_MS);
  await expect(dialog(page)).toHaveCount(0);
  expect(acked).toEqual([]);

  const row = page.locator('.sc-set .sc-set-row').filter({ hasText: "What's new" });
  await expect(row.locator('small')).toHaveText(HEADLINE.title as string);
  await row.getByRole('link', { name: 'Show' }).click();
  await expect(page).toHaveURL((u) => u.pathname === PAGE && !u.searchParams.has('settings'));
  await expect(page.locator('.sc-set')).toHaveCount(0);
  await expect(heading(page)).toBeVisible();
  await expect.poll(() => acked).toEqual(['9.9.9']);
  await page.waitForTimeout(OUTWAIT_MS);
  await expect(dialog(page)).toHaveCount(0);
});

test('it opens without a ring on anything, the trap holds, and Got it hands the keyboard back to the page', async ({
  page,
}) => {
  const acked = await serve(page, [HEADLINE], '9.9.9', '9.9.8');
  await page.goto(HOME);
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

  const stop = () =>
    page.evaluate(() => {
      const el = document.activeElement;
      if (!el?.closest('.sc-wn')) return 'ESCAPED';
      return el.getAttribute('aria-label') ?? el.textContent?.trim() ?? '';
    });
  const stops: string[] = [];
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press('Tab');
    stops.push(await stop());
  }
  expect(stops).toEqual(['Close', 'See all updates', 'Got it', 'Close']);

  // Close -> the link -> Got it, and Enter on it
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  expect(await stop()).toBe('Got it');
  await page.keyboard.press('Enter');
  await expect(dialog(page)).toHaveCount(0);
  await expect.poll(() => acked).toEqual(['9.9.9']);

  // Nothing opened it, so there is no opener to return to. What matters is
  // that the keyboard is not stranded: the next Tab lands on a real control
  // in the page, not in a dialog that has gone.
  await page.keyboard.press('Tab');
  const next = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    return {
      real: !!el && el !== document.body && el.isConnected,
      inDialog: !!el?.closest('[role="dialog"]'),
      shown: !!el && el.getClientRects().length > 0,
    };
  });
  expect(next).toEqual({ real: true, inDialog: false, shown: true });
});

test('a failed read opens nothing and marks nothing, and the dialog by address says the read failed', async ({
  page,
}) => {
  const acked: string[] = [];
  await page.route(NOTES_URL, (route) => route.fulfill({ status: 500, json: { error: 'boom' } }));
  await page.route(SEEN_URL, async (route) => {
    acked.push(String(route.request().postDataJSON()?.version));
    await route.fulfill({ json: { ok: true } });
  });
  await page.goto(HOME);
  await expect(page.locator('.sc-greet')).toBeVisible();
  await page.waitForTimeout(OUTWAIT_MS);
  await expect(dialog(page)).toHaveCount(0);
  await expect(dot(page)).toHaveCount(0);

  await page.goto(`${HOME}?whatsnew=1`);
  await expect(dialog(page)).toBeVisible();
  await expect(dialog(page).locator('.sc-wn-txt')).toContainText('could not read its release notes');
  await expect(dialog(page).locator('.sc-wn-pic, .sc-wn-hed')).toHaveCount(0);
  await expect(dialog(page).locator('.sc-wn-link')).toHaveCount(0);
  await expect(dialog(page).getByRole('button', { name: 'Got it' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog(page)).toHaveCount(0);
  expect(acked).toEqual([]);
});

test('a maintenance release with nothing new since says nothing of its own', async ({ page }) => {
  const records = [maintenance('9.9.9'), headline('9.9.8', 'The last headline'), small('9.9.7')];
  const acked = await serve(page, records, '9.9.9', '9.9.8');
  await page.goto(HOME);
  await expect(page.locator('.sc-greet')).toBeVisible();
  await page.waitForTimeout(OUTWAIT_MS);
  await expect(dialog(page)).toHaveCount(0);
  await expect(dot(page)).toHaveCount(0);

  // by address it still shows the newest headline in the history
  await page.goto(`${HOME}?whatsnew=1`);
  await expect(dialog(page)).toBeVisible();
  await expect(dialog(page).locator('.sc-wn-hed')).toHaveText('The last headline');
  await expect(dialog(page).locator('.sc-wn-ver')).toHaveText('Version 9.9.8');
  await expect(dialog(page).locator('a.sc-wn-link')).toHaveText('See all updates');
  await page.keyboard.press('Escape');
  await expect(dialog(page)).toHaveCount(0);
  expect(acked).toEqual([]);
});

test('a development build opens nothing by itself', async ({ page }) => {
  const acked = await serve(page, [HEADLINE, small('9.9.8')], '0.0.0', '0.0.0');
  await page.goto(HOME);
  await expect(page.locator('.sc-greet')).toBeVisible();
  await page.waitForTimeout(OUTWAIT_MS);
  await expect(dialog(page)).toHaveCount(0);
  await expect(dot(page)).toHaveCount(0);
  expect(acked).toEqual([]);
});
