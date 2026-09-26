import { test, expect, type Locator, type Page } from '@playwright/test';
import { isolate } from './harness.js';

/**
 * What's new, the page: the whole public history, newest first, at
 * /<brand>/whats-new. Help and Settings lead here, and so does the dialog's
 * excerpt (whatsnew.spec.ts owns the dialog).
 *
 * One timeline in one type scale. The recent releases (the in-app window,
 * down to the fifth headline update) are open rows: the date and version over
 * that version's release notes, then the update's title, a line per area and
 * its one picture, which opens larger in the page's lightbox. Everything older
 * carries on folded, one line each that opens to its words. Ten releases show
 * first and ten more as the end comes into view, through a real button a
 * keyboard reaches too.
 *
 * The first tests read the real server on this file's fresh home, with nothing
 * stubbed, so the page is held to the records that actually ship; they derive
 * what to expect from those records rather than counting pictures or naming
 * files. The rest stub the one read, answering the way the server does
 * (`notesFor`), and route the acknowledgement so nothing is written into the
 * home the real-server tests read.
 *
 * The artwork the dialog shows for an update with no picture belongs to the
 * dialog alone: the page never shows it, and no record names it.
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
/** The first public release: the history the server sends starts there (FIRST_PUBLIC in notes.data.ts). */
const FIRST_PUBLIC = '0.2.0';
/** The newest headline updates the in-app window reaches down to (HEADLINES_KEPT in notes.data.ts). */
const HEADLINES_KEPT = 5;
/** How many releases the page shows first, and adds each time (WhatsNewPage.tsx). */
const STEP = 10;
/** The widest an update's words run, and so its picture (.sc-wn-what's max-width). */
const MEASURE = 600;
/** The stage's fixed shape: the 16:9 picture across 92% of its width, 4% of margin all round. */
const STAGE_RATIO = 400 / 239;
/** The stage's step under the pointer or the keyboard (whatsnew.css): a lift, never a dim. */
const BRIGHTER = 'brightness(1.12)';
/** The dialog's stand-in artwork (src/assets/whatsnew-fallback.svg), inlined by the build or as its file. */
const FALLBACK = /^data:image\/svg\+xml|whatsnew-fallback/;

type Picture = { file: string; alt: string };
type Section = { heading: string; body: string; image?: Picture };
/**
 * A release record as the server sends it. Every update the app shows has a
 * title; `announce` makes it a headline update. A maintenance record has
 * neither, and no sections.
 */
type Rec = { version: string; date: string; title?: string; announce?: true; sections: Section[] };
type Notes = {
  version: string;
  seen: string | null;
  recent: Rec[];
  history: Rec[];
  unseen: string[];
  lead: string | null;
  releasesUrl: string | null;
};

/**
 * Pictures that ship in this build (src/assets/whatsnew), for stubbed records
 * to name, taken from releases that keep their picture. The alt is the stub's
 * own sentence: the build only carries the file.
 */
const PIC_A: Picture = {
  file: '0.19.0-home-examples.webp',
  alt: "Home's example wall, with the example kinds above it.",
};
const PIC_B: Picture = {
  file: '0.17.0-select-several.webp',
  alt: 'Three scenes picked, and the bar that acts on them.',
};
const PIC_C: Picture = { file: '0.16.0-local-access.webp', alt: 'The Local access card, with its QR code.' };
/** A name the build carries no file for. */
const PIC_MISSING: Picture = { file: '9.9.9-missing.webp', alt: 'A picture this build does not carry.' };
/** The built file a picture resolves to: its name, then Vite's content hash. */
const builtFile = (pic: Picture) =>
  new RegExp(`/${pic.file.replace(/\.webp$/, '').replace(/\./g, '\\.')}-[^/]*\\.webp$`);

/** A sentence long enough to fill the measure, so a line is as wide as the measure allows. */
const said = (what: string) =>
  `${what} It reads the same on every screen, keeps its place when you come back to it, and asks for nothing new from you.`;

/** A headline update: it announces itself. */
const headline = (version: string, title: string, sections: Section[], date = '2026-08-10'): Rec => ({
  version,
  date,
  title,
  announce: true,
  sections,
});
/** A small update: titled like every update, and it never interrupts. */
const small = (
  version: string,
  title: string,
  sections: Section[] = [{ heading: 'Fixes', body: 'Notifications no longer fire twice.' }],
  date = '2026-08-12',
): Rec => ({ version, date, title, sections });
/** A maintenance release: no title and nothing to say, so it is nowhere on the page. */
const maintenance = (version: string): Rec => ({ version, date: '2026-08-16', sections: [] });

/** Newest first: a small update with a picture, a headline with one, a small one and a headline told in words. */
const HISTORY: Rec[] = [
  small('9.9.9', 'Scene draws show in the bell', [
    { heading: 'Fixes', body: 'Scene draws show in the bell as soon as they start.', image: PIC_B },
  ]),
  headline('9.9.8', 'A new library of products, presenters and scenes', [
    { heading: 'Library', body: 'The library holds more of everything.', image: PIC_A },
    { heading: 'Scenes', body: 'Any picture of a scene can be the frame a shot follows.' },
    { heading: 'Create', body: 'Presenters are dressed for the place.' },
  ]),
  small('9.9.7', 'Notifications ring once'),
  headline('9.9.6', 'An older headline, told in words', [{ heading: 'Create', body: 'Better picks.' }]),
];

/**
 * A long history. Seven recent releases (the fifth headline, 2.0.18, is the
 * last of them), then eighteen earlier ones: 2.0.17 is a small update in two
 * areas, and from there down every even version is a headline.
 */
const EARLIER: Rec[] = Array.from({ length: 18 }, (_, n): Rec => {
  const i = 17 - n;
  const version = `2.0.${i}`;
  const date = `2026-07-${String(i + 1).padStart(2, '0')}`;
  if (i === 17) {
    return small(
      version,
      'Settings open where you left them',
      [
        { heading: 'Settings', body: 'Settings open on the page you left.' },
        { heading: 'Fixes', body: 'The bell no longer rings twice.' },
      ],
      date,
    );
  }
  if (i % 2 === 0) {
    return headline(version, `An earlier headline, number ${i}`, [{ heading: 'Create', body: `Round ${i}.` }], date);
  }
  return small(version, `Small fix number ${i}`, [{ heading: 'Fixes', body: `Small fix number ${i}.` }], date);
});
const LONG: Rec[] = [
  small(
    '2.0.24',
    'Scene draws show in the bell',
    [{ heading: 'Fixes', body: said('Scene draws show in the bell as soon as they start.') }],
    '2026-08-24',
  ),
  headline(
    '2.0.23',
    'A new library of products, presenters and scenes',
    [
      { heading: 'Library', body: said('The library holds more of everything.'), image: PIC_A },
      { heading: 'Scenes', body: said('Any picture of a scene can be the frame.') },
      { heading: 'Create', body: said('Presenters are dressed for the place.') },
    ],
    '2026-08-23',
  ),
  headline(
    '2.0.22',
    'Select several of your own products, presenters or scenes',
    [
      { heading: 'Library', body: said('Select several from their cards.'), image: PIC_B },
      { heading: 'Tabs', body: said('Every library has the same tabs.') },
    ],
    '2026-08-22',
  ),
  small('2.0.21', 'The feed holds still', [{ heading: 'Fixes', body: said('The feed holds still.') }], '2026-08-21'),
  headline(
    '2.0.20',
    'Open it on your phone or tablet',
    [{ heading: 'Local access', body: said('Scan a code and the studio opens on your phone.'), image: PIC_C }],
    '2026-08-20',
  ),
  headline('2.0.19', 'A headline told in words', [{ heading: 'Create', body: said('Better picks.') }], '2026-08-19'),
  headline(
    '2.0.18',
    'The fifth headline, the last of the recent ones',
    [{ heading: 'Presenters', body: said('Presenters keep their faces.') }],
    '2026-08-18',
  ),
  ...EARLIER,
];

const cmp = (a: string, b: string): number => {
  const x = a.split('.').map(Number);
  const y = b.split('.').map(Number);
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
};

/**
 * What GET /api/release/notes answers for these records (routes/updates.ts and
 * whatsNewWindow in release/notes.data.ts): `recent`, `history`, `unseen` and
 * `lead` are derived here the way the server derives them, never written by
 * hand. `recent` is always a prefix of `history`.
 */
function notesFor(records: Rec[], running: string, seen: string | null, over: Record<string, unknown> = {}) {
  const released = running !== '0.0.0';
  const newsworthy = (r: Rec) => r.sections.length > 0;
  const recent: Rec[] = [];
  let headlines = 0;
  for (const r of records) {
    if (headlines === HEADLINES_KEPT) break;
    if (!newsworthy(r)) continue;
    if (released && cmp(r.version, running) > 0) continue;
    recent.push(r);
    if (r.announce) headlines++;
  }
  const history = records.filter(
    (r) => newsworthy(r) && cmp(r.version, FIRST_PUBLIC) >= 0 && (!released || cmp(r.version, running) <= 0),
  );
  const unseen =
    seen === null || !released
      ? []
      : recent.filter((r) => cmp(seen, r.version) < 0 && cmp(r.version, running) <= 0).map((r) => r.version);
  return {
    version: running,
    entry: records.find((r) => r.version === running) ?? null,
    seen,
    recent,
    history,
    unseen,
    lead: recent.find((r) => r.announce && unseen.includes(r.version))?.version ?? null,
    changelogUrl: released ? `${RELEASES_URL}/tag/v${running}` : null,
    releasesUrl: records.some(newsworthy) ? RELEASES_URL : null,
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

/** The real server's answer, read without a page. */
async function realNotes(page: Page): Promise<Notes> {
  return (await (await page.request.get('/api/release/notes')).json()) as Notes;
}

/**
 * An IntersectionObserver that never sees anything, installed before boot, so
 * a test can hold the page to what the button alone does.
 */
async function blindObserver(page: Page): Promise<void> {
  await page.addInitScript(() => {
    class Blind {
      readonly root = null;
      readonly rootMargin = '0px';
      readonly thresholds = [0];
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() {
        return [];
      }
    }
    Object.defineProperty(window, 'IntersectionObserver', { value: Blind, configurable: true, writable: true });
  });
}

/**
 * A picture's accessible name: its own sentence, then what pressing it does.
 * The browser joins the picture's alt and the spoken words with a space.
 */
const escapeRe = (s: string) => s.replace(/[.*+?^$()|[\]\\{}]/g, (c) => `\\${c}`);
const viewLarger = (alt: string) => new RegExp(`^${escapeRe(alt)}\\s*, view larger$`);

const dialog = (p: Page) => p.locator('.sc-wn');
const dot = (p: Page) => p.locator('.sc-help-btn .sc-upd-dot');
const heading = (p: Page) => p.locator('#sc-wn-title');
const rows = (p: Page) => p.locator('ol.sc-wn-list > li.sc-wn-row');
const olds = (p: Page) => p.locator('section.sc-wn-part ol.sc-wn-olds > li.sc-wn-old');
const releases = (p: Page) => p.locator('li.sc-wn-row, li.sc-wn-old');
const byVersion = (p: Page, v: string) => p.locator(`[id="v${v}"]`);
/** A recent release's picture: the last thing in what it says, and a button that opens it larger. */
const pictureIn = (row: Locator) => row.locator('.sc-wn-what > button.sc-wn-media');
const more = (p: Page) => p.locator('.sc-wn-more').getByRole('button', { name: 'Show older updates' });
const footLink = (p: Page) => p.locator('footer.sc-wn-page-foot a.sc-wn-link');
const decoded = (img: Locator) =>
  img.evaluate((el) => (el as HTMLImageElement).complete && (el as HTMLImageElement).naturalWidth > 0);
const kinds = (p: Page) => rows(p).evaluateAll((els) => els.map((el) => el.getAttribute('data-kind')));
const ids = (l: Locator) => l.evaluateAll((els) => els.map((el) => el.id));
const focusedIs = (el: Locator) => el.evaluate((node) => node === document.activeElement);
const style = (el: Locator, prop: 'opacity' | 'cursor' | 'fontSize') =>
  el.evaluate((node, p) => getComputedStyle(node)[p], prop);
/** The picture a record carries: one at most, on the area it shows. */
const pictureOf = (r: Rec): Picture | null => r.sections.find((s) => s.image)?.image ?? null;
/** How far the document itself scrolls past the window: the page scrolls in its own pane, so none. */
const documentOverflow = (p: Page) =>
  p.evaluate(() => (document.scrollingElement as HTMLElement).scrollHeight - window.innerHeight);
/** Every release on the page, top to bottom, by version. */
const versionsDown = (p: Page) => releases(p).evaluateAll((els) => els.map((el) => el.id.replace(/^v/, '')));

/** A press at an element's centre, in whole pixels: Chromium ignores a press at fractional coordinates. */
async function pressAt(page: Page, el: Locator): Promise<void> {
  const b = await el.boundingBox();
  if (!b) throw new Error('nothing to press: the element has no box');
  await page.mouse.click(Math.round(b.x + b.width / 2), Math.round(b.y + b.height / 2));
}

/** Each picture scrolled to (the ones below the fold load lazily) and decoded. */
async function expectDecoded(imgs: Locator): Promise<void> {
  const n = await imgs.count();
  for (let i = 0; i < n; i++) {
    await imgs.nth(i).scrollIntoViewIfNeeded();
    await expect.poll(() => decoded(imgs.nth(i)), { message: `picture ${i + 1} of ${n} never decoded` }).toBe(true);
  }
}

/** Scroll the page's own pane to its end, again and again, until nothing older is left to load. */
async function scrollToTheEnd(page: Page, total: number): Promise<void> {
  for (let i = 0; i < Math.ceil(total / STEP) + 2 && (await more(page).count()) > 0; i++) {
    const before = await releases(page).count();
    await page.evaluate(() => {
      const pane = document.querySelector('.sc-wn-page')?.parentElement;
      if (pane) pane.scrollTop = pane.scrollHeight;
    });
    await expect
      .poll(() => releases(page).count(), { message: 'scrolling to the end loaded nothing older' })
      .toBeGreaterThan(before);
  }
  await expect(releases(page)).toHaveCount(total);
  await expect(more(page)).toHaveCount(0);
}

/** Versions strictly newest first, top to bottom. */
function expectDescending(versions: string[]): void {
  for (let i = 1; i < versions.length; i++) {
    expect(cmp(versions[i - 1], versions[i]), `${versions[i - 1]} then ${versions[i]}`).toBeGreaterThan(0);
  }
}

/** A stage's box and where its picture sits on it. */
function geometry(stage: Locator) {
  return stage.evaluate((el) => {
    const img = el.querySelector('img') as HTMLImageElement;
    const b = el.getBoundingClientRect();
    const i = img.getBoundingClientRect();
    return {
      width: b.width,
      ratio: b.width / b.height,
      margins: [i.top - b.top, b.right - i.right, b.bottom - i.bottom, i.left - b.left],
      shown: i.width / i.height,
      natural: img.naturalWidth / img.naturalHeight,
    };
  });
}

/** The stage's composition: one shape, the picture at its own, the same margin on all four sides. */
async function expectStaged(stage: Locator, where: string): Promise<number> {
  const g = await geometry(stage);
  const [top, right, bottom, left] = g.margins;
  expect(top, `${where}: no margin above the picture`).toBeGreaterThan(4);
  for (const [side, m] of [
    ['right', right],
    ['bottom', bottom],
    ['left', left],
  ] as const) {
    expect(Math.abs(m - top), `${where}: the ${side} margin is ${m}px, the top ${top}px`).toBeLessThanOrEqual(1);
  }
  expect(Math.abs(g.ratio - STAGE_RATIO), `${where}: the stage is not 400:239`).toBeLessThanOrEqual(0.01);
  expect(Math.abs(g.shown / g.natural - 1), `${where}: the picture is not at its own shape`).toBeLessThanOrEqual(0.01);
  return g.width;
}

/**
 * A scrim's paint, set against the app's own `--sc-scrim` resolved beside it,
 * and whatever it blurs behind it.
 */
const scrimLook = (el: Locator) =>
  el.evaluate((node) => {
    const probe = document.createElement('div');
    probe.style.background = 'var(--sc-scrim)';
    node.parentElement?.appendChild(probe);
    const token = getComputedStyle(probe).backgroundColor;
    probe.remove();
    const cs = getComputedStyle(node);
    return {
      background: cs.backgroundColor === token ? 'var(--sc-scrim)' : cs.backgroundColor,
      blur: cs.backdropFilter || 'none',
    };
  });

/**
 * A version tag: a label, never a control. The eye reads the version alone;
 * "Version " is spoken, and so is whether it is the version this computer
 * runs, which is the one tag lit.
 */
async function expectTag(tag: Locator, version: string, running: boolean): Promise<void> {
  await expect(tag).toHaveCount(1);
  if (running) {
    await expect(tag).toHaveText(`Version ${version}, the version you are on`);
    await expect(tag).toHaveAttribute('data-on');
  } else {
    await expect(tag).toHaveText(`Version ${version}`);
    await expect(tag).not.toHaveAttribute('data-on');
  }
  expect((await visibleWords(tag)).join(' '), `the tag for ${version} shows more than its version`).toBe(version);
}

/**
 * How a tag is drawn, set against the app's own tokens resolved beside it: a
 * pill (a radius of at least half its height), outlined in `--sc-line-strong`,
 * or filled with `--sc-inv-bg` when lit, and nothing to press.
 */
const tagLook = (tag: Locator) =>
  tag.evaluate((el) => {
    const probe = document.createElement('span');
    probe.style.borderColor = 'var(--sc-line-strong)';
    probe.style.backgroundColor = 'var(--sc-inv-bg)';
    el.parentElement?.appendChild(probe);
    const line = getComputedStyle(probe).borderTopColor;
    const inverse = getComputedStyle(probe).backgroundColor;
    probe.remove();
    const cs = getComputedStyle(el);
    const height = el.getBoundingClientRect().height;
    return {
      height,
      font: cs.fontSize,
      pill: Number.parseFloat(cs.borderTopLeftRadius) >= height / 2,
      outline: cs.borderTopColor === line ? 'var(--sc-line-strong)' : cs.borderTopColor,
      fill: cs.backgroundColor === inverse ? 'var(--sc-inv-bg)' : cs.backgroundColor,
      cursor: cs.cursor,
    };
  });

/** A page stage as the pointer or the keyboard sees it: its light, its open-larger mark, its ring, where things are. */
const stageLook = (stage: Locator) =>
  stage.evaluate((el) => {
    const img = el.querySelector('img') as HTMLImageElement;
    const mark = el.querySelector('.sc-corner .sc-cell-ctl') as HTMLElement;
    const box = (node: Element) => {
      const r = node.getBoundingClientRect();
      return [r.x, r.y, r.width, r.height].map((n) => Math.round(n * 2) / 2);
    };
    const cs = getComputedStyle(el);
    return {
      filter: cs.filter,
      ring: cs.outlineStyle,
      mark: getComputedStyle(mark).opacity,
      transform: getComputedStyle(img).transform,
      opacity: getComputedStyle(img).opacity,
      stage: box(el),
      picture: box(img),
    };
  });

/** An element's brightness every frame for a while: `none` is 1. */
const brightnessOver = (el: Locator, ms: number) =>
  el.evaluate(
    (node, span) =>
      new Promise<number[]>((resolve) => {
        const out: number[] = [];
        const end = performance.now() + span;
        const tick = () => {
          const f = getComputedStyle(node).filter;
          const m = f.match(/brightness\(([\d.]+)\)/);
          out.push(f === 'none' ? 1 : m ? Number(m[1]) : Number.NaN);
          if (performance.now() < end) requestAnimationFrame(tick);
          else resolve(out);
        };
        tick();
      }),
    ms,
  );

/** The words inside an element that a sighted person would read: everything but the visually hidden. */
const visibleWords = (el: Locator) =>
  el.evaluate((root) => {
    const out: string[] = [];
    const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      const t = n.textContent?.trim();
      if (t && !n.parentElement?.closest('.sc-vh')) out.push(t);
    }
    return out;
  });

// ---- the real server, nothing stubbed ----------------------------------------

test('on a fresh home nothing is unread: nothing opens, no dot, and the page shows the real window, every update titled', async ({
  page,
}) => {
  const posted: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/api/release/seen')) posted.push(r.method());
  });
  const notes = await realNotes(page);
  expect(notes.unseen).toEqual([]);
  expect(notes.lead).toBeNull();
  expect(notes.seen).toBe(notes.version);
  expect(notes.recent.length).toBeGreaterThan(0);
  expect(notes.history.length).toBeGreaterThanOrEqual(notes.recent.length);
  // recent is where the history starts, and every update in it has a title
  expect(notes.history.slice(0, notes.recent.length).map((r) => r.version)).toEqual(notes.recent.map((r) => r.version));
  expect(notes.history.filter((r) => !r.title).map((r) => r.version)).toEqual([]);
  // A picture is a record's own, named for its release and described in words.
  // The dialog's stand-in artwork is never one: no record the server sends names it.
  const entry = (notes as Notes & { entry: Rec | null }).entry;
  for (const r of [...notes.recent, ...notes.history, ...(entry ? [entry] : [])]) {
    const pics = r.sections.flatMap((s) => (s.image ? [s.image] : []));
    expect(pics.length, `${r.version} carries more than one picture`).toBeLessThanOrEqual(1);
    for (const pic of pics) {
      expect(pic.file).toMatch(new RegExp(`^${r.version.replace(/\./g, '\\.')}-[a-z0-9]+(?:-[a-z0-9]+)*\\.webp$`));
      expect(pic.alt.trim().length, `${pic.file} has no words`).toBeGreaterThan(0);
    }
  }

  await page.goto(HOME);
  await expect(page.locator('.sc-greet')).toBeVisible();
  await page.waitForTimeout(OUTWAIT_MS);
  await expect(dialog(page)).toHaveCount(0);
  await expect(dot(page)).toHaveCount(0);

  await page.goto(PAGE);
  await expect(page).toHaveTitle("What's new - Scenri");
  await expect(heading(page)).toBeFocused();
  const first = Math.min(notes.history.length, Math.max(STEP, notes.recent.length));
  await expect(releases(page)).toHaveCount(first);
  await expect(rows(page)).toHaveCount(notes.recent.length);
  await expect(olds(page)).toHaveCount(first - notes.recent.length);
  expect(await ids(rows(page))).toEqual(notes.recent.map((r) => `v${r.version}`));
  await expect(rows(page).locator('h2.sc-wn-row-hed')).toHaveText(notes.recent.map((r) => r.title as string));
  expect(await kinds(page)).toEqual(notes.recent.map((r) => (r.announce ? 'headline' : 'small')));
  expect(await documentOverflow(page), 'the document scrolls beside the page pane').toBe(0);

  // the lead is the newest update, the one the dialog shows: it only loads its picture first
  const featured = notes.recent[0] as Rec;
  const lead = page.locator('.sc-wn-row[data-lead]');
  await expect(lead).toHaveCount(1);
  await expect(lead).toHaveAttribute('id', `v${featured.version}`);

  // every recent update shows its version, the one running lit; its title; the picture its record
  // carries straight under the title; then each area's name over its sentence. One without a
  // picture goes from its title to its areas, never showing the dialog's artwork.
  for (const [i, r] of notes.recent.entries()) {
    const row = rows(page).nth(i);
    const pic = pictureOf(r);
    await expectTag(row.locator(':scope > .sc-wn-when .sc-tag-version'), r.version, r.version === notes.version);
    await expect(row.locator('.sc-wn-media')).toHaveCount(pic ? 1 : 0);
    // its release notes last, after its words, or its words last where nothing was published
    await expect(row.locator('.sc-wn-what > :last-child')).toHaveClass(
      notes.releasesUrl ? /\bsc-wn-notes\b/ : /\bsc-wn-areas\b/,
    );
    await expect(row.locator('.sc-wn-area h3')).toHaveText(r.sections.map((s) => s.heading));
    await expect(row.locator('.sc-wn-area p')).toHaveText(r.sections.map((s) => s.body));
    if (notes.releasesUrl) {
      const link = row.locator('.sc-wn-what > .sc-wn-areas + a.sc-wn-notes');
      await expect(link).toHaveAttribute('href', `${notes.releasesUrl}/tag/v${r.version}`);
      await expect(link).toHaveAttribute('target', '_blank');
    }
    if (!pic) {
      await expect(row.locator('img')).toHaveCount(0);
      await expect(row.locator('.sc-wn-what > .sc-wn-row-hed + .sc-wn-areas')).toHaveCount(1);
      continue;
    }
    await expect(row.locator('.sc-wn-what > .sc-wn-row-hed + button.sc-wn-media + .sc-wn-areas')).toHaveCount(1);
    // named by its own sentence, and by what pressing it does
    await expect(pictureIn(row)).toHaveAccessibleName(viewLarger(pic.alt));
    const img = pictureIn(row).locator('img');
    await expect(img).toHaveAttribute('alt', pic.alt);
    await expect(img).toHaveAttribute('loading', r.version === featured.version ? 'eager' : 'lazy');
  }
  await expect(page.locator('.sc-tag-version[data-on]')).toHaveCount(1);
  await expect(page.locator('.sc-wn-fallback')).toHaveCount(0);
  await expectDecoded(page.locator('.sc-wn-list .sc-wn-media img'));
  const sources = await page.locator('.sc-wn-page img').evaluateAll((els) => els.map((el) => el.getAttribute('src')));
  expect(sources.filter((s) => FALLBACK.test(s ?? ''))).toEqual([]);

  // the older history is a real button away, and the archive closes the page
  await expect(more(page)).toHaveCount(notes.history.length > first ? 1 : 0);
  if (notes.releasesUrl) await expect(footLink(page)).toHaveAttribute('href', notes.releasesUrl);
  // reading a history that was already read writes nothing
  expect(posted).toEqual([]);
});

test('every picture on the real page sits on its stage with four equal margins, at its own shape, the width of its words', async ({
  page,
}) => {
  const notes = await realNotes(page);
  const pictured = notes.recent.filter((r) => pictureOf(r));
  expect(pictured.length, 'the real history shows no picture at all').toBeGreaterThan(0);

  for (const width of [1440, 1100]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(PAGE);
    const stages = page.locator('.sc-wn-list button.sc-wn-media');
    await expect(stages).toHaveCount(pictured.length);
    await expectDecoded(stages.locator('img'));
    const widths: number[] = [];
    for (let i = 0; i < pictured.length; i++) {
      await stages.nth(i).scrollIntoViewIfNeeded();
      await expect(stages.nth(i)).toHaveAttribute('data-ready');
      const where = `${width}px, ${pictured[i].version}`;
      const w = await expectStaged(stages.nth(i), where);
      // as wide as the words it sits over
      const words = await stages
        .nth(i)
        .evaluate(
          (el) => el.parentElement?.querySelector(':scope > .sc-wn-areas')?.getBoundingClientRect().width ?? -1,
        );
      expect(Math.abs(w - words), `${where}: the picture is ${w}px, its words ${words}px`).toBeLessThanOrEqual(1);
      widths.push(w);
    }
    // the newest is not wider: every picture is the one measure, the measure of the words
    for (const w of widths) expect(Math.abs(w - widths[0])).toBeLessThanOrEqual(1);
    expect(widths[0]).toBeLessThanOrEqual(MEASURE + 1);
    expect(await documentOverflow(page)).toBe(0);
  }
});

test('the whole real history is a scroll away: the rest arrives as the end comes into view, newest first', async ({
  page,
}) => {
  const notes = await realNotes(page);
  await page.goto(PAGE);
  const first = Math.min(notes.history.length, Math.max(STEP, notes.recent.length));
  await expect(releases(page)).toHaveCount(first);
  expect(await documentOverflow(page)).toBe(0);

  await scrollToTheEnd(page, notes.history.length);
  await expect(rows(page)).toHaveCount(notes.recent.length);
  await expect(olds(page)).toHaveCount(notes.history.length - notes.recent.length);
  await expect(page.locator('#sc-wn-earlier')).toHaveText('Earlier releases');
  const down = await versionsDown(page);
  expect(down).toEqual(notes.history.map((r) => r.version));
  expectDescending(down);
  expect(down.at(-1)).toBe(FIRST_PUBLIC);
  // every earlier release is titled, and waits to be asked for
  await expect(olds(page).locator('span.sc-wn-old-hed')).toHaveText(
    notes.history.slice(notes.recent.length).map((r) => r.title as string),
  );
  await expect(page.locator('li.sc-wn-old details[open]')).toHaveCount(0);
  expect(await documentOverflow(page), 'the whole history stretched the document').toBe(0);
});

test('a link to the first public release shows the history down to it, opens it and puts it in view', async ({
  page,
}) => {
  const notes = await realNotes(page);
  await page.goto(`${PAGE}#v${FIRST_PUBLIC}`);
  const target = byVersion(page, FIRST_PUBLIC);
  await expect(target).toHaveClass(/\bsc-wn-old\b/);
  await expect(releases(page)).toHaveCount(notes.history.length);
  await expect(target.locator('details')).toHaveAttribute('open', '');
  await expect(target.locator('.sc-wn-old-body .sc-wn-area p').first()).toBeVisible();
  await expect(target.locator('summary')).toBeInViewport();
  await expect(page.locator('li.sc-wn-old details[open]')).toHaveCount(1);
  expectDescending(await versionsDown(page));
  expect(await documentOverflow(page)).toBe(0);
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
  const notes = await realNotes(page);

  await page.goto(PAGE);
  await expect(rows(page)).toHaveCount(notes.recent.length);
  await scrollToTheEnd(page, notes.history.length);
  const imgs = page.locator('.sc-wn-page .sc-wn-media > img');
  await expect(imgs).toHaveCount(notes.recent.filter((r) => pictureOf(r)).length);
  await expectDecoded(imgs);

  await page.goto(`${HOME}?whatsnew=1`);
  await expect(dialog(page)).toBeVisible();
  const featured = notes.recent[0] as Rec;
  const pic = pictureOf(featured);
  if (pic) {
    const hero = dialog(page).locator('.sc-wn-ex .sc-wn-media > img');
    await expect(hero).toHaveAttribute('alt', pic.alt);
    await expect.poll(() => decoded(hero)).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(dialog(page)).toHaveCount(0);

  expect(local, 'the route saw none of the local traffic, so it proves nothing').toBeGreaterThan(0);
  expect(outside, "What's new reached past this machine").toEqual([]);
});

// ---- stubbed histories ---------------------------------------------------------

test('Help leads to the page: its name takes the keyboard, nothing in the bar claims it, and every update is titled in one size', async ({
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

  // newest first, one timeline: four releases in all, nothing earlier and nothing more to load
  expect(await ids(rows(page))).toEqual(HISTORY.map((r) => `v${r.version}`));
  expect(await kinds(page)).toEqual(['small', 'headline', 'small', 'headline']);
  await expect(page.locator('section.sc-wn-part')).toHaveCount(0);
  await expect(more(page)).toHaveCount(0);
  // each release's date and its version chip; the version this computer runs is the lit one
  for (const r of HISTORY) {
    await expect(byVersion(page, r.version).locator(':scope > .sc-wn-when time')).toHaveAttribute(
      'datetime',
      r.date,
    );
    await expectTag(byVersion(page, r.version).locator(':scope > .sc-wn-when .sc-tag-version'), r.version, r.version === '9.9.9');
  }
  // plain or lit, a tag is a traditional version pill: outlined, or filled when it is yours, and nothing to press
  expect(await tagLook(byVersion(page, '9.9.8').locator(':scope > .sc-wn-when .sc-tag-version'))).toMatchObject({
    font: '12.5px',
    pill: true,
    outline: 'var(--sc-line-strong)',
    fill: 'rgba(0, 0, 0, 0)',
  });
  expect(await tagLook(byVersion(page, '9.9.9').locator(':scope > .sc-wn-when .sc-tag-version'))).toMatchObject({
    font: '12.5px',
    pill: true,
    fill: 'var(--sc-inv-bg)',
  });
  for (const v of ['9.9.9', '9.9.8']) {
    const look = await tagLook(byVersion(page, v).locator(':scope > .sc-wn-when .sc-tag-version'));
    expect(look.height, `${v}: the tag is ${look.height}px tall`).toBeGreaterThanOrEqual(20);
    expect(look.height, `${v}: the tag is ${look.height}px tall`).toBeLessThanOrEqual(26);
    expect(look.cursor).not.toBe('pointer');
  }
  // "you are on" is spoken, never shown
  expect((await visibleWords(page.locator('.sc-wn-page'))).join(' ')).not.toMatch(/you are on/i);
  // the lead is the newest update, the one the dialog shows, small or headline
  const lead = page.locator('.sc-wn-row[data-lead]');
  await expect(lead).toHaveCount(1);
  await expect(lead).toHaveAttribute('id', 'v9.9.9');

  // One type scale: the page's name, then every update's title at one size, small ones and the lead
  // alike, then each area's name over its sentence. Rows sit 48px apart across a hairline.
  await expect(rows(page).locator('h2.sc-wn-row-hed')).toHaveText(HISTORY.map((r) => r.title as string));
  const type = await page.evaluate(() => {
    const sizes = (sel: string) => [
      ...new Set(
        [...document.querySelectorAll(sel)].map((el) => {
          const cs = getComputedStyle(el);
          return `${cs.fontSize} ${cs.fontWeight}`;
        }),
      ),
    ];
    const color = (sel: string) => {
      const el = document.querySelector(sel);
      return el ? getComputedStyle(el).color : '';
    };
    return {
      name: sizes('#sc-wn-title'),
      titles: sizes('.sc-wn-row-hed'),
      areas: sizes('.sc-wn-area h3'),
      sentences: sizes('.sc-wn-area p'),
      areaInk: color('.sc-wn-area h3') === color('.sc-wn-row-hed'),
      sentenceInk: color('.sc-wn-area p') !== color('.sc-wn-area h3'),
    };
  });
  expect(type).toEqual({
    name: ['42px 600'],
    titles: ['20px 600'],
    areas: ['15px 600'],
    sentences: ['15px 400'],
    areaInk: true,
    sentenceInk: true,
  });
  const apart = await rows(page)
    .nth(1)
    .evaluate((el) => {
      const cs = getComputedStyle(el);
      return [cs.marginTop, cs.paddingTop, cs.borderTopWidth, cs.borderTopStyle];
    });
  expect(apart).toEqual(['48px', '48px', '1px', 'solid']);

  // each area is its own name over its sentence, never run into it, one area or three
  await expect(byVersion(page, '9.9.9').locator('.sc-wn-area h3')).toHaveText(['Fixes']);
  await expect(byVersion(page, '9.9.9').locator('.sc-wn-area p')).toHaveText([
    'Scene draws show in the bell as soon as they start.',
  ]);
  await expect(byVersion(page, '9.9.8').locator('.sc-wn-area h3')).toHaveText(['Library', 'Scenes', 'Create']);
  await expect(byVersion(page, '9.9.6').locator('.sc-wn-area h3')).toHaveText(['Create']);
  await expect(byVersion(page, '9.9.6').locator('.sc-wn-area p')).toHaveText(['Better picks.']);
  await expect(page.locator('.sc-wn-page .sc-wn-line, .sc-wn-page b')).toHaveCount(0);

  // a picture sits straight under its update's title, headline or small, and is a button that opens it larger
  for (const [version, pic, loading] of [
    ['9.9.9', PIC_B, 'eager'],
    ['9.9.8', PIC_A, 'lazy'],
  ] as const) {
    const row = byVersion(page, version);
    const btn = pictureIn(row);
    await expect(btn).toHaveCount(1);
    await expect(row.locator('.sc-wn-what > .sc-wn-row-hed + button.sc-wn-media + .sc-wn-areas')).toHaveCount(1);
    await expect(btn).toHaveAttribute('aria-haspopup', 'dialog');
    await expect(btn).toHaveAccessibleName(viewLarger(pic.alt));
    expect(await style(btn, 'cursor')).toBe('zoom-in');
    await expect(btn.locator('img')).toHaveAttribute('src', builtFile(pic));
    await expect(btn.locator('img')).toHaveAttribute('loading', loading);
  }
  await expect(byVersion(page, '9.9.7').locator('.sc-wn-media')).toHaveCount(0);
  await expect(byVersion(page, '9.9.6').locator('.sc-wn-media')).toHaveCount(0);
  await expectDecoded(page.locator('.sc-wn-list .sc-wn-media img'));
  expect(await documentOverflow(page)).toBe(0);

  // nothing was unread, so nothing was written
  await page.waitForTimeout(OUTWAIT_MS);
  expect(acked).toEqual([]);
});

test("Full release notes goes to the archive, and each release's own notes to its page, in a new tab", async ({
  page,
}) => {
  await serve(page, HISTORY, '9.9.9', '9.9.9');
  await page.goto(PAGE);
  await expect(rows(page)).toHaveCount(4);
  const link = footLink(page);
  await expect(link).toHaveAttribute('href', RELEASES_URL);
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(link).toHaveAttribute('rel', /\bnoopener\b/);
  await expect(link).toHaveAccessibleName(/^Full release notes on GitHub, opens in a new tab$/);
  // the words a person sees are the short ones; the rest is spoken
  await expect(link.locator('.sc-vh')).toHaveText(' on GitHub, opens in a new tab');

  const notes = rows(page).locator('.sc-wn-what > a.sc-wn-notes');
  await expect(notes).toHaveCount(4);
  for (const [i, r] of HISTORY.entries()) {
    await expect(notes.nth(i)).toHaveAttribute('href', `${RELEASES_URL}/tag/v${r.version}`);
    await expect(notes.nth(i)).toHaveAttribute('target', '_blank');
    await expect(notes.nth(i)).toHaveAccessibleName(`Release notes for ${r.version} on GitHub, opens in a new tab`);
  }
});

test('with no archive to point at, the page offers no link to an empty page', async ({ page }) => {
  await serve(page, HISTORY, '9.9.9', '9.9.9', { releasesUrl: null });
  await page.goto(PAGE);
  await expect(rows(page)).toHaveCount(4);
  await expect(page.locator('footer.sc-wn-page-foot')).toHaveCount(0);
  await expect(page.getByRole('link', { name: /Full release notes/ })).toHaveCount(0);
  await expect(page.locator('a.sc-wn-notes')).toHaveCount(0);
});

test('a picture the build does not carry, or one that fails to load, leaves no hole: the update reads as words', async ({
  page,
}) => {
  // the picture the build does carry is made to fail on the way
  await page.route(builtFile(PIC_C), (route) => route.abort('failed'));
  const records = [
    headline('9.9.9', 'Its picture never shipped', [
      { heading: 'Create', body: 'Better picks.', image: PIC_MISSING },
      { heading: 'Fixes', body: 'Mobile layout stability.' },
    ]),
    small('9.9.8', 'Its picture fails to load', [{ heading: 'Library', body: 'More of it.', image: PIC_C }]),
    headline('9.9.7', 'Its picture arrives', [{ heading: 'Library', body: 'Select several at once.', image: PIC_B }]),
  ];
  await serve(page, records, '9.9.9', '9.9.9');
  await page.goto(PAGE);
  await expect(rows(page)).toHaveCount(3);

  const missing = byVersion(page, '9.9.9');
  await expect(missing.locator('h2.sc-wn-row-hed')).toHaveText('Its picture never shipped');
  await expect(missing.locator('.sc-wn-area h3')).toHaveText(['Create', 'Fixes']);
  await expect(missing.locator('.sc-wn-area p')).toHaveText(['Better picks.', 'Mobile layout stability.']);
  await expect(missing.locator(':is(.sc-wn-media, img, figure)')).toHaveCount(0);
  await expect(missing.locator('.sc-wn-what > .sc-wn-row-hed + .sc-wn-areas')).toHaveCount(1);

  const failed = byVersion(page, '9.9.8');
  await failed.scrollIntoViewIfNeeded();
  await expect(failed.locator(':is(.sc-wn-media, img)')).toHaveCount(0);
  await expect(failed.locator('.sc-wn-what > .sc-wn-row-hed + .sc-wn-areas')).toHaveCount(1);

  const arrives = byVersion(page, '9.9.7');
  await expect(pictureIn(arrives)).toHaveCount(1);
  await expectDecoded(pictureIn(arrives).locator('img'));

  // the dialog's stand-in artwork never stands in here
  await expect(page.locator('.sc-wn-fallback')).toHaveCount(0);
  const sources = await page.locator('.sc-wn-page img').evaluateAll((els) => els.map((el) => el.getAttribute('src')));
  expect(sources.filter((s) => FALLBACK.test(s ?? ''))).toEqual([]);
});

test('under the pointer a picture lifts and shows its open-larger mark: never darker, nothing moves, and it stays pressable', async ({
  page,
}) => {
  await serve(page, HISTORY, '9.9.9', '9.9.9');
  await page.goto(PAGE);
  const btn = pictureIn(byVersion(page, '9.9.8'));
  await expectDecoded(btn.locator('img'));
  await expect(btn).toHaveAttribute('data-ready');
  // the mark is for the eye alone, and never in the way of a press
  // the scene page's corner control, as a mark
  const mark = btn.locator('span.sc-corner');
  await expect(mark).toHaveCount(1);
  await expect(mark).toHaveAttribute('aria-hidden', 'true');
  await expect(mark.locator('.sc-cell-ctl')).toHaveCount(1);
  expect(await mark.evaluate((el) => getComputedStyle(el).pointerEvents)).toBe('none');
  expect(await mark.locator('.sc-cell-ctl').evaluate((el) => getComputedStyle(el).pointerEvents)).toBe('none');
  await expect(btn).toHaveAccessibleName(viewLarger(PIC_A.alt));

  await page.mouse.move(2, 2);
  // the picture has finished fading in before anything is compared with it
  await expect.poll(async () => (await stageLook(btn)).opacity).toBe('1');
  const rest = await stageLook(btn);
  expect(rest).toMatchObject({ filter: 'none', mark: '0', transform: 'none', opacity: '1' });

  const box = await btn.boundingBox();
  const sampling = brightnessOver(btn, 700);
  await page.mouse.move(Math.round((box?.x ?? 0) + (box?.width ?? 0) / 2), Math.round((box?.y ?? 0) + 40));
  const samples = await sampling;
  expect(Math.min(...samples), `the stage darkened on its way: ${samples.join(', ')}`).toBeGreaterThanOrEqual(1);
  await expect.poll(async () => (await stageLook(btn)).filter).toBe(BRIGHTER);
  await expect.poll(async () => (await stageLook(btn)).mark).toBe('1');
  // nothing grows, nothing moves, nothing fades
  expect(await stageLook(btn)).toMatchObject({
    transform: 'none',
    opacity: '1',
    stage: rest.stage,
    picture: rest.picture,
  });

  // a press on the mark itself is a press on the picture: it opens larger, and a press anywhere closes it
  await pressAt(page, mark);
  const large = page.getByRole('dialog', { name: PIC_A.alt });
  await expect(large).toBeVisible();
  await page.mouse.click(12, 12);
  await expect(large).toHaveCount(0);
  await expect.poll(() => focusedIs(btn)).toBe(true);

  // the pointer has left it: it settles back without dipping below where it started
  const leaving = brightnessOver(btn, 700);
  expect(Math.min(...(await leaving))).toBeGreaterThanOrEqual(1);
  await expect.poll(async () => (await stageLook(btn)).filter).toBe('none');
  await expect.poll(async () => (await stageLook(btn)).mark).toBe('0');

  // and a plain click on the picture opens it as well
  await btn.click();
  await expect(large).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(large).toHaveCount(0);
});

// ---- the lightbox: the page's picture, larger ---------------------------------

test('a picture opens larger and nothing else: named by its words, the stage itself, and a press anywhere closes it', async ({
  page,
}) => {
  await serve(page, HISTORY, '9.9.9', '9.9.9');
  await page.goto(PAGE);
  const btn = pictureIn(byVersion(page, '9.9.8'));
  await expectDecoded(btn.locator('img'));
  const src = (await btn.locator('img').getAttribute('src')) as string;
  const small = (await btn.boundingBox())?.width ?? 0;

  await btn.click();
  const box = page.getByRole('dialog', { name: PIC_A.alt });
  await expect(box).toBeVisible();
  await expect(box).toHaveClass(/\bsc-wn-lb\b/);
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await expect.poll(() => focusedIs(box)).toBe(true);

  // the app's scrim, and nothing blurred behind it
  const scrim = page.locator('.sc-wn-lb-scrim');
  await expect(scrim).toHaveCount(1);
  expect(await scrimLook(scrim)).toEqual({ background: 'var(--sc-scrim)', blur: 'none' });

  // the stage itself, larger: the sky and the picture as one image, the same composition as on the page
  const stage = box.locator(':scope > .sc-wn-media.sc-wn-lb-stage');
  await expect(stage).toHaveCount(1);
  expect(await stage.evaluate((el) => el.tagName)).toBe('DIV');
  const large = stage.locator('img');
  await expect(large).toHaveAttribute('src', src);
  await expect(large).toHaveAttribute('alt', PIC_A.alt);
  await expect.poll(() => decoded(large)).toBe(true);
  expect(await expectStaged(stage, 'the lightbox')).toBeGreaterThan(small);

  // and nothing else: no caption, no stepping, no words to read, one button, which a pointer never sees
  expect(await visibleWords(box)).toEqual([]);
  await expect(box.locator('.sc-corner, figcaption')).toHaveCount(0);
  await expect(box.locator('button')).toHaveCount(1);
  const close = box.locator('button.sc-wn-lb-close');
  await expect(close).toHaveAttribute('aria-label', 'Close');
  expect(await style(close, 'opacity')).toBe('0');

  // a press anywhere closes it, and the keyboard is back on the picture that opened it
  await page.mouse.click(12, 12);
  await expect(box).toHaveCount(0);
  await expect(scrim).toHaveCount(0);
  await expect.poll(() => focusedIs(btn)).toBe(true);

  // a press on the picture itself too
  await btn.click();
  await expect(box).toBeVisible();
  await expect.poll(() => decoded(large)).toBe(true);
  await pressAt(page, large);
  await expect(box).toHaveCount(0);
  await expect.poll(() => focusedIs(btn)).toBe(true);
  expect(await documentOverflow(page)).toBe(0);
});

test('the keyboard reaches a picture, sees it lifted and ringed, opens it with Enter or Space, and comes back to it', async ({
  page,
}) => {
  await serve(page, HISTORY, '9.9.9', '9.9.9');
  await page.goto(PAGE);
  // the page takes the keyboard to its name as it opens; from there the first
  // release's picture, which comes before its words and its notes
  await expect(heading(page)).toBeFocused();
  const btn = pictureIn(byVersion(page, '9.9.9'));
  await expectDecoded(btn.locator('img'));
  await page.keyboard.press('Tab');
  await expect(btn).toBeFocused();
  // the keyboard gets what the pointer gets, the lift and the mark, and the ring
  await expect.poll(async () => (await stageLook(btn)).filter).toBe(BRIGHTER);
  await expect.poll(async () => (await stageLook(btn)).mark).toBe('1');
  expect((await stageLook(btn)).ring).toBe('solid');

  await page.keyboard.press('Enter');
  const box = page.getByRole('dialog', { name: PIC_B.alt });
  await expect(box).toBeVisible();
  await expect.poll(() => focusedIs(box)).toBe(true);
  const close = box.getByRole('button', { name: 'Close' });
  expect(await style(close, 'opacity')).toBe('0');

  // the close button shows once the keyboard is on it, and the keyboard cannot leave the lightbox
  await page.keyboard.press('Tab');
  await expect(close).toBeFocused();
  await expect.poll(() => style(close, 'opacity')).toBe('1');
  await page.keyboard.press('Tab');
  await expect(close).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(box).toHaveCount(0);
  await expect.poll(() => focusedIs(btn)).toBe(true);

  // Space opens it too, and Escape closes it
  await page.keyboard.press(' ');
  await expect(box).toBeVisible();
  await expect.poll(() => focusedIs(box)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(box).toHaveCount(0);
  await expect.poll(() => focusedIs(btn)).toBe(true);
  // back on the picture, and never dimmed on the way
  expect(Math.min(...(await brightnessOver(btn, 600)))).toBeGreaterThanOrEqual(1);
});

test('with reduced motion nothing on the page animates: the lift and the mark arrive at once, and nothing fades in', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await serve(page, HISTORY, '9.9.9', '9.9.9');
  await page.goto(PAGE);
  const btn = pictureIn(byVersion(page, '9.9.8'));
  await expectDecoded(btn.locator('img'));
  const moving = await btn.evaluate((el) =>
    [el, el.querySelector('img'), el.querySelector('.sc-corner .sc-cell-ctl')].map((node) =>
      node ? getComputedStyle(node).transitionDuration : 'missing',
    ),
  );
  expect(moving, 'the stage, the picture and the mark still transition').toEqual(['0s', '0s', '0s']);

  // under the pointer the lift and the mark are simply there, and still never darker
  await btn.hover();
  expect(await stageLook(btn)).toMatchObject({ filter: BRIGHTER, mark: '1', transform: 'none', opacity: '1' });

  // the lightbox arrives without fading
  await btn.click();
  const box = page.getByRole('dialog', { name: PIC_A.alt });
  await expect(box).toBeVisible();
  const fades = await page.evaluate(() =>
    ['.sc-wn-lb-scrim', '.sc-wn-lb .sc-wn-lb-stage'].map((sel) => {
      const el = document.querySelector(sel);
      return el ? getComputedStyle(el).animationName : 'missing';
    }),
  );
  expect(fades).toEqual(['none', 'none']);
  await page.keyboard.press('Escape');
  await expect(box).toHaveCount(0);

  // and so does the dialog, behind a scrim that does not fade either
  await page.goto(`${HOME}?whatsnew=preview`);
  await expect(dialog(page)).toBeVisible();
  const arrives = await page.evaluate(() => {
    const cs = (sel: string) => {
      const el = document.querySelector(sel);
      return el ? getComputedStyle(el) : null;
    };
    return {
      card: cs('.sc-wn')?.animationName ?? 'missing',
      scrim: cs('.sc-newdlg-scrim')?.animationName ?? 'missing',
      stage: cs('.sc-wn-ex .sc-wn-media')?.transitionDuration ?? 'missing',
    };
  });
  expect(arrives).toEqual({ card: 'none', scrim: 'none', stage: '0s' });
  await page.keyboard.press('Escape');
  await expect(dialog(page)).toHaveCount(0);
});

// ---- the earlier releases, and the rest of the history ------------------------------

test('the releases before the recent ones carry on the same timeline, folded: the same date column and title, opening to their words', async ({
  page,
}) => {
  await blindObserver(page);
  await serve(page, LONG, '2.0.24', '2.0.24');
  await page.goto(PAGE);
  // the first ten: the seven recent as open rows, then three earlier ones
  await expect(rows(page)).toHaveCount(7);
  await expect(olds(page)).toHaveCount(STEP - 7);
  // their heading is for screen readers alone
  const earlier = page.locator('#sc-wn-earlier');
  await expect(earlier).toHaveText('Earlier releases');
  await expect(earlier).toHaveClass(/\bsc-vh\b/);
  await expect(page.getByRole('region', { name: 'Earlier releases' })).toHaveCount(1);
  // each one closed: its summary alone, none of its words, never a picture
  await expect(page.locator('li.sc-wn-old > details > summary')).toHaveCount(STEP - 7);
  await expect(page.locator('li.sc-wn-old details[open]')).toHaveCount(0);
  await expect(page.locator('.sc-wn-old-body').first()).toBeHidden();
  await expect(page.locator('li.sc-wn-old .sc-wn-media')).toHaveCount(0);

  // the same date column and the same title, in the same place and at the same size as the open rows
  const settings = byVersion(page, '2.0.17');
  await expect(settings.locator('summary .sc-wn-when time > [aria-hidden="true"]')).toHaveText('18 Jul 2026');
  await expect(settings.locator('summary .sc-wn-when')).toContainText('2.0.17');
  await expect(settings.locator('summary span.sc-wn-old-hed')).toHaveText('Settings open where you left them');
  await expect(byVersion(page, '2.0.16').locator('summary span.sc-wn-old-hed')).toHaveText(
    'An earlier headline, number 16',
  );
  const lined = await page.evaluate(() => {
    const left = (sel: string) => document.querySelector(sel)?.getBoundingClientRect().left ?? Number.NaN;
    const size = (sel: string) => {
      const el = document.querySelector(sel);
      return el ? getComputedStyle(el).fontSize : '';
    };
    return {
      date: Math.abs(left('li.sc-wn-row .sc-wn-when') - left('li.sc-wn-old summary .sc-wn-when')) <= 1,
      title: Math.abs(left('li.sc-wn-row .sc-wn-row-hed') - left('li.sc-wn-old .sc-wn-old-hed')) <= 1,
      size: size('li.sc-wn-row .sc-wn-row-hed') === size('li.sc-wn-old .sc-wn-old-hed'),
    };
  });
  expect(lined).toEqual({ date: true, title: true, size: true });

  // opening one shows the same areas as an open row, each name over its sentence, then its release notes
  await settings.locator('summary').click();
  await expect(settings.locator('details')).toHaveAttribute('open', '');
  await expect(settings.locator('.sc-wn-old-body > .sc-wn-areas .sc-wn-area h3')).toHaveText(['Settings', 'Fixes']);
  await expect(settings.locator('.sc-wn-old-body > .sc-wn-areas .sc-wn-area p')).toHaveText([
    'Settings open on the page you left.',
    'The bell no longer rings twice.',
  ]);
  await expect(settings.locator('.sc-wn-old-body > .sc-wn-areas + a.sc-wn-notes')).toHaveCount(1);
  const notes = settings.locator('.sc-wn-old-body a.sc-wn-notes');
  await expect(notes).toBeVisible();
  await expect(notes).toHaveAttribute('href', `${RELEASES_URL}/tag/v2.0.17`);
  await expect(notes).toHaveAttribute('target', '_blank');
  // and the keyboard closes it again from its summary
  await settings.locator('summary').focus();
  await page.keyboard.press('Enter');
  await expect(settings.locator('details')).not.toHaveAttribute('open', '');
  expect(await documentOverflow(page)).toBe(0);
});

test('Show older updates is a real button: the keyboard adds ten at a time until the history ends', async ({
  page,
}) => {
  // the button alone, never the scroll: an observer that sees nothing
  await blindObserver(page);
  await serve(page, LONG, '2.0.24', '2.0.24');
  await page.goto(PAGE);
  await expect(releases(page)).toHaveCount(STEP);
  await expect(more(page)).toHaveCount(1);

  await more(page).focus();
  await page.keyboard.press('Enter');
  await expect(releases(page)).toHaveCount(2 * STEP);
  await expect(olds(page)).toHaveCount(2 * STEP - 7);

  await more(page).focus();
  await page.keyboard.press(' ');
  await expect(releases(page)).toHaveCount(LONG.length);
  await expect(more(page)).toHaveCount(0);
  const down = await versionsDown(page);
  expect(down).toEqual(LONG.map((r) => r.version));
  expectDescending(down);
  expect(await documentOverflow(page)).toBe(0);
});

test('Show older updates keeps the keyboard: on the same button while more remains, then on the first release the last press brought', async ({
  page,
}) => {
  await blindObserver(page);
  await serve(page, LONG, '2.0.24', '2.0.24');
  await page.goto(PAGE);
  await expect(releases(page)).toHaveCount(STEP);
  const button = more(page);
  await button.focus();
  // marked, so the button after the press is proved to be the very same element
  await button.evaluate((el) => {
    (el as HTMLElement & { e2eSame?: boolean }).e2eSame = true;
  });
  await page.keyboard.press('Enter');
  await expect(releases(page)).toHaveCount(2 * STEP);
  // more remains: the keyboard is still on the button that was pressed, not a new one
  await expect(button).toBeFocused();
  expect(await page.evaluate(() => (document.activeElement as { e2eSame?: boolean } | null)?.e2eSame)).toBe(true);

  // the last press takes the button away, and the keyboard lands on the first release that press brought
  const first = LONG[2 * STEP].version;
  await page.keyboard.press('Enter');
  await expect(releases(page)).toHaveCount(LONG.length);
  await expect(button).toHaveCount(0);
  await expect(byVersion(page, first).locator('summary')).toBeFocused();
  expect((await versionsDown(page))[2 * STEP]).toBe(first);
  // a real place to be: the keyboard opens it from there
  await page.keyboard.press('Enter');
  await expect(byVersion(page, first).locator('details')).toHaveAttribute('open', '');
});

test('scrolling to the end of a long history loads the rest by itself, and moves no focus', async ({ page }) => {
  await serve(page, LONG, '2.0.24', '2.0.24');
  await page.goto(PAGE);
  await expect(releases(page)).toHaveCount(STEP);
  await expect(heading(page)).toBeFocused();
  await scrollToTheEnd(page, LONG.length);
  expectDescending(await versionsDown(page));
  expect(await documentOverflow(page)).toBe(0);
  // loading by scrolling is not a press: the keyboard stays on the page's name
  await expect(heading(page)).toBeFocused();
});

test('a link to one release shows the history down to it, opens an earlier one, and puts it in view', async ({
  page,
}) => {
  await serve(page, LONG, '2.0.24', '2.0.24');
  await page.goto(`${PAGE}#v2.0.1`);
  const early = byVersion(page, '2.0.1');
  await expect(early).toHaveClass(/\bsc-wn-old\b/);
  await expect(early.locator('details')).toHaveAttribute('open', '');
  await expect(early.locator('.sc-wn-old-body .sc-wn-area h3')).toHaveText(['Fixes']);
  await expect(early.locator('.sc-wn-old-body .sc-wn-area p')).toHaveText(['Small fix number 1.']);
  await expect(early.locator('summary')).toBeInViewport();
  // everything above it is on the page, newest first, and only it is open
  expect((await versionsDown(page)).slice(0, LONG.length - 1)).toEqual(LONG.slice(0, -1).map((r) => r.version));
  await expect(page.locator('li.sc-wn-old details[open]')).toHaveCount(1);
  expect(await documentOverflow(page)).toBe(0);

  // a recent release is an open row: it is scrolled to, and there is nothing to open
  await page.goto(`${PAGE}#v2.0.18`);
  const recent = byVersion(page, '2.0.18');
  await expect(recent).toHaveClass(/\bsc-wn-row\b/);
  await expect(recent.locator('h2.sc-wn-row-hed')).toBeInViewport();
  await expect(page.locator('li.sc-wn-old details[open]')).toHaveCount(0);
});

// ---- when there is nothing to show -----------------------------------------------

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
  await expect(more(page)).toHaveCount(0);
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
  await expect(more(page)).toHaveCount(0);
  await expect(page.locator('footer.sc-wn-page-foot')).toHaveCount(0);
});

test('a maintenance release is not a row: the history before it is, and reading it writes nothing', async ({
  page,
}) => {
  const records = [
    maintenance('9.9.9'),
    headline('9.9.8', 'The last headline', [{ heading: 'Create', body: 'Better picks.' }]),
    small('9.9.7', 'A small one'),
  ];
  const acked = await serve(page, records, '9.9.9', '9.9.8');
  await page.goto(HOME);
  await expect(page.locator('.sc-greet')).toBeVisible();
  await page.waitForTimeout(OUTWAIT_MS);
  await expect(dialog(page)).toHaveCount(0);
  await expect(dot(page)).toHaveCount(0);

  await page.goto(PAGE);
  await expect(rows(page)).toHaveCount(2);
  expect(await ids(rows(page))).toEqual(['v9.9.8', 'v9.9.7']);
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
  await expect(page.locator('.sc-wn-row[data-lead]')).toHaveAttribute('id', 'v9.9.9');
  await expect(footLink(page)).toHaveAttribute('href', RELEASES_URL);
  // no version runs here, so every tag is plain and none says where you are
  await expect(page.locator('.sc-wn-row > .sc-wn-when .sc-tag-version')).toHaveCount(HISTORY.length);
  await expect(page.locator('.sc-tag-version[data-on]')).toHaveCount(0);
  await expect(page.locator('.sc-wn-page')).not.toContainText('the version you are on');
  expect(acked).toEqual([]);
});
