import { test, expect, type Locator, type Page } from '@playwright/test';
import { isolate } from './harness.js';

/**
 * What's new, the page: the recent history, newest first, at
 * /<brand>/whats-new. Help and Settings lead here, and so does the dialog's
 * own link (whatsnew.spec.ts owns the dialog).
 *
 * The first two tests read the real server on this file's fresh home, with
 * nothing stubbed, so the page is held to the records that actually ship. The
 * rest stub the one read, answering the way the server does (`notesFor`), and
 * route the acknowledgement so nothing is written into the home the real-server
 * tests read.
 */

isolate();

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
const FAILED = 'Scenri could not read its release notes.';
const NOTHING_YET = 'There is nothing new to show here yet.';

type Picture = { file: string; alt: string };
type Section = { heading: string; body: string; image?: Picture };
type Rec = { version: string; date: string; title?: string; sections: Section[] };
type Notes = {
  version: string;
  seen: string | null;
  recent: Rec[];
  unseen: string[];
  lead: string | null;
  releasesUrl: string | null;
};

/** Pictures that ship in this build (src/assets/whatsnew), and one that does not. */
const PIC_A: Picture = { file: '0.19.0-home-examples.webp', alt: "Home's example wall, with tabs above it." };
const PIC_B: Picture = { file: '0.19.0-use-this-view.webp', alt: "A scene's page, with Use this view on it." };
const PIC_MISSING: Picture = { file: '9.9.9-missing.webp', alt: 'A picture this build does not carry.' };

const headline = (version: string, title: string, sections: Section[]): Rec => ({
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

/** Newest first: small, a headline with two pictures, small, a headline with none. */
const HISTORY: Rec[] = [
  small('9.9.9', 'Scene draws show in the bell as soon as they start.'),
  headline('9.9.8', 'A new library of products, presenters and scenes', [
    { heading: 'Library', body: 'The library holds more of everything.', image: PIC_A },
    { heading: 'Scenes', body: 'Any picture of a scene can be the frame a shot follows.', image: PIC_B },
    { heading: 'Create', body: 'Presenters are dressed for the place.' },
  ]),
  small('9.9.7'),
  headline('9.9.6', 'An older headline, told in words', [{ heading: 'Create', body: 'Better picks.' }]),
];

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

/** The server's notes for these records, with `seen` raised only by an acknowledgement. */
async function serve(
  page: Page,
  records: Rec[],
  running: string,
  seen: string | null,
  over: Record<string, unknown> = {},
): Promise<string[]> {
  const acked: string[] = [];
  let mark = seen;
  await page.route(NOTES_URL, (route) => route.fulfill({ json: notesFor(records, running, mark, over) }));
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
const heading = (p: Page) => p.locator('#sc-wn-title');
const rows = (p: Page) => p.locator('ol.sc-wn-list > li.sc-wn-row');
const footLink = (p: Page) => p.locator('footer.sc-wn-page-foot a.sc-wn-link');
const decoded = (img: Locator) =>
  img.evaluate((el) => (el as HTMLImageElement).complete && (el as HTMLImageElement).naturalWidth > 0);
const kinds = (p: Page) => rows(p).evaluateAll((els) => els.map((el) => el.getAttribute('data-kind')));
/** The pictures a record shows: a headline update's, in order; a small update never shows one. */
const pictured = (r: Rec): Picture[] => (r.title ? r.sections.flatMap((s) => (s.image ? [s.image] : [])) : []);

/** Each picture scrolled to (the ones below the lead load lazily) and decoded. */
async function expectDecoded(imgs: Locator): Promise<void> {
  const n = await imgs.count();
  for (let i = 0; i < n; i++) {
    await imgs.nth(i).scrollIntoViewIfNeeded();
    await expect.poll(() => decoded(imgs.nth(i)), { message: `picture ${i + 1} of ${n} never decoded` }).toBe(true);
  }
}

// ---- the real server, nothing stubbed ----------------------------------------

test('on a fresh home the real history is all read: nothing opens, and the page holds exactly it', async ({ page }) => {
  const posted: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/api/release/seen')) posted.push(r.method());
  });
  const notes = (await (await page.request.get('/api/release/notes')).json()) as Notes;
  expect(notes.unseen).toEqual([]);
  expect(notes.lead).toBeNull();
  expect(notes.seen).toBe(notes.version);
  expect(notes.recent.length).toBeGreaterThan(0);

  await page.goto(HOME);
  await expect(page.locator('.sc-greet')).toBeVisible();
  await page.waitForTimeout(OUTWAIT_MS);
  await expect(dialog(page)).toHaveCount(0);
  await expect(dot(page)).toHaveCount(0);

  await page.goto(PAGE);
  await expect(page).toHaveTitle("What's new - Scenri");
  await expect(rows(page)).toHaveCount(notes.recent.length);
  await expect(rows(page).locator('.sc-wn-ver')).toHaveText(notes.recent.map((r) => `Version ${r.version}`));
  expect(await kinds(page)).toEqual(notes.recent.map((r) => (r.title ? 'headline' : 'small')));

  // the lead is the newest headline update, large, with its pictures decoded
  const featured = notes.recent.find((r) => r.title) as Rec;
  const lead = page.locator('.sc-wn-row[data-lead]');
  await expect(lead).toHaveCount(1);
  await expect(lead.locator('.sc-wn-ver')).toHaveText(`Version ${featured.version}`);
  await expect(lead.locator('h2.sc-wn-row-hed')).toHaveText(featured.title as string);
  const pics = pictured(featured);
  expect(pics.length, 'the newest headline update ships with no picture').toBeGreaterThan(0);
  await expect(lead.locator('figure.sc-wn-pic > img')).toHaveCount(pics.length);
  for (const [i, p] of pics.entries()) {
    await expect(lead.locator('figure.sc-wn-pic > img').nth(i)).toHaveAttribute('alt', p.alt);
  }
  await expectDecoded(lead.locator('figure.sc-wn-pic > img'));
  await expect(page.locator('.sc-wn-row[data-kind="small"] figure')).toHaveCount(0);

  if (notes.releasesUrl) await expect(footLink(page)).toHaveAttribute('href', notes.releasesUrl);
  // reading a history that was already read writes nothing
  expect(posted).toEqual([]);
});

test('offline, the page and the dialog show their pictures from the build and reach for nothing else', async ({
  page,
}) => {
  const outside: string[] = [];
  let local = 0;
  await page.route('**/*', (route) => {
    const { hostname } = new URL(route.request().url());
    if (hostname === '127.0.0.1' || hostname === 'localhost') {
      local++;
      return route.fallback();
    }
    outside.push(route.request().url());
    return route.abort('internetdisconnected');
  });
  const notes = (await (await page.request.get('/api/release/notes')).json()) as Notes;
  const everyPicture = notes.recent.flatMap(pictured);

  await page.goto(PAGE);
  await expect(rows(page)).toHaveCount(notes.recent.length);
  const imgs = page.locator('.sc-wn-list figure.sc-wn-pic > img');
  await expect(imgs).toHaveCount(everyPicture.length);
  await expectDecoded(imgs);

  await page.goto(`${HOME}?whatsnew=1`);
  await expect(dialog(page)).toBeVisible();
  const featured = notes.recent.find((r) => r.title) as Rec;
  const hero = dialog(page).locator('figure.sc-wn-pic > img');
  await expect(hero).toHaveAttribute('alt', pictured(featured)[0].alt);
  await expect.poll(() => decoded(hero)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog(page)).toHaveCount(0);

  expect(local, 'the route saw none of the local traffic, so it proves nothing').toBeGreaterThan(0);
  expect(outside, "What's new reached past this machine").toEqual([]);
});

// ---- stubbed histories ---------------------------------------------------------

test('Help leads to the page: its name takes the keyboard, nothing in the bar claims it, newest first', async ({
  page,
}) => {
  const acked = await serve(page, HISTORY, '9.9.9', '9.9.9');
  await page.goto(HOME);
  await expect(page.locator('.sc-greet')).toBeVisible();
  // the bar does mark the place it is on, so its silence on the page means something
  await expect(page.locator('.sc-nav [aria-current="page"]')).toHaveCount(1);

  await page.locator('.sc-help-btn').click();
  await page.locator('.sc-help-menu .sc-menu-item', { hasText: "What's new" }).click();
  await expect(page).toHaveURL((u) => u.pathname === PAGE && u.search === '');
  await expect(page).toHaveTitle("What's new - Scenri");
  await expect(heading(page)).toBeFocused();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText("What's new");
  await expect(page.locator('main#main.sc-wn-page')).toHaveAccessibleName("What's new");
  await expect(page.locator('.sc-wn-page-head p')).toHaveText('What changed in Scenri, newest first.');
  await expect(page.locator('.sc-nav :is(a, button)').first()).toBeVisible();
  await expect(page.locator('[aria-current="page"]')).toHaveCount(0);

  await expect(rows(page).locator('.sc-wn-ver')).toHaveText([
    'Version 9.9.9',
    'Version 9.9.8',
    'Version 9.9.7',
    'Version 9.9.6',
  ]);
  expect(await kinds(page)).toEqual(['small', 'headline', 'small', 'headline']);

  // the newest headline is the lead, and it is the only one
  const lead = page.locator('.sc-wn-row[data-lead]');
  await expect(lead).toHaveCount(1);
  await expect(lead.locator('.sc-wn-ver')).toHaveText('Version 9.9.8');
  await expect(lead.locator('h2.sc-wn-row-hed')).toHaveText('A new library of products, presenters and scenes');
  await expect(rows(page).nth(3).locator('h2.sc-wn-row-hed')).toHaveText('An older headline, told in words');

  // a small update is a line per area, its name in ink, and never a picture or a headline
  const smallRow = rows(page).nth(0);
  await expect(smallRow.locator('.sc-wn-line')).toHaveText(
    'Fixes: Scene draws show in the bell as soon as they start.',
  );
  await expect(smallRow.locator('.sc-wn-line b')).toHaveText('Fixes');
  await expect(page.locator('.sc-wn-row[data-kind="small"] :is(figure, img, h2)')).toHaveCount(0);

  // a headline with pictures shows them; one told in words has no frame
  await expect(lead.locator('figure.sc-wn-pic')).toHaveCount(2);
  await expect(rows(page).nth(3).locator('figure')).toHaveCount(0);

  // nothing was unread, so nothing was written
  await page.waitForTimeout(OUTWAIT_MS);
  expect(acked).toEqual([]);
});

test('Full release notes goes to the archive, in a new tab, and says so', async ({ page }) => {
  await serve(page, HISTORY, '9.9.9', '9.9.9');
  await page.goto(PAGE);
  await expect(rows(page)).toHaveCount(4);
  const link = footLink(page);
  await expect(link).toHaveAttribute('href', RELEASES_URL);
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(link).toHaveAttribute('rel', /\bnoopener\b/);
  await expect(link).toHaveAccessibleName(/Full release notes/);
  await expect(link).toHaveAccessibleName(/opens in a new tab/);
  // the words a person sees are the short ones; the rest is spoken
  await expect(link.locator('.sc-vh')).toHaveText(' on GitHub, opens in a new tab');
});

test('with no archive to point at, the page offers no link to an empty page', async ({ page }) => {
  await serve(page, HISTORY, '9.9.9', '9.9.9', { releasesUrl: null });
  await page.goto(PAGE);
  await expect(rows(page)).toHaveCount(4);
  await expect(page.locator('footer.sc-wn-page-foot')).toHaveCount(0);
  await expect(page.getByRole('link', { name: /Full release notes/ })).toHaveCount(0);
});

test('a headline with two pictures shows both; one whose picture is not in the build leaves no frame', async ({
  page,
}) => {
  const records = [
    headline('9.9.9', 'Two pictures', [
      { heading: 'Library', body: 'The library holds more of everything.', image: PIC_A },
      { heading: 'Scenes', body: 'Any picture of a scene can be the frame.', image: PIC_B },
    ]),
    headline('9.9.8', 'A picture that did not ship', [
      { heading: 'Create', body: 'Better picks.', image: PIC_MISSING },
      { heading: 'Fixes', body: 'Mobile layout stability.' },
    ]),
  ];
  await serve(page, records, '9.9.9', '9.9.9');
  await page.goto(PAGE);
  await expect(rows(page)).toHaveCount(2);

  const two = rows(page).nth(0);
  await expect(two.locator('figure.sc-wn-pic')).toHaveCount(2);
  await expect(two.locator('figure.sc-wn-pic > img').nth(0)).toHaveAttribute('alt', PIC_A.alt);
  await expect(two.locator('figure.sc-wn-pic > img').nth(1)).toHaveAttribute('alt', PIC_B.alt);
  // each picture sits under the area it shows
  await expect(two.locator('.sc-wn-area').nth(0).locator('figure')).toHaveCount(1);
  await expect(two.locator('.sc-wn-area').nth(1).locator('figure')).toHaveCount(1);
  await expectDecoded(two.locator('figure.sc-wn-pic > img'));

  const missing = rows(page).nth(1);
  await expect(missing.locator('h2.sc-wn-row-hed')).toHaveText('A picture that did not ship');
  await expect(missing.locator('.sc-wn-line')).toHaveText(['Create: Better picks.', 'Fixes: Mobile layout stability.']);
  await expect(missing.locator(':is(figure, img, .sc-wn-pic)')).toHaveCount(0);
});

test('a failed read says so on the page, and offers no link', async ({ page }) => {
  const acked: string[] = [];
  await page.route(NOTES_URL, (route) => route.fulfill({ status: 500, json: { error: 'boom' } }));
  await page.route(SEEN_URL, async (route) => {
    acked.push(String(route.request().postDataJSON()?.version));
    await route.fulfill({ json: { ok: true } });
  });
  await page.goto(PAGE);
  await expect(heading(page)).toBeVisible();
  await expect(page.locator('.sc-wn-page > p.sc-wn-txt')).toContainText(FAILED);
  await expect(page.locator('.sc-wn-page > p.sc-wn-txt')).not.toContainText(NOTHING_YET);
  await expect(rows(page)).toHaveCount(0);
  await expect(page.locator('footer.sc-wn-page-foot')).toHaveCount(0);
  await expect(dot(page)).toHaveCount(0);
  await page.waitForTimeout(OUTWAIT_MS);
  await expect(dialog(page)).toHaveCount(0);
  expect(acked).toEqual([]);
});

test('a history with nothing in it says so, and offers no link', async ({ page }) => {
  await serve(page, [maintenance('9.9.9')], '9.9.9', '9.9.8');
  await page.goto(PAGE);
  await expect(heading(page)).toBeVisible();
  await expect(page.locator('.sc-wn-page > p.sc-wn-txt')).toHaveText(NOTHING_YET);
  await expect(rows(page)).toHaveCount(0);
  await expect(page.locator('footer.sc-wn-page-foot')).toHaveCount(0);
});

test('a maintenance release is not a row: the history before it is, and reading it writes nothing', async ({
  page,
}) => {
  const records = [
    maintenance('9.9.9'),
    headline('9.9.8', 'The last headline', [{ heading: 'Create', body: 'Better picks.' }]),
    small('9.9.7'),
  ];
  const acked = await serve(page, records, '9.9.9', '9.9.8');
  await page.goto(HOME);
  await expect(page.locator('.sc-greet')).toBeVisible();
  await page.waitForTimeout(OUTWAIT_MS);
  await expect(dialog(page)).toHaveCount(0);
  await expect(dot(page)).toHaveCount(0);

  await page.goto(PAGE);
  await expect(rows(page).locator('.sc-wn-ver')).toHaveText(['Version 9.9.8', 'Version 9.9.7']);
  await expect(page.locator('.sc-wn-row[data-lead] h2')).toHaveText('The last headline');
  await page.waitForTimeout(OUTWAIT_MS);
  expect(acked).toEqual([]);
});

test('a development build still shows the history, and opens nothing by itself', async ({ page }) => {
  const acked = await serve(page, HISTORY, '0.0.0', '0.0.0');
  await page.goto(HOME);
  await expect(page.locator('.sc-greet')).toBeVisible();
  await page.waitForTimeout(OUTWAIT_MS);
  await expect(dialog(page)).toHaveCount(0);
  await expect(dot(page)).toHaveCount(0);

  await page.goto(PAGE);
  await expect(rows(page)).toHaveCount(HISTORY.length);
  await expect(page.locator('.sc-wn-row[data-lead] .sc-wn-ver')).toHaveText('Version 9.9.8');
  await expect(footLink(page)).toHaveAttribute('href', RELEASES_URL);
  expect(acked).toEqual([]);
});
