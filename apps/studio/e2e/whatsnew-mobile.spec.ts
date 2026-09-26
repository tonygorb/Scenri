import { test, expect, type Locator, type Page } from '@playwright/test';
import { isolate } from './harness.js';

/**
 * What's new at a hand's width. The dialog docks to the bottom edge as a sheet
 * rather than a shrunken desktop card, its excerpt still one link to the page;
 * the page folds its date column above what each release says, and a tap on a
 * picture opens it larger.
 *
 * Phones are held at 390px; the tablet project keeps its own viewport and
 * only runs what is not phone-only. whatsnew.spec.ts and
 * whats-new-page.spec.ts own the behaviour; this file owns the layout.
 */

isolate();

const PHONE = { width: 390, height: 844 };
const phone = (p: Page) => (p.viewportSize()?.width ?? 0) < 768;
const SETTLE_MS = 300;

test.beforeEach(async ({ page }, testInfo) => {
  // Every test here waits out the 2.5s auto-open settle; shorten it before boot.
  await page.addInitScript((ms) => localStorage.setItem('scenri:whatsnew-settle-ms', String(ms)), SETTLE_MS);
  if (testInfo.project.name === 'mobile') await page.setViewportSize(PHONE);
});

const HOME = '/e2e-fixture';
const PAGE = '/e2e-fixture/whats-new';
const RELEASES_URL = 'https://github.com/tonygorb/scenri/releases';
/** The first public release: the history the server sends starts there (FIRST_PUBLIC in notes.data.ts). */
const FIRST_PUBLIC = '0.2.0';
/** The newest headline updates the in-app window reaches down to (HEADLINES_KEPT in notes.data.ts). */
const HEADLINES_KEPT = 5;

type Picture = { file: string; alt: string };
type Section = { heading: string; body: string; image?: Picture };
/** A release record as the server sends it: every update titled, a headline also announced. */
type Rec = { version: string; date: string; title?: string; announce?: true; sections: Section[] };

/** Pictures that ship in this build (src/assets/whatsnew), for stubbed records to name. */
const PIC_A: Picture = {
  file: '0.19.0-home-examples.webp',
  alt: "Home's example wall, with the example kinds above it.",
};
const PIC_B: Picture = {
  file: '0.17.0-select-several.webp',
  alt: 'Three scenes picked, and the bar that acts on them.',
};
const PIC_C: Picture = { file: '0.16.0-local-access.webp', alt: 'The Local access card, with its QR code.' };

const headline = (
  version: string,
  title: string,
  sections: Section[] = [{ heading: 'Create', body: 'Better picks.' }],
  date = '2026-08-10',
): Rec => ({ version, date, title, announce: true, sections });
const small = (
  version: string,
  title: string,
  sections: Section[] = [{ heading: 'Fixes', body: 'Notifications no longer fire twice.' }],
  date = '2026-08-12',
): Rec => ({ version, date, title, sections });

/**
 * Six recent updates (three with a picture, the rest in words) down to the
 * fifth headline, then two earlier ones that the page folds.
 */
const RECORDS: Rec[] = [
  headline(
    '9.9.9',
    'A new library of products, presenters and scenes',
    [
      { heading: 'Library', body: 'The library holds more of everything.', image: PIC_A },
      { heading: 'Scenes', body: 'Any picture of a scene can be the frame a shot follows.' },
    ],
    '2026-08-16',
  ),
  small('9.9.8', 'Scene draws show in the bell', [
    { heading: 'Fixes', body: 'Scene draws show in the bell as soon as they start.', image: PIC_B },
  ]),
  headline('9.9.7', 'Open it on your phone or tablet', [
    { heading: 'Local access', body: 'Scan a code and the studio opens on your phone.', image: PIC_C },
  ]),
  headline('9.9.6', 'A headline told in words'),
  headline('9.9.5', 'Another headline told in words'),
  headline('9.9.4', 'The fifth headline, the last of the recent ones'),
  small('9.9.3', 'An earlier small update'),
  headline('9.9.2', 'An earlier headline'),
];

const cmp = (a: string, b: string): number => {
  const x = a.split('.').map(Number);
  const y = b.split('.').map(Number);
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
};

/** What GET /api/release/notes answers for these records (see notesFor in whatsnew.spec.ts). */
function notesFor(records: Rec[], running: string, seen: string) {
  const newsworthy = (r: Rec) => r.sections.length > 0;
  const recent: Rec[] = [];
  let headlines = 0;
  for (const r of records) {
    if (headlines === HEADLINES_KEPT) break;
    if (!newsworthy(r) || cmp(r.version, running) > 0) continue;
    recent.push(r);
    if (r.announce) headlines++;
  }
  const unseen = recent.filter((r) => cmp(seen, r.version) < 0).map((r) => r.version);
  return {
    version: running,
    entry: records.find((r) => r.version === running) ?? null,
    seen,
    recent,
    history: records.filter((r) => newsworthy(r) && cmp(r.version, FIRST_PUBLIC) >= 0 && cmp(r.version, running) <= 0),
    unseen,
    lead: recent.find((r) => r.announce && unseen.includes(r.version))?.version ?? null,
    changelogUrl: `${RELEASES_URL}/tag/v${running}`,
    releasesUrl: RELEASES_URL,
  };
}

/** The server's notes, `seen` raised only by an acknowledgement; every acknowledgement is recorded, never written. */
async function serve(page: Page, seen: string): Promise<string[]> {
  const acked: string[] = [];
  let mark = seen;
  await page.route('**/api/release/notes', (route) => route.fulfill({ json: notesFor(RECORDS, '9.9.9', mark) }));
  await page.route('**/api/release/seen', async (route) => {
    const v = String(route.request().postDataJSON()?.version);
    acked.push(v);
    if (cmp(v, mark) > 0) mark = v;
    await route.fulfill({ json: { ok: true } });
  });
  return acked;
}

const sheet = (p: Page) => p.locator('.sc-wn');
const excerpt = (p: Page) => sheet(p).locator('article.sc-wn-ex');
const stage = (p: Page) => excerpt(p).locator('.sc-wn-media');
const excerptLink = (p: Page) => excerpt(p).locator('h3.sc-wn-hed > a.sc-wn-ex-link');
const footLink = (p: Page) => sheet(p).locator('.sc-wn-foot a.sc-wn-link');
const gotIt = (p: Page) => sheet(p).getByRole('button', { name: 'Got it' });
const decoded = (img: Locator) =>
  img.evaluate((el) => (el as HTMLImageElement).complete && (el as HTMLImageElement).naturalWidth > 0);

async function boxOf(el: Locator) {
  const b = await el.boundingBox();
  if (!b) throw new Error('the element has no box');
  return b;
}

/** The centre of an element, in whole pixels. */
async function centre(el: Locator): Promise<{ x: number; y: number }> {
  const b = await boxOf(el);
  return { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) };
}

/** Nothing runs off the side: not the document, not the pane the page scrolls in. */
const sideways = (p: Page) =>
  p.evaluate(() => {
    const pane = document.querySelector('.sc-wn-page')?.parentElement;
    return {
      doc: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
      pane: pane ? Math.max(0, pane.scrollWidth - pane.clientWidth) : 0,
    };
  });

/**
 * Wait for the sheet (or the tablet's card) to finish arriving before it is
 * measured or pressed. Its entry animation fills both ways, so at rest it holds
 * an identity matrix rather than `none`, and the harness's `arrived` would wait
 * on it forever: wait for its own animation to finish instead.
 */
async function settled(p: Page): Promise<void> {
  const card = sheet(p);
  await card.waitFor({ state: 'visible' });
  await expect
    .poll(() =>
      card.evaluate((node) => {
        const t = getComputedStyle(node).transform;
        const still = t === 'none' || t === 'matrix(1, 0, 0, 1, 0, 0)';
        return still && node.getAnimations().every((a) => a.playState !== 'running');
      }),
    )
    .toBe(true);
}

async function settledBox(p: Page, sel: string) {
  let last = await boxOf(p.locator(sel));
  for (let i = 0; i < 20; i++) {
    await p.waitForTimeout(50);
    const now = await boxOf(p.locator(sel));
    if (Math.abs(now.y - last.y) < 0.5) return now;
    last = now;
  }
  return last;
}

async function dragSheet(p: Page, grip: string, dy: number) {
  const box = await settledBox(p, grip);
  const x = Math.round(box.x + box.width / 2);
  const y = Math.round(box.y + box.height / 2);
  await p.mouse.move(x, y);
  await p.mouse.down();
  await p.mouse.move(x, y + dy, { steps: 10 });
  await p.waitForTimeout(200);
  await p.mouse.up();
}

test("What's New is a bottom sheet on a phone and a card on a tablet: the excerpt, picture first, and the foot in view", async ({
  page,
}) => {
  const acked = await serve(page, '9.9.7');
  await page.goto(HOME);
  await expect(sheet(page)).toBeVisible({ timeout: 8000 });
  // measured once the sheet has stopped rising, not mid-travel
  await settled(page);

  // the picture, then when, then the headline, each below the one before
  const img = stage(page).locator('img');
  await expect(img).toHaveAttribute('alt', PIC_A.alt);
  await expect.poll(() => decoded(img)).toBe(true);
  const pic = await boxOf(stage(page));
  const when = await boxOf(excerpt(page).locator('.sc-wn-when'));
  const hed = await boxOf(excerpt(page).locator('.sc-wn-hed'));
  expect(pic.y + pic.height).toBeLessThanOrEqual(when.y + 0.5);
  expect(when.y + when.height).toBeLessThanOrEqual(hed.y + 0.5);
  await expect(excerptLink(page)).toHaveText(RECORDS[0].title as string);
  // the update is the version this computer runs: its own tag is the lit one, and the head says nothing
  await expect(excerpt(page).locator('.sc-wn-when .sc-wn-chip[data-on]')).toHaveText(
    'Version 9.9.9, the version you are on',
  );
  await expect(sheet(page).locator('.sc-newdlg-head .sc-wn-chip')).toHaveCount(0);
  await expect(footLink(page)).toHaveText('See 1 more update');
  // the picture runs the excerpt's width, not a thumbnail in it
  const ex = await boxOf(excerpt(page));
  expect(Math.abs(pic.width - ex.width)).toBeLessThanOrEqual(1);

  // the foot is on screen, whole: its link and Got it can be reached without scrolling
  await expect(footLink(page)).toBeInViewport({ ratio: 1 });
  await expect(gotIt(page)).toBeInViewport({ ratio: 1 });

  const box = await boxOf(sheet(page));
  const viewport = page.viewportSize();
  if (!viewport) throw new Error('no viewport');
  if (phone(page)) {
    expect(viewport.width).toBe(PHONE.width);
    expect(Math.round(box.width)).toBe(viewport.width);
    expect(Math.round(box.x)).toBe(0);
    expect(Math.round(box.y + box.height)).toBeGreaterThanOrEqual(viewport.height - 1);
  } else {
    expect(box.width).toBeLessThan(viewport.width);
    expect(box.y).toBeGreaterThan(0);
  }
  expect((await sideways(page)).doc).toBe(0);

  await gotIt(page).click();
  await expect(sheet(page)).toHaveCount(0);
  await expect.poll(() => acked).toEqual(['9.9.9']);
});

test('an update without a picture shows the artwork in the sheet, its version chip on it and whole', async ({
  page,
}) => {
  const acked = await serve(page, '9.9.9');
  await page.goto(`${HOME}?whatsnew=preview:9.9.6`);
  await expect(sheet(page)).toBeVisible();
  await settled(page);
  await expect(excerptLink(page)).toHaveText('A headline told in words');

  const art = stage(page);
  await expect(art).toHaveClass(/\bsc-wn-fallback\b/);
  await expect(art.locator('img')).toHaveAttribute('alt', '');
  await expect.poll(() => decoded(art.locator('img'))).toBe(true);
  const chip = art.locator('.sc-wn-fallback-chip[data-theme="dark"] > .sc-wn-chip');
  await expect(chip).toHaveText('Version 9.9.6');
  await expect(chip).not.toHaveAttribute('data-on');
  // an earlier release: the head says which version this computer runs, whole, beside the title
  const running = sheet(page).locator('.sc-newdlg-head .sc-wn-chip[data-on]');
  await expect(running).toHaveText('Version 9.9.9, the version you are on');
  await expect(running).toBeInViewport({ ratio: 1 });
  await expect(sheet(page).locator('.sc-wn-chip[data-on]')).toHaveCount(1);
  await expect(excerpt(page).locator('.sc-wn-when .sc-wn-chip')).toHaveCount(0);
  // the artwork runs the excerpt's width, and the chip sits on it, whole
  const a = await boxOf(art);
  const c = await boxOf(chip);
  expect(Math.abs(a.width - (await boxOf(excerpt(page))).width)).toBeLessThanOrEqual(1);
  expect(c.x).toBeGreaterThanOrEqual(a.x);
  expect(c.y).toBeGreaterThanOrEqual(a.y);
  expect(c.x + c.width).toBeLessThanOrEqual(a.x + a.width);
  expect(c.y + c.height).toBeLessThanOrEqual(a.y + a.height);
  expect((await sideways(page)).doc).toBe(0);

  await gotIt(page).click();
  await expect(sheet(page)).toHaveCount(0);
  await page.waitForTimeout(SETTLE_MS * 5);
  expect(acked).toEqual([]);
});

test("What's New is dragged away, springs back from a nudge, and leaving that way reads it", async ({ page }) => {
  test.skip(!phone(page), 'the sheet only exists below 768px');
  const acked = await serve(page, '9.9.7');
  await page.goto(HOME);
  await expect(sheet(page)).toBeVisible({ timeout: 8000 });

  const pull = (dy: number) => dragSheet(page, '.sc-wn > .sc-shotsheet-grip', dy);
  await pull(24);
  await expect(sheet(page)).toBeVisible();
  await expect.poll(() => sheet(page).evaluate((el) => el.style.transform)).toBe('');
  expect(acked).toEqual([]);

  await pull(200);
  await expect(sheet(page)).toHaveCount(0);
  await expect.poll(() => acked).toEqual(['9.9.9']);
});

test('a tap on the picture in the sheet lands on that release at the top of the page, and reads it once', async ({
  page,
}) => {
  test.skip(!phone(page), 'the sheet only exists below 768px');
  const acked = await serve(page, '9.9.7');
  await page.goto(HOME);
  await expect(sheet(page)).toBeVisible({ timeout: 8000 });
  await settled(page);
  await expect.poll(() => decoded(stage(page).locator('img'))).toBe(true);

  const at = await centre(stage(page));
  await page.touchscreen.tap(at.x, at.y);
  await expect(page).toHaveURL((u) => u.pathname === PAGE && u.hash === '#v9.9.9' && !u.searchParams.has('whatsnew'));
  await expect(sheet(page)).toHaveCount(0);
  await expect(page.locator('#sc-wn-title')).toBeFocused();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const row = document.getElementById('v9.9.9');
        const pane = document.querySelector('.sc-wn-page')?.parentElement;
        if (!row || !pane) return false;
        return Math.abs(row.getBoundingClientRect().top - pane.getBoundingClientRect().top) <= 1;
      }),
    )
    .toBe(true);
  await expect.poll(() => acked.length).toBeGreaterThan(0);
  await page.waitForTimeout(SETTLE_MS * 5);
  expect(acked).toEqual(['9.9.9']);
});

test("the What's New page is one column on a phone, its pictures the column's width, and a tap opens one larger", async ({
  page,
}) => {
  test.skip(!phone(page), 'the single column is the phone layout');
  await serve(page, '9.9.9');
  await page.goto(PAGE);
  const rows = page.locator('li.sc-wn-row');
  await expect(rows).toHaveCount(6);
  await expect(page.locator('#sc-wn-title')).toBeFocused();
  // the page's name steps down to the phone's size, and the rows close up to 40px across their hairline
  expect(await page.locator('#sc-wn-title').evaluate((el) => getComputedStyle(el).fontSize)).toBe('24px');
  const apart = await rows.nth(1).evaluate((el) => {
    const cs = getComputedStyle(el);
    return [cs.marginTop, cs.paddingTop, cs.borderTopWidth];
  });
  expect(apart).toEqual(['40px', '40px', '1px']);

  // each release's date, version and notes sit above what it says, on the same left edge, its title first
  for (let i = 0; i < 6; i++) {
    const row = rows.nth(i);
    const side = await boxOf(row.locator('.sc-wn-side'));
    const what = await boxOf(row.locator('.sc-wn-what'));
    expect(side.y + side.height, `row ${i + 1}: its date is not above what it says`).toBeLessThanOrEqual(what.y + 0.5);
    expect(
      Math.abs(side.x - what.x),
      `row ${i + 1}: its date and its words do not share a left edge`,
    ).toBeLessThanOrEqual(1);
    await expect(row.locator('.sc-wn-what > :first-child')).toHaveClass(/\bsc-wn-row-hed\b/);
  }

  // every picture runs the full width of its column
  const pictures = page.locator('.sc-wn-list .sc-wn-what > button.sc-wn-media');
  await expect(pictures).toHaveCount(3);
  for (let i = 0; i < 3; i++) {
    const pic = await boxOf(pictures.nth(i));
    const column = await boxOf(pictures.nth(i).locator('xpath=..'));
    expect(Math.abs(pic.width - column.width), `picture ${i + 1} is not its column's width`).toBeLessThanOrEqual(1);
    expect(Math.abs(pic.x - column.x)).toBeLessThanOrEqual(1);
  }

  // the earlier releases fold the same way: the date over the title, on the same left edge
  const olds = page.locator('li.sc-wn-old');
  await expect(olds).toHaveCount(2);
  for (let i = 0; i < 2; i++) {
    const when = await boxOf(olds.nth(i).locator('summary .sc-wn-when'));
    const hed = await boxOf(olds.nth(i).locator('summary .sc-wn-old-hed'));
    expect(when.y + when.height, `earlier ${i + 1}: its date is not above its title`).toBeLessThanOrEqual(hed.y + 0.5);
    expect(Math.abs(when.x - hed.x)).toBeLessThanOrEqual(1);
  }
  expect(await sideways(page)).toEqual({ doc: 0, pane: 0 });

  // a tap on a picture opens it larger, inside the window's width, and a tap anywhere closes it
  const first = pictures.first();
  await first.scrollIntoViewIfNeeded();
  await expect.poll(() => decoded(first.locator('img'))).toBe(true);
  const at = await centre(first);
  await page.touchscreen.tap(at.x, at.y);
  const large = page.getByRole('dialog', { name: PIC_A.alt });
  await expect(large).toBeVisible();
  const big = await boxOf(large.locator('.sc-wn-lb-stage'));
  expect(big.x).toBeGreaterThanOrEqual(0);
  expect(big.x + big.width).toBeLessThanOrEqual(PHONE.width);
  await expect.poll(() => decoded(large.locator('.sc-wn-lb-stage img'))).toBe(true);
  await page.touchscreen.tap(20, 20);
  await expect(large).toHaveCount(0);
});
