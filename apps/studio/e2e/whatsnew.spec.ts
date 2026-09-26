import { test, expect, type Locator, type Page } from '@playwright/test';
import { isolate } from './harness.js';
import { FIRST_USE } from '../src/firstUse.js';

/**
 * What's new, the dialog: one headline update, introduced once, as an excerpt.
 *
 * The excerpt is the update's picture on its stage (or, for an update with no
 * picture of its own, the artwork that stands in for one, with the version on
 * it), its date and version chip, and its headline, and all of it is one link
 * to that release on the What's New page. whats-new-page.spec.ts owns the page
 * and the lightbox, which is the page's alone. This file is about when the
 * dialog opens by itself, what it shows, where its link leads, the preview
 * that reads nothing, and that every way out of a real showing is the
 * acknowledgement.
 *
 * The notes read is stubbed in most tests, and the stub answers the way the
 * server does (`notesFor` below), so a test can never hold the app to a
 * history the server could not send. Acknowledgements are routed and recorded
 * too, so nothing here writes into this file's home; the tests that read the
 * real server say so.
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
/** The first public release: the history the server sends starts there (FIRST_PUBLIC in notes.data.ts). */
const FIRST_PUBLIC = '0.2.0';
/** The newest headline updates the in-app window reaches down to (HEADLINES_KEPT in notes.data.ts). */
const HEADLINES_KEPT = 5;
/** The stage's step under the pointer (whatsnew.css): a lift, never a dim. */
const BRIGHTER = 'brightness(1.12)';

type Picture = { file: string; alt: string };
type Section = { heading: string; body: string; image?: Picture };
/**
 * A release record as the server sends it. Every update the app shows has a
 * title; `announce` makes it a headline update, the only kind that opens the
 * dialog by itself. A maintenance record has neither, and no sections.
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
/**
 * The artwork that stands in for a picture (src/assets/whatsnew-fallback.svg):
 * small enough that the build inlines it, so it is either that data or the file.
 */
const FALLBACK_SRC = /^data:image\/svg\+xml|\/whatsnew-fallback[^/]*\.svg$/;

/** A headline update: it announces itself, and may open the dialog by itself. */
const headline = (
  version: string,
  title: string,
  sections: Section[] = [{ heading: 'Create', body: 'Better picks.' }],
  date = '2026-08-10',
): Rec => ({ version, date, title, announce: true, sections });
/** A small update: titled like every update, and it never interrupts. */
const small = (
  version: string,
  title: string,
  sections: Section[] = [{ heading: 'Fixes', body: 'Notifications no longer fire twice.' }],
  date = '2026-08-12',
): Rec => ({ version, date, title, sections });
/** A maintenance release: no title and nothing to say, so it is nowhere in What's New. */
const maintenance = (version: string): Rec => ({ version, date: '2026-08-16', sections: [] });

const HEADLINE = headline(
  '9.9.9',
  'A short headline for this release',
  [
    { heading: 'Create', body: 'Improved asset selection and refinement.', image: PIC_A },
    { heading: 'Scenes', body: 'Ten new creative scenes.' },
    { heading: 'Fixes', body: 'Presenter consistency and mobile layout stability.' },
  ],
  '2026-08-16',
);

/**
 * A history whose dialog leads somewhere worth scrolling to: the headline it
 * introduces (9.9.8) is the second row on the page, under a small update with
 * a picture of its own, with enough below it to scroll it to the top.
 */
const LINKED: Rec[] = [
  small('9.9.9', 'A small update with a picture of its own', [
    { heading: 'Fixes', body: 'Selected scenes keep their tick when the wall reloads.', image: PIC_B },
  ]),
  headline('9.9.8', 'The headline the dialog introduces', [
    { heading: 'Library', body: 'The library holds more of everything.', image: PIC_A },
    { heading: 'Scenes', body: 'Any picture of a scene can be the frame a shot follows.' },
  ]),
  small('9.9.7', 'A small update told in words'),
  headline('9.9.6', 'An earlier headline', [
    { heading: 'Local access', body: 'Scan a code and the studio opens on your phone.', image: PIC_C },
  ]),
  small('9.9.5', 'The last update already read'),
];

/**
 * Updates with no picture of their own, around one with a picture: the
 * running headline (9.9.9), a small update (9.9.8), a pictured headline
 * (9.9.7) and a pictureless one (9.9.6).
 */
const WORDS: Rec[] = [
  headline('9.9.9', 'A headline without a picture', [
    { heading: 'Create', body: 'Prompts keep their chips when you paste them.' },
    { heading: 'Fixes', body: 'Mobile layout stability.' },
  ]),
  small('9.9.8', 'A small update without a picture'),
  headline('9.9.7', 'An earlier headline with its own picture', [
    { heading: 'Library', body: 'Select several at once.', image: PIC_B },
  ]),
  headline('9.9.6', 'An older headline in words alone'),
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

/** The real server's answer, read without a page. */
async function realNotes(page: Page): Promise<Notes> {
  return (await (await page.request.get('/api/release/notes')).json()) as Notes;
}

/** Every acknowledgement the page tries to make against the real server, fulfilled or not. */
function watchSeen(page: Page): string[] {
  const posted: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/api/release/seen')) posted.push(`${r.method()} ${r.postData() ?? ''}`);
  });
  return posted;
}

/**
 * Open the dialog by address the way the app itself does (useDialogParam's
 * open): a new entry in this page's history, not a new page load, so Back is a
 * way out of it rather than a reload.
 */
async function openByAddress(page: Page, value: string): Promise<void> {
  await page.evaluate((v) => {
    const u = new URL(window.location.href);
    u.searchParams.set('whatsnew', v);
    const was = (window.history.state ?? {}) as { idx?: number };
    const state = { usr: null, key: `e2e${Date.now().toString(36)}`, idx: (was.idx ?? 0) + 1 };
    window.history.pushState(state, '', u);
    window.dispatchEvent(new PopStateEvent('popstate', { state }));
  }, value);
}

const dialog = (p: Page) => p.locator('.sc-wn');
/** The one update the dialog introduces: picture or artwork, when, headline, one link. */
const excerpt = (p: Page) => dialog(p).locator('article.sc-wn-ex');
const excerptLink = (p: Page) => excerpt(p).locator('h3.sc-wn-hed > a.sc-wn-ex-link');
/** The excerpt's stage: the update's picture, or the artwork standing in for one. Never a button. */
const stage = (p: Page) => excerpt(p).locator('.sc-wn-media');
/** The date line; it carries the version tag, unless the artwork already does. */
const meta = (p: Page) => excerpt(p).locator('p.sc-wn-when');
/** The dialog's head, where the version this computer runs is said when the update is an earlier one. */
const headTag = (p: Page) => dialog(p).locator('.sc-newdlg-head .sc-wn-chip');
const footLink = (p: Page) => dialog(p).locator('.sc-wn-foot a.sc-wn-link');
const gotIt = (p: Page) => dialog(p).getByRole('button', { name: 'Got it' });
const dot = (p: Page) => p.locator('.sc-help-btn .sc-upd-dot');
const menuTrigger = (p: Page) => p.locator('.sc-help-btn');
const heading = (p: Page) => p.locator('#sc-wn-title');
const decoded = (img: Locator) =>
  img.evaluate((el) => (el as HTMLImageElement).complete && (el as HTMLImageElement).naturalWidth > 0);
const onPage = (u: URL) => u.pathname === PAGE && !u.searchParams.has('whatsnew');
const onHome = (u: URL) => u.pathname === HOME && !u.searchParams.has('whatsnew');

/** The words a sighted person reads in an element: everything but the visually hidden. */
const visibleText = (el: Locator) =>
  el.evaluate((root) => {
    const out: string[] = [];
    const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      if (!n.parentElement?.closest('.sc-vh')) out.push(n.textContent ?? '');
    }
    return out.join('').replace(/\s+/g, ' ').trim();
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
  expect(await visibleText(tag), `the tag for ${version} shows more than its version`).toBe(version);
}

/**
 * The version this computer runs, lit, exactly once in the dialog: on the
 * update itself when it is that version, in the head when the update is an
 * earlier one, and nowhere on a build that has no version (0.0.0).
 */
async function expectRunning(p: Page, shown: string, running: string | null): Promise<void> {
  if (running && shown !== running) await expectTag(headTag(p), running, true);
  else await expect(headTag(p)).toHaveCount(0);
  await expect(dialog(p).locator('.sc-wn-chip[data-on]')).toHaveCount(running ? 1 : 0);
}

/** The update's own picture on the stage, with its version tag on the date line. */
async function expectPicture(p: Page, pic: Picture, version: string, running: string | null): Promise<void> {
  await expect(stage(p)).toHaveCount(1);
  await expect(stage(p)).not.toHaveClass(/\bsc-wn-fallback\b/);
  expect(await stage(p).evaluate((el) => el.tagName)).toBe('DIV');
  const img = stage(p).locator('img');
  await expect(img).toHaveCount(1);
  await expect(img).toHaveAttribute('alt', pic.alt);
  await expect(img).toHaveAttribute('src', builtFile(pic));
  await expect(img).toHaveAttribute('loading', 'eager');
  await expect.poll(() => decoded(img)).toBe(true);
  await expect(stage(p)).toHaveAttribute('data-ready');
  await expect(excerpt(p).getByRole('img', { name: pic.alt })).toHaveCount(1);
  await expectTag(meta(p).locator('.sc-wn-chip'), version, version === running);
  await expectRunning(p, version, running);
}

/**
 * The artwork that stands in for a picture: decorative (no words for a screen
 * reader), never a link of its own, and it wears the release's version, which
 * the date line then leaves out, so the version is said once.
 */
async function expectFallback(p: Page, version: string, running: string | null): Promise<void> {
  const art = stage(p);
  await expect(art).toHaveCount(1);
  await expect(art).toHaveClass(/\bsc-wn-fallback\b/);
  await expect(art).toHaveAttribute('data-ready');
  expect(await art.evaluate((el) => el.tagName)).toBe('DIV');
  const img = art.locator('img');
  await expect(img).toHaveCount(1);
  await expect(img).toHaveAttribute('alt', '');
  await expect(img).toHaveAttribute('src', FALLBACK_SRC);
  await expect.poll(() => decoded(img)).toBe(true);
  await expect(excerpt(p).getByRole('img')).toHaveCount(0);
  await expectTag(
    art.locator('span.sc-wn-fallback-chip[data-theme="dark"] > .sc-wn-chip'),
    version,
    version === running,
  );
  await expect(excerpt(p).locator('.sc-wn-chip')).toHaveCount(1);
  await expect(meta(p).locator('.sc-wn-chip')).toHaveCount(0);
  await expectRunning(p, version, running);
}

/**
 * Wait for the dialog to finish arriving before measuring or pressing it. Its
 * entry animation fills both ways, so at rest the card holds an identity
 * matrix rather than `none`, and the harness's `arrived` (made for surfaces
 * that fill backwards) would wait on it forever: wait for the card's own
 * animation to finish instead.
 */
async function settled(p: Page): Promise<void> {
  const card = dialog(p);
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

/** The centre of an element, in whole pixels: Chromium ignores a press at fractional coordinates. */
async function centre(el: Locator): Promise<{ x: number; y: number }> {
  const b = await el.boundingBox();
  if (!b) throw new Error('nothing to press: the element has no box');
  return { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) };
}

/** A press at an element's centre, on whatever is on top there. */
async function pressAt(page: Page, el: Locator): Promise<void> {
  const { x, y } = await centre(el);
  await page.mouse.click(x, y);
}

/** What a press at an element's centre lands on: the link stretched over the excerpt covers it all. */
async function pressLandsOn(page: Page, el: Locator): Promise<string> {
  const { x, y } = await centre(el);
  return page.evaluate(
    ([px, py]) => {
      const hit = document.elementFromPoint(px, py);
      return hit ? `${hit.tagName.toLowerCase()}.${[...hit.classList].join('.')}` : 'nothing';
    },
    [x, y] as const,
  );
}

/**
 * Whether a release's row has been brought to the top of the pane the page
 * scrolls in. The pane has to have moved for it: the row is not the first.
 */
const atTopOfPane = (p: Page, version: string) =>
  p.evaluate((id) => {
    const row = document.getElementById(id);
    const pane = document.querySelector('.sc-wn-page')?.parentElement;
    if (!row || !pane) return false;
    return Math.abs(row.getBoundingClientRect().top - pane.getBoundingClientRect().top) <= 1 && pane.scrollTop > 0;
  }, `v${version}`);

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

/** The excerpt as the pointer sees it: its stage's light, its headline's underline, and where things are. */
const excerptLook = (p: Page) =>
  excerpt(p).evaluate((ex) => {
    const media = ex.querySelector('.sc-wn-media') as HTMLElement;
    const img = media.querySelector('img') as HTMLImageElement;
    const link = ex.querySelector('.sc-wn-ex-link') as HTMLElement;
    const box = (el: Element) => {
      const r = el.getBoundingClientRect();
      return [r.x, r.y, r.width, r.height].map((n) => Math.round(n * 2) / 2);
    };
    return {
      filter: getComputedStyle(media).filter,
      underline: getComputedStyle(link).textDecorationLine,
      transform: getComputedStyle(img).transform,
      opacity: getComputedStyle(img).opacity,
      stage: box(media),
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

test('a headline already read says nothing: no dialog, no dot', async ({ page }) => {
  const acked = await serve(page, [HEADLINE], '9.9.9', '9.9.9');
  await page.goto(HOME);
  await expect(page.locator('.sc-greet')).toBeVisible();
  await page.waitForTimeout(OUTWAIT_MS);
  await expect(dialog(page)).toHaveCount(0);
  await expect(dot(page)).toHaveCount(0);
  expect(acked).toEqual([]);
});

// ---- Flow A: a headline, introduced once ------------------------------------------

test('a headline update introduces itself once the screen is quiet, as an excerpt of itself, and Got it reads it for good', async ({
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

  // behind the app's darker dim, and nothing blurred
  const scrim = page.locator('.sc-newdlg-scrim');
  await expect(scrim).toHaveCount(1);
  await expect(scrim).toHaveAttribute('data-tone', 'dim');
  expect(await scrimLook(scrim)).toEqual({ background: 'var(--sc-scrim)', blur: 'none' });

  // the body is the excerpt, and the excerpt leads with the update's own picture
  await expect(dialog(page).locator('.sc-newdlg-body > *')).toHaveCount(1);
  await expect(excerpt(page)).toHaveCount(1);
  await expect(excerpt(page).locator(':scope > :first-child')).toHaveClass(/\bsc-wn-media\b/);
  // then when, and the version this computer runs, lit; then the headline, the link to that release
  await expectPicture(page, PIC_A, '9.9.9', '9.9.9');
  await expect(meta(page).locator('time')).toHaveAttribute('datetime', '2026-08-16');
  await expect(meta(page).locator('time')).toHaveText('16 August 2026');
  await expect(excerptLink(page)).toHaveText(HEADLINE.title as string);
  await expect(excerptLink(page)).toHaveAttribute('href', `${PAGE}#v9.9.9`);

  // and nothing else: no areas, no lines, no release notes, nothing else to press
  await expect(excerpt(page).locator('a, button, [tabindex]:not([tabindex="-1"])')).toHaveCount(1);
  await expect(
    dialog(page).locator('ul, ol, li, .sc-wn-areas, .sc-wn-area, .sc-wn-notes, .sc-wn-open, .sc-wn-lb'),
  ).toHaveCount(0);
  await expect(dialog(page).getByRole('link', { name: /Release notes/ })).toHaveCount(0);
  for (const s of HEADLINE.sections) await expect(dialog(page)).not.toContainText(s.body);
  await expect(page.locator('[role="dialog"]')).toHaveCount(1);

  // the only update waiting is the one on screen
  await expect(footLink(page)).toHaveText('See all updates');
  await expect(footLink(page)).toHaveAttribute('href', PAGE);

  await gotIt(page).click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(page).toHaveURL(onHome);
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

/** Every way out of a real showing, besides Got it and the links; each one is the acknowledgement. */
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
    await expect(page).toHaveURL(onHome);
    await expect.poll(() => acked).toEqual(['9.9.9']);
    await expect(dot(page)).toHaveCount(0);
    await page.waitForTimeout(OUTWAIT_MS);
    await expect(dialog(page)).toHaveCount(0);
    expect(acked).toEqual(['9.9.9']);
  });
}

// ---- the excerpt: one link, one stop for the keyboard -----------------------------

test('the excerpt is one link and one stop: the X, the excerpt, the foot link, Got it, and round again', async ({
  page,
}) => {
  const acked = await serve(page, [HEADLINE, small('9.9.8', 'A small update since')], '9.9.9', '9.9.7');
  await page.goto(HOME);
  await expect(dialog(page)).toBeVisible({ timeout: 8000 });
  await settled(page);

  // DialogSheet aims focus at the Radix Content, which is the element that
  // carries role="dialog", the accessible name and the focus trap. `.sc-wn` is
  // the card painted inside it, so the surface that takes focus is the one
  // holding the card, and it shows no ring.
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

  // the link is stretched over the whole excerpt: the picture and the date are it too
  await expect(stage(page).locator('img')).toHaveCount(1);
  expect(await pressLandsOn(page, stage(page))).toBe('a.sc-wn-ex-link');
  expect(await pressLandsOn(page, meta(page))).toBe('a.sc-wn-ex-link');
  expect(await pressLandsOn(page, excerptLink(page))).toBe('a.sc-wn-ex-link');

  const stop = () =>
    page.evaluate(() => {
      const el = document.activeElement;
      if (!el?.closest('.sc-wn')) return 'ESCAPED';
      return el.getAttribute('aria-label') ?? el.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    });
  const stops: string[] = [];
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press('Tab');
    stops.push(await stop());
  }
  expect(stops).toEqual(['Close', HEADLINE.title, 'See 1 more update', 'Got it', 'Close']);

  // on round to Got it, and Enter on it
  for (let i = 0; i < 3; i++) await page.keyboard.press('Tab');
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

test('under the pointer the excerpt lifts its picture and underlines its headline; nothing moves, darkens or appears', async ({
  page,
}) => {
  const acked = await serve(page, [HEADLINE], '9.9.9', '9.9.9');
  await page.goto(`${HOME}?whatsnew=preview`);
  await expect(dialog(page)).toBeVisible();
  await settled(page);
  await expect.poll(() => decoded(stage(page).locator('img'))).toBe(true);
  await expect(stage(page)).toHaveAttribute('data-ready');
  await page.mouse.move(2, 2);
  // the picture has finished fading in before anything is compared with it
  await expect.poll(async () => (await excerptLook(page)).opacity).toBe('1');
  const rest = await excerptLook(page);
  expect(rest).toMatchObject({ filter: 'none', underline: 'none', transform: 'none', opacity: '1' });

  // the whole excerpt is the target: the pointer on the date lifts the picture too
  const onDate = await centre(meta(page));
  const sampling = brightnessOver(stage(page), 700);
  await page.mouse.move(onDate.x, onDate.y);
  const samples = await sampling;
  expect(Math.min(...samples), `the stage darkened on its way: ${samples.join(', ')}`).toBeGreaterThanOrEqual(1);
  await expect.poll(async () => (await excerptLook(page)).filter).toBe(BRIGHTER);
  const hover = await excerptLook(page);
  expect(hover.underline).toBe('underline');
  // nothing grows, nothing moves, nothing fades
  expect(hover).toMatchObject({ transform: 'none', opacity: '1', stage: rest.stage, picture: rest.picture });
  // and no open-larger mark: the excerpt opens the page, not a lightbox
  await expect(dialog(page).locator('.sc-wn-open')).toHaveCount(0);

  // leaving, it settles back without passing below where it started
  const leaving = brightnessOver(stage(page), 700);
  await page.mouse.move(2, 2);
  expect(Math.min(...(await leaving))).toBeGreaterThanOrEqual(1);
  await expect.poll(async () => (await excerptLook(page)).filter).toBe('none');
  expect((await excerptLook(page)).underline).toBe('none');
  expect(acked).toEqual([]);
});

/**
 * The three places to press on the excerpt. A locator click on the picture
 * or the date would fail Playwright's actionability check (the link's
 * stretched layer is what is under the pointer there, which is the point), so
 * those are pressed at their centres.
 */
const INTO_THE_PAGE: ReadonlyArray<readonly [string, (p: Page) => Promise<unknown>]> = [
  ['its picture', (p) => pressAt(p, stage(p))],
  ['its date', (p) => pressAt(p, meta(p))],
  ['its headline', (p) => excerptLink(p).click()],
];

for (const [what, press] of INTO_THE_PAGE) {
  test(`pressing ${what} closes it, reads it once, and lands on that release at the top of the page`, async ({
    page,
  }) => {
    const acked = await serve(page, LINKED, '9.9.9', '9.9.5');
    await page.goto(HOME);
    await expect(dialog(page)).toBeVisible({ timeout: 8000 });
    await settled(page);
    // the newest headline, which is not the version running, with three more updates waiting
    await expect(excerptLink(page)).toHaveText('The headline the dialog introduces');
    await expect(excerptLink(page)).toHaveAttribute('href', `${PAGE}#v9.9.8`);
    await expectPicture(page, PIC_A, '9.9.8', '9.9.9');
    await expect(footLink(page)).toHaveText('See 3 more updates');

    await press(page);
    await expect(page).toHaveURL((u) => onPage(u) && u.hash === '#v9.9.8');
    await expect(dialog(page)).toHaveCount(0);
    // the keyboard goes to the page's name, not back to whatever the dialog opened over
    await expect(heading(page)).toBeFocused();
    // and the release it named is at the top of the pane, not merely somewhere on the page
    await expect.poll(() => atTopOfPane(page, '9.9.8')).toBe(true);
    await expect(page.locator('[id="v9.9.8"] h2.sc-wn-row-hed')).toHaveText('The headline the dialog introduces');
    // and the page agrees with the dialog's head about where this computer is
    await expect(page.locator('.sc-wn-chip[data-on]')).toHaveCount(1);
    await expectTag(page.locator('[id="v9.9.9"] .sc-wn-side .sc-wn-chip'), '9.9.9', true);

    // Leaving by the link closes the dialog and opens the page in one step, and
    // both read everything: that is one acknowledgement, not one each.
    await expect.poll(() => acked.length).toBeGreaterThan(0);
    await page.waitForTimeout(OUTWAIT_MS);
    expect(acked, `pressing ${what} acknowledged 9.9.9 more than once`).toEqual(['9.9.9']);
    await expect(dot(page)).toHaveCount(0);

    // the link replaced the dialog's entry: Back is the page it opened over, and it stays quiet
    await page.goBack();
    await expect(page).toHaveURL(onHome);
    await page.waitForTimeout(OUTWAIT_MS);
    await expect(dialog(page)).toHaveCount(0);
    expect(acked).toEqual(['9.9.9']);
  });
}

test('a modified press opens the release elsewhere and leaves the dialog open and unread', async ({ page }) => {
  const acked = await serve(page, LINKED, '9.9.9', '9.9.5');
  // whatever the browser opens for the modified press is not this test's page
  page.context().on('page', (other) => void other.close());
  await page.goto(HOME);
  await expect(dialog(page)).toBeVisible({ timeout: 8000 });
  await settled(page);

  // Nothing in the app may claim a modified press: it belongs to the browser,
  // which opens the link elsewhere. Headless Chromium does not always report
  // that tab, so what is asserted is that nothing took the press away.
  await page.evaluate(() => {
    window.addEventListener('click', (e) => {
      (window as unknown as { e2eClaimed?: boolean }).e2eClaimed = e.defaultPrevented;
    });
  });
  await excerptLink(page).click({ modifiers: ['ControlOrMeta'] });
  expect(await page.evaluate(() => (window as unknown as { e2eClaimed?: boolean }).e2eClaimed)).toBe(false);

  await page.waitForTimeout(OUTWAIT_MS);
  await expect(dialog(page)).toBeVisible();
  await expect(page).toHaveURL((u) => u.pathname === HOME && u.searchParams.get('whatsnew') === '9.9.8');
  expect(acked).toEqual([]);

  // it is still a real showing: its own ways out still read it, once
  await gotIt(page).click();
  await expect(dialog(page)).toHaveCount(0);
  await expect.poll(() => acked).toEqual(['9.9.9']);
});

// ---- an update with no picture of its own -------------------------------------------

test('an update with no picture introduces itself on the artwork, wearing its version, and its page row is words alone', async ({
  page,
}) => {
  const acked = await serve(page, WORDS, '9.9.9', '9.9.8');
  await page.goto(HOME);
  await expect(dialog(page)).toBeVisible({ timeout: 8000 });
  await settled(page);
  await expect(page.getByRole('dialog')).toHaveAccessibleDescription('A headline without a picture');

  // the artwork, not a picture of the release: the version this computer runs, lit, on it
  await expectFallback(page, '9.9.9', '9.9.9');
  await expect(meta(page).locator('time')).toHaveText('10 August 2026');
  await expect(excerptLink(page)).toHaveText('A headline without a picture');
  // it is part of the one link, and opens nothing of its own
  expect(await pressLandsOn(page, stage(page))).toBe('a.sc-wn-ex-link');
  await expect(excerpt(page).locator('a, button, [tabindex]:not([tabindex="-1"])')).toHaveCount(1);
  await expect(dialog(page).locator('.sc-wn-open, .sc-wn-lb')).toHaveCount(0);

  // pressing it lands on the release, which the page shows as words, with no stage and no artwork
  await pressAt(page, stage(page));
  await expect(page).toHaveURL((u) => onPage(u) && u.hash === '#v9.9.9');
  await expect(heading(page)).toBeFocused();
  const row = page.locator('[id="v9.9.9"]');
  await expect(row.locator('h2.sc-wn-row-hed')).toHaveText('A headline without a picture');
  await expect(row.locator('.sc-wn-area h3')).toHaveText(['Create', 'Fixes']);
  await expect(row.locator('.sc-wn-area p')).toHaveText([
    'Prompts keep their chips when you paste them.',
    'Mobile layout stability.',
  ]);
  await expect(row.locator('.sc-wn-media, img')).toHaveCount(0);
  // the title, then straight to what each area changed
  await expect(row.locator('.sc-wn-what > .sc-wn-row-hed + .sc-wn-areas')).toHaveCount(1);
  await expectTag(row.locator('.sc-wn-side .sc-wn-chip'), '9.9.9', true);
  await expect(page.locator('.sc-wn-fallback')).toHaveCount(0);
  await expect.poll(() => acked).toEqual(['9.9.9']);
});

// ---- tiers, counts and quiet moments -------------------------------------------------

test('a small update never opens anything, even with a title and a picture: Help carries it, and the page reads it', async ({
  page,
}) => {
  const records = [
    small('9.9.9', 'A small update with a picture', [
      { heading: 'Fixes', body: 'Selected scenes keep their tick when the wall reloads.', image: PIC_B },
    ]),
    headline('9.9.8', 'The headline already read'),
  ];
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
  // its row on the page carries its title and its picture
  const small99 = page.locator('[id="v9.9.9"]');
  await expect(small99.locator('h2.sc-wn-row-hed')).toHaveText('A small update with a picture');
  await expect(small99.locator('button.sc-wn-media img')).toHaveAttribute('alt', PIC_B.alt);

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

test('after several updates it leads with the newest headline, and See N more updates counts the rest and leads to them', async ({
  page,
}) => {
  const records = [HEADLINE, small('9.9.8', 'A small update between'), headline('9.9.7', 'An earlier headline')];
  const acked = await serve(page, records, '9.9.9', '9.9.6');
  await page.goto(HOME);
  await expect(dialog(page)).toBeVisible({ timeout: 8000 });
  await expect(excerptLink(page)).toHaveText(HEADLINE.title as string);
  await expect(footLink(page)).toHaveText('See 2 more updates');

  await footLink(page).click();
  await expect(page).toHaveURL((u) => onPage(u) && u.hash === '');
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
  await expect(page).toHaveURL(onHome);
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

// ---- the preview: the dialog as it introduces itself, reading nothing ----------

test('a preview on a fresh home opens the newest headline, and neither closing it nor following it writes anything', async ({
  page,
}) => {
  // the real server: this file's home is fresh, so everything is read already
  const posted = watchSeen(page);
  const notes = await realNotes(page);
  const featured = notes.recent.find((r) => r.announce) as Rec;
  expect(featured, 'the real history has no headline update to preview').toBeTruthy();

  await page.goto(`${HOME}?whatsnew=preview`);
  await expect(dialog(page)).toBeVisible();
  await expect(excerptLink(page)).toHaveText(featured.title as string);
  await expect(excerptLink(page)).toHaveAttribute('href', `${PAGE}#v${featured.version}`);
  await expect(excerpt(page)).toContainText(featured.version);
  await gotIt(page).click();
  await expect(dialog(page)).toHaveCount(0);

  for (const close of [
    (p: Page) => p.keyboard.press('Escape'),
    (p: Page) => p.goBack(),
    (p: Page) => gotIt(p).click(),
  ]) {
    await openByAddress(page, 'preview');
    await expect(dialog(page)).toBeVisible();
    await expect(excerptLink(page)).toHaveText(featured.title as string);
    await close(page);
    await expect(dialog(page)).toHaveCount(0);
    await expect(page).toHaveURL(onHome);
  }

  // its link leads where a real showing's does
  await openByAddress(page, 'preview');
  await expect(dialog(page)).toBeVisible();
  await excerptLink(page).click();
  await expect(page).toHaveURL((u) => onPage(u) && u.hash === `#v${featured.version}`);
  await expect(dialog(page)).toHaveCount(0);
  await expect(heading(page)).toBeFocused();

  await page.waitForTimeout(OUTWAIT_MS);
  expect(posted, 'a preview acknowledged something').toEqual([]);
  const after = await realNotes(page);
  expect(after.seen).toBe(notes.seen);
});

test('a preview reads nothing even with something unread: the dot stays, and it opens again and again', async ({
  page,
}) => {
  // A small update unread and the headline before it read: nothing opens by
  // itself, but anything that acknowledged would have something to write.
  const records = [
    small('9.9.9', 'A small update since'),
    headline('9.9.8', 'The headline to preview', [HEADLINE.sections[0]]),
  ];
  const acked = await serve(page, records, '9.9.9', '9.9.8');
  await page.goto(HOME);
  await expect(page.locator('.sc-greet')).toBeVisible();
  await expect(dot(page)).toBeVisible();

  const WAYS: ReadonlyArray<readonly [string, (p: Page) => Promise<unknown>]> = [
    ['Got it', (p) => gotIt(p).click()],
    ...WAYS_OUT,
  ];
  for (const [way, close] of WAYS) {
    await openByAddress(page, 'preview');
    await expect(dialog(page), `the preview did not open before ${way}`).toBeVisible();
    await expect(excerptLink(page)).toHaveText('The headline to preview');
    await expect(stage(page).locator('img')).toHaveAttribute('alt', PIC_A.alt);
    await close(page);
    await expect(dialog(page), `${way} did not close the preview`).toHaveCount(0);
    await expect(page).toHaveURL(onHome);
    expect(acked, `closing the preview by ${way} acknowledged it`).toEqual([]);
  }
  await page.waitForTimeout(OUTWAIT_MS);
  expect(acked).toEqual([]);
  await expect(dot(page)).toBeVisible();
  await expect(dialog(page)).toHaveCount(0);
});

/**
 * What `?whatsnew=preview:<version>` shows for WORDS running 9.9.9: any
 * recent update it names, headline or small, with its picture or on the
 * artwork; and the newest headline when it names nothing it can show.
 */
const PREVIEWS: ReadonlyArray<readonly [asked: string, shows: string]> = [
  ['9.9.8', '9.9.8'],
  ['9.9.7', '9.9.7'],
  ['9.9.6', '9.9.6'],
  ['1.2.3', '9.9.9'],
];

test('a preview shows any recent update it names, on its picture or on the artwork with its own version', async ({
  page,
}) => {
  const acked = await serve(page, WORDS, '9.9.9', '9.9.9');
  for (const [asked, shows] of PREVIEWS) {
    const rec = WORDS.find((r) => r.version === shows) as Rec;
    const pic = rec.sections.find((s) => s.image)?.image;
    await page.goto(`${HOME}?whatsnew=preview:${asked}`);
    await expect(dialog(page), `preview:${asked}`).toBeVisible();
    await expect(excerptLink(page)).toHaveText(rec.title as string);
    await expect(excerptLink(page)).toHaveAttribute('href', `${PAGE}#v${shows}`);
    if (pic) await expectPicture(page, pic, shows, '9.9.9');
    else await expectFallback(page, shows, '9.9.9');
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toHaveCount(0);
  }
  await page.waitForTimeout(OUTWAIT_MS);
  expect(acked).toEqual([]);
});

test('a preview of an earlier headline in the real history shows it, and this build offers no preview in Help', async ({
  page,
}) => {
  const posted = watchSeen(page);
  const notes = await realNotes(page);
  const headlines = notes.recent.filter((r) => r.announce);
  expect(headlines.length, 'the real history has no earlier headline to preview').toBeGreaterThan(1);
  const earlier = headlines[1];

  await page.goto(`${HOME}?whatsnew=preview:${earlier.version}`);
  await expect(dialog(page)).toBeVisible();
  await expect(excerptLink(page)).toHaveText(earlier.title as string);
  await expect(excerptLink(page)).toHaveAttribute('href', `${PAGE}#v${earlier.version}`);
  const pic = earlier.sections.find((s) => s.image)?.image;
  if (pic) {
    await expect(stage(page).locator('img')).toHaveAttribute('alt', pic.alt);
    await expect.poll(() => decoded(stage(page).locator('img'))).toBe(true);
    await expectTag(meta(page).locator('.sc-wn-chip'), earlier.version, earlier.version === notes.version);
    await expectRunning(page, earlier.version, notes.version);
  } else {
    await expectFallback(page, earlier.version, notes.version);
  }
  await page.keyboard.press('Escape');
  await expect(dialog(page)).toHaveCount(0);

  // the preview is a development build's Help row; this is the production bundle
  await menuTrigger(page).click();
  await expect(page.locator('.sc-help-menu [role="menuitem"]', { hasText: "What's new" })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: /Preview What's New/i })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(OUTWAIT_MS);
  expect(posted).toEqual([]);
});

test('0.19.1 has no picture: its page row is words alone, and a preview of it shows the artwork and its chip', async ({
  page,
}) => {
  // the real server and the real record
  const posted = watchSeen(page);
  const notes = await realNotes(page);
  const rec = notes.recent.find((r) => r.version === '0.19.1');
  test.skip(!rec, '0.19.1 has left the in-app window');
  expect(
    rec?.sections.some((s) => s.image),
    '0.19.1 carries a picture again',
  ).toBe(false);

  await page.goto(PAGE);
  const row = page.locator('[id="v0.19.1"]');
  await expect(row.locator('h2.sc-wn-row-hed')).toHaveText(rec?.title as string);
  await expect(row.locator('.sc-wn-media, img')).toHaveCount(0);
  await expect(row.locator('.sc-wn-what > .sc-wn-row-hed + .sc-wn-areas')).toHaveCount(1);
  await expect(row.locator('.sc-wn-area h3')).toHaveText((rec?.sections ?? []).map((s) => s.heading));
  await expectTag(row.locator('.sc-wn-side .sc-wn-chip'), '0.19.1', notes.version === '0.19.1');
  await expect(page.locator('.sc-wn-fallback')).toHaveCount(0);

  // while this computer runs 0.19.1 the artwork's tag is the lit one, and the head says nothing
  await page.goto(`${HOME}?whatsnew=preview:0.19.1`);
  await expect(dialog(page)).toBeVisible();
  await expect(excerptLink(page)).toHaveText(rec?.title as string);
  await expectFallback(page, '0.19.1', notes.version);
  await page.keyboard.press('Escape');
  await expect(dialog(page)).toHaveCount(0);
  await page.waitForTimeout(OUTWAIT_MS);
  expect(posted).toEqual([]);
});

// ---- when a picture cannot be shown, or there is nothing to show -------------------

test("a picture the build does not carry, or one that fails to load, falls back to the artwork with the release's own tag", async ({
  page,
}) => {
  // the picture the build does carry is made to fail on the way
  await page.route(builtFile(PIC_C), (route) => route.abort('failed'));
  const records = [
    headline('9.9.9', 'Its picture never shipped', [{ heading: 'Create', body: 'Better picks.', image: PIC_MISSING }]),
    headline('9.9.8', 'Its picture fails to load', [{ heading: 'Library', body: 'More of it.', image: PIC_C }]),
  ];
  const acked = await serve(page, records, '9.9.9', '9.9.9');

  // not in the build: the release has no picture to show, so the artwork stands in
  await page.goto(`${HOME}?whatsnew=preview:9.9.9`);
  await expect(dialog(page)).toBeVisible();
  await expect(excerptLink(page)).toHaveText('Its picture never shipped');
  await expectFallback(page, '9.9.9', '9.9.9');
  await expect(dialog(page).locator(`img[alt="${PIC_MISSING.alt}"]`)).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(dialog(page)).toHaveCount(0);

  // in the build but failing on the way: the artwork takes its place, wearing the
  // release's own tag, exactly as for a release with no picture, and nothing
  // broken or empty is left behind
  await page.goto(`${HOME}?whatsnew=preview:9.9.8`);
  await expect(dialog(page)).toBeVisible();
  await expect(excerptLink(page)).toHaveText('Its picture fails to load');
  await expectFallback(page, '9.9.8', '9.9.9');
  await expect(dialog(page).locator(`img[alt="${PIC_C.alt}"]`)).toHaveCount(0);
  await expect
    .poll(() =>
      dialog(page)
        .locator('img')
        .evaluateAll(
          (imgs) =>
            imgs.filter((i) => !(i as HTMLImageElement).complete || (i as HTMLImageElement).naturalWidth === 0).length,
        ),
    )
    .toBe(0);
  await expect(excerpt(page).locator('.sc-wn-media:not([data-ready])')).toHaveCount(0);
  await expect(meta(page).locator('time')).toHaveAttribute('datetime', '2026-08-10');
  // it is still the one link to that release
  expect(await pressLandsOn(page, stage(page))).toBe('a.sc-wn-ex-link');
  await page.keyboard.press('Escape');
  await expect(dialog(page)).toHaveCount(0);
  expect(acked).toEqual([]);
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
  await expect(dialog(page).locator('.sc-wn-ex, .sc-wn-hed, .sc-wn-media')).toHaveCount(0);
  await expect(dialog(page).locator('.sc-wn-link')).toHaveCount(0);
  await expect(gotIt(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog(page)).toHaveCount(0);
  expect(acked).toEqual([]);
});

test('a maintenance release with nothing new since says nothing of its own', async ({ page }) => {
  const records = [maintenance('9.9.9'), headline('9.9.8', 'The last headline'), small('9.9.7', 'A small one')];
  const acked = await serve(page, records, '9.9.9', '9.9.8');
  await page.goto(HOME);
  await expect(page.locator('.sc-greet')).toBeVisible();
  await page.waitForTimeout(OUTWAIT_MS);
  await expect(dialog(page)).toHaveCount(0);
  await expect(dot(page)).toHaveCount(0);

  // by address it still shows the newest headline in the history
  await page.goto(`${HOME}?whatsnew=1`);
  await expect(dialog(page)).toBeVisible();
  await expect(excerptLink(page)).toHaveText('The last headline');
  await expect(excerptLink(page)).toHaveAttribute('href', `${PAGE}#v9.9.8`);
  await expect(footLink(page)).toHaveText('See all updates');
  await page.keyboard.press('Escape');
  await expect(dialog(page)).toHaveCount(0);
  expect(acked).toEqual([]);
});

test('a development build opens nothing by itself, and has no version to light', async ({ page }) => {
  const acked = await serve(page, [HEADLINE, small('9.9.8', 'A small one')], '0.0.0', '0.0.0');
  await page.goto(HOME);
  await expect(page.locator('.sc-greet')).toBeVisible();
  await page.waitForTimeout(OUTWAIT_MS);
  await expect(dialog(page)).toHaveCount(0);
  await expect(dot(page)).toHaveCount(0);

  // by address it shows the newest headline, its tag plain, and nothing says which version you are on
  await page.goto(`${HOME}?whatsnew=1`);
  await expect(dialog(page)).toBeVisible();
  await expect(excerptLink(page)).toHaveText(HEADLINE.title as string);
  await expectPicture(page, PIC_A, '9.9.9', null);
  await expect(dialog(page)).not.toContainText('the version you are on');
  await page.keyboard.press('Escape');
  await expect(dialog(page)).toHaveCount(0);
  expect(acked).toEqual([]);
});

test('the dialog and the page agree on the version this computer runs', async ({ page }) => {
  // the real server: the newest headline and the version running, as they ship
  const posted = watchSeen(page);
  const notes = await realNotes(page);
  const featured = notes.recent.find((r) => r.announce) as Rec;

  await page.goto(`${HOME}?whatsnew=1`);
  await expect(dialog(page)).toBeVisible();
  await expect(excerptLink(page)).toHaveText(featured.title as string);
  // said once, lit: in the head when the headline is an earlier release, on the update when it is this one
  const lit = dialog(page).locator('.sc-wn-chip[data-on]');
  await expectTag(lit, notes.version, true);
  await expect(headTag(page)).toHaveCount(featured.version === notes.version ? 0 : 1);
  // "you are on" is spoken, never shown
  expect(await visibleText(dialog(page))).not.toMatch(/you are on/i);
  await page.keyboard.press('Escape');
  await expect(dialog(page)).toHaveCount(0);

  // the page lights the same version, on its own row, and no other
  await page.goto(PAGE);
  await expect(page.locator('.sc-wn-chip[data-on]')).toHaveCount(1);
  await expect(page.locator('li.sc-wn-row:has(.sc-wn-side .sc-wn-chip[data-on])')).toHaveAttribute(
    'id',
    `v${notes.version}`,
  );
  await expectTag(page.locator('.sc-wn-chip[data-on]'), notes.version, true);
  expect(await visibleText(page.locator('.sc-wn-page'))).not.toMatch(/you are on/i);
  await page.waitForTimeout(OUTWAIT_MS);
  expect(posted).toEqual([]);
});
