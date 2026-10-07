import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { hostname, platform, userInfo } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type APIRequestContext, expect, type Locator, type Page } from '@playwright/test';
import sharp from 'sharp';
import { settle } from '../visual/shared.js';

/**
 * Pictures for What's New: the real studio, checked for anything private, written as 1920 by 1080
 * WebP with alpha, so every picture sits on the stage (styles/surfaces/whatsnew.css) with the same
 * margins and the stage's soft shadow follows its shape. There are two kinds, chosen per release by
 * what changed:
 *
 * - **window** (`shootWindow`): the whole app in a 1920 by 1080 window (16:9), in the state that
 *   shows the change, with the window's rounded corners baked in as transparency. For a change that
 *   is a whole page or layout.
 * - **isolated** (`shootIsolated`): for a change that lives in one component or a small group. The
 *   real component, exactly as the app draws it (its own background, corners, border, shadow and
 *   text, at its real layout), lifted out of the page with nothing else: no page behind it, no
 *   frame, nothing added. It is isolated in the real page, never cut out of a screenshot: every
 *   element but the subjects stops painting and the window is shot on a transparent ground. Then it
 *   is set, centred and at a size that reads, on a transparent 1920 by 1080 canvas, and the stage
 *   paints the sky behind it. A group (cards and the bar that acts on them) keeps its real layout.
 *   Words and pictures with no box of their own (a question in a conversation, a page's heading)
 *   keep the ground they sit on in the app, as one panel with the app's own card corners, so they
 *   read as they do there and never take the sky's colour.
 *
 * This runs unattended on every release, so every rule a picture has to meet is a thrown error:
 * a wrong picture fails the capture, it never ships. Nothing private may ever show: the page is
 * scanned before every picture (assertClean), and the capture's own Scenri must hold only the
 * public brand it seeded (assertOnlySeeded).
 */
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const OUT = fileURLToPath(new URL('../src/assets/whatsnew/', import.meta.url));
const NAME = /^\d+\.\d+\.\d+-[a-z0-9]+(-[a-z0-9]+)*$/;
/** The made-up address and code Local access is stubbed with; nothing else of the kind may show. */
const FAKE_IP = '192.168.1.20';
const FAKE_CODE = ['305 918', '305918'];
const LEAKS = [
  /E2E/,
  /fixture/i,
  /sc-e2e/,
  /\/Users\//,
  /\/home\//,
  /\/var\/folders\//,
  /\/tmp\//,
  /\b[A-Za-z]:\\/,
  /localhost/i,
  /127\.0\.0\.1/,
  /tonygorb/i,
  /\bDemo\b/,
  /reference shot/i,
  /\bsk-[\w-]{6,}/,
  /\br8_\w{6,}/,
];
/** Anything shaped like an address someone could be reached at. */
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/;
/** A six-digit access code as Local access prints it (305 918) or as a link carries it (305918). */
const SIX_DIGITS = /(?<![\d#])\d{3}[ \u00a0\u2009\u202f]?\d{3}(?!\d)/g;
/** An id or a token: a UUID, or an unbroken run of 32 or more key characters. */
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;
const TOKEN = /[A-Za-z0-9_-]{32,}/;

/**
 * The names this computer and its account go by, read when the capture runs, never written down:
 * the account name, the host name and its short form, and on a Mac the name the computer shows on
 * the network. A name shorter than three characters would match ordinary words, and one that short
 * identifies no one.
 */
function machineNames(): string[] {
  const names = new Set<string>();
  const add = (n: string | undefined) => {
    const t = n?.trim();
    if (t && t.length >= 3) names.add(t);
  };
  try {
    add(userInfo().username);
  } catch {
    /* no account name to read */
  }
  add(hostname());
  add(hostname().split('.')[0]);
  if (platform() === 'darwin') {
    try {
      add(execFileSync('scutil', ['--get', 'ComputerName'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
    } catch {
      /* no computer name set */
    }
  }
  return [...names];
}
const MACHINE = machineNames().map(
  (n) => new RegExp(`(?<![\\w-])${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`, 'i'),
);

/** The brands this capture made, by name: its Scenri may hold nothing else. */
const SEEDED = new Set<string>();

/**
 * The one window every picture is taken in, CSS px, and the size of every file in output px. The
 * window is drawn at three device px to the CSS px (playwright.capture.config.ts), so a window is
 * downscaled into its file and an isolated component is never enlarged past what was captured.
 */
export const WINDOW = { width: 1920, height: 1080 };
/** A window's corners in the file: about 6 px on a 560 px thumbnail, about 15 in a 1400 px lightbox. */
const WINDOW_RADIUS = 20;
/**
 * Each kind's ceiling, KiB, and the qualities tried, best first. Measured on these captures: below
 * quality 84 small grey type starts to smear and dark gradients band. A wall of photographs is the
 * heaviest window this app gives (289 KiB); an isolated component is mostly transparent canvas (17
 * to 64 KiB), and a group of photographs, a row of cards, is the heaviest of those (149 KiB). The
 * same ceilings are held by packages/cli/test/releasePictures.test.ts.
 */
export const MAX_KIB = { window: 320, isolated: 160 } as const;
const QUALITIES = [90, 87, 84];

/** How an isolated picture is set on its canvas. CSS px unless named otherwise. */
const ISOLATED = {
  /** Every subject keeps this clear of each edge of the window, so none is cut by it. */
  clear: 16,
  /** Around the subjects for their own shadows, at the least; a longer shadow is measured and kept. */
  grow: 32,
  /** The picture fits inside this share of the canvas's width and of its height. */
  span: 0.78,
  /** Output px per CSS px at the most: the capture's own three, so nothing is ever upscaled. */
  most: 3,
  /** And spans at least one of these shares; smaller, it is too small to read alone. */
  least: { width: 0.42, height: 0.55 },
  /** The least share of each subject's box that must be painted once the rest is gone. */
  painted: 0.6,
  /** On a ground: the least share of a subject's box that must differ from the ground, so it drew. */
  drew: 0.005,
  /** The token whose radius a ground's corners take: the app's own card and dialog corner. */
  corner: '--sc-radius-xl',
};

type Kind = keyof typeof MAX_KIB;
type Box = { x: number; y: number; width: number; height: number };
/** How far a subject's own shadow reaches past each side of its box, CSS px. */
type Reach = { top: number; right: number; bottom: number; left: number };

/**
 * Nothing private and nothing of the test on the page: visible text, what the fields hold and
 * what their placeholders say. Each rule that matches is named with a masked excerpt of what it
 * matched, so the log never repeats a secret in full.
 */
async function assertClean(page: Page, allow: string[]): Promise<void> {
  let text = await page.evaluate(() =>
    [
      document.body.innerText,
      ...Array.from(document.querySelectorAll('input, textarea'), (el) => {
        const field = el as HTMLInputElement;
        return `${field.value}\n${field.placeholder ?? ''}`;
      }),
    ].join('\n'),
  );
  for (const a of allow) text = text.split(a).join('');
  const mask = (s: string) => (s.length <= 4 ? '****' : `${s.slice(0, 2)}${'*'.repeat(Math.min(8, s.length - 2))}`);
  const found: string[] = [];
  for (const re of LEAKS) {
    const m = text.match(re);
    if (m) found.push(`test or machine content ${re} ("${mask(m[0])}")`);
  }
  for (const ip of text.match(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g) ?? [])
    if (ip !== FAKE_IP) found.push(`an IP address other than the stub's ("${mask(ip)}")`);
  for (const re of MACHINE) {
    const m = text.match(re);
    if (m) found.push(`this computer's account or host name ("${mask(m[0])}")`);
  }
  const email = text.match(EMAIL);
  if (email) found.push(`an email address ("${mask(email[0])}")`);
  for (const code of text.match(SIX_DIGITS) ?? [])
    if (!FAKE_CODE.includes(code.replace(/[\u00a0\u2009\u202f]/g, ' ')))
      found.push(`a six-digit code other than the stub's ("${mask(code)}")`);
  const uuid = text.match(UUID);
  if (uuid) found.push(`an id ("${mask(uuid[0])}")`);
  const token = text.match(TOKEN);
  if (token) found.push(`a token-shaped run of ${token[0].length} characters ("${mask(token[0])}")`);
  expect(found, 'private or test content on the page').toEqual([]);
}

/**
 * The capture's own Scenri holds only the public brand it seeded. A library that holds anything else
 * is not the empty home this capture boots, and nothing in it may be photographed.
 */
async function assertOnlySeeded(page: Page, name: string): Promise<void> {
  if (SEEDED.size === 0) throw new Error(`${name}: no brand was seeded; seed the public brand with seedBrand`);
  const res = await page.request.get('/api/brands');
  expect(res.ok(), `${name}: GET /api/brands`).toBe(true);
  const brands = (await res.json()) as { json?: { meta?: { name?: unknown } } }[];
  const strange = brands.map((b) => String(b.json?.meta?.name ?? '')).filter((n) => !SEEDED.has(n));
  if (strange.length)
    throw new Error(
      `${name}: the capture's Scenri holds ${strange.length} brand${strange.length === 1 ? '' : 's'} it did not seed; this is not the empty home it boots, so nothing is shot`,
    );
}

/**
 * The pointer and the focus for the picture: left where the test put them (a hover state, or an
 * open menu that needs its focus), otherwise parked in the window's corner with the focus dropped,
 * so no hover or focus ring is left over.
 */
async function pose(page: Page, posed: boolean): Promise<void> {
  if (!posed) {
    const view = page.viewportSize() ?? WINDOW;
    await page.mouse.move(1, view.height - 1);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  }
  await page.waitForTimeout(250);
}

function begin(name: string): void {
  if (!NAME.test(name)) throw new Error(`${name}: not <version>-<words>`);
}

export type ShotOptions = {
  /** Strings this shot may show that the leak scan would otherwise refuse. */
  allow?: string[];
  /**
   * The test has put the pointer and the focus where the picture needs them (a hover state, or a
   * menu that closes when its focus goes): leave both. It parks the pointer clear of every subject.
   */
  posed?: boolean;
};

export type WindowOptions = ShotOptions & {
  /**
   * Things that must not be cut by the window's bottom edge, a row of cards for one: each ends
   * inside the window or starts below it.
   */
  checkBottom?: Locator;
};

export type IsolatedOptions = ShotOptions & {
  /**
   * CSS px of the ground the subjects sit on, kept round them, for subjects with no box of their
   * own (a question in a conversation is words and pictures on the rail; a page's heading is words
   * on the page). The ground is the colour they sit on in the app, as one panel behind all the
   * subjects, reaching this far past them on every side, with the app's card corners
   * (ISOLATED.corner). Measure it from the page: the padding the subjects already have there.
   */
  room?: number;
  /**
   * With `room`: the ground hugs what the subjects with no box of their own draw (their words and
   * chips), not their boxes, for a short line of words in a box much wider than them (a prompt's
   * line). Nothing moves and nothing is drawn differently; only the panel is cut to the words.
   */
  hug?: boolean;
};

/** Drawn, posed, clean, of the seeded brand only, and the one size; the capture's device pixel ratio. */
async function ready(page: Page, name: string, opts: ShotOptions): Promise<number> {
  await settle(page);
  // Pictures drawn as CSS backgrounds (a plate in a conversation) are not in document.images,
  // so settle does not wait for them: every one in the window is decoded before the picture.
  await page.evaluate(async () => {
    const urls = new Set<string>();
    for (const el of Array.from(document.body.querySelectorAll('*'))) {
      const r = el.getBoundingClientRect();
      if (r.bottom <= 0 || r.top >= window.innerHeight || r.right <= 0 || r.left >= window.innerWidth) continue;
      for (const m of getComputedStyle(el).backgroundImage.matchAll(/url\("?([^")]+)"?\)/g)) urls.add(m[1]);
    }
    await Promise.all(
      Array.from(urls, (src) => {
        const img = new Image();
        img.src = src;
        return img.decode();
      }),
    );
  });
  await pose(page, opts.posed ?? false);
  await assertOnlySeeded(page, name);
  await assertClean(page, opts.allow ?? []);
  const view = page.viewportSize() ?? WINDOW;
  if (view.width !== WINDOW.width || view.height !== WINDOW.height)
    throw new Error(
      `${name}: a ${view.width}x${view.height} window; every picture is ${WINDOW.width}x${WINDOW.height}`,
    );
  return page.evaluate(() => window.devicePixelRatio);
}

/**
 * A rail that runs off its edge (a row of tabs) must end between two of its items, never through
 * one, unless the app itself fades that edge. `within` limits the look to rails inside the subjects
 * of an isolated picture.
 */
async function assertRailsWhole(page: Page, name: string, within: string | null): Promise<void> {
  const cut = await page.evaluate((within) => {
    const found: string[] = [];
    for (const rail of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
      if (within && !rail.closest(within)) continue;
      if (!/auto|scroll/.test(getComputedStyle(rail).overflowX) || rail.scrollWidth <= rail.clientWidth + 1) continue;
      // The library's row of kinds says it keeps going with its own edge fade: an item under
      // that fade is the product's designed overflow, not a cut.
      if (rail.closest('[data-overflow-left], [data-overflow-right]')) continue;
      const r = rail.getBoundingClientRect();
      if (r.bottom <= 0 || r.top >= window.innerHeight || r.width === 0) continue;
      for (const item of Array.from(rail.children)) {
        const b = item.getBoundingClientRect();
        if (!b.width || getComputedStyle(item).position === 'absolute') continue;
        if ((b.left < r.left - 0.5 && b.right > r.left + 0.5) || (b.left < r.right - 0.5 && b.right > r.right + 0.5))
          found.push(`"${(item.textContent ?? '').trim().slice(0, 24)}" in .${Array.from(rail.classList).join('.')}`);
      }
    }
    return found;
  }, within);
  if (cut.length) throw new Error(`${name}: cut at a rail's edge: ${cut.join(', ')}`);
}

/** The window's own screenshot, checked to be the window at the capture's device pixel ratio. */
async function screenshot(page: Page, name: string, dpr: number, transparent: boolean): Promise<Buffer> {
  const png = await page.screenshot({ animations: 'disabled', caret: 'hide', omitBackground: transparent });
  const { width = 0, height = 0 } = await sharp(png).metadata();
  if (width !== Math.round(WINDOW.width * dpr) || height !== Math.round(WINDOW.height * dpr))
    throw new Error(`${name}: the capture is ${width}x${height}, not the window at ${dpr}x`);
  return png;
}

/** The whole window as it stands, nothing named cut by its bottom edge. */
export async function shootWindow(page: Page, name: string, opts: WindowOptions = {}): Promise<void> {
  begin(name);
  const dpr = await ready(page, name, opts);
  await assertRailsWhole(page, name, null);
  if (opts.checkBottom)
    for (const b of await Promise.all((await opts.checkBottom.all()).map((l) => l.boundingBox()))) {
      if (b && b.y < WINDOW.height - 0.5 && b.y + b.height > WINDOW.height + 0.5)
        throw new Error(
          `${name}: ${Math.round(b.width)}x${Math.round(b.height)} at ${Math.round(b.x)},${Math.round(b.y)} is cut by the window's bottom edge at ${WINDOW.height}`,
        );
    }
  const png = await screenshot(page, name, dpr, false);
  const frame = await sharp(png)
    .resize(WINDOW.width, WINDOW.height, { fit: 'fill', kernel: 'lanczos3' })
    .removeAlpha()
    .png()
    .toBuffer();
  // The window's rounded corners, as transparency.
  const corners = svg(
    WINDOW,
    `<rect width="${WINDOW.width}" height="${WINDOW.height}" rx="${WINDOW_RADIUS}" fill="#fff"/>`,
  );
  const shaped = await sharp(frame)
    .ensureAlpha()
    .composite([{ input: corners, blend: 'dest-in' }])
    .png()
    .toBuffer();
  await write(name, shaped, 'window', `window from ${dpr}x`);
}

/**
 * One component, or a small group of them, lifted out of the page as the app draws it.
 *
 * `subjects`: every element each locator matches is a subject. Each has to be visible and laid out,
 * whole inside the window `ISOLATED.clear` px clear of every edge with its own shadow inside it too,
 * clipped by no ancestor, and under no ancestor whose opacity, filter, mask or clip-path would change
 * how it looks; a subject inside another is refused. A subject whose own background lets the page
 * through (a translucent fill, or glass) is backed with what it sits on in the app, under exactly its
 * own box and corners, so it does not take the sky's colour. Subjects with no box of their own at
 * all need `opts.room`: one panel of the ground they sit on goes behind all the subjects (see
 * IsolatedOptions).
 *
 * Then, in the real page: every ancestor of a subject stops painting its own box (visibility hidden,
 * inline and important), each subject root paints again (visible), so their descendants keep their
 * own rules and a legitimately hidden child stays hidden; every other element that would still paint
 * is hidden; the root and body lose their backgrounds; and the window is shot on a transparent ground
 * at the capture's device scale. Everything is put back afterwards.
 *
 * The capture has to prove itself: outside the subjects (grown by room for their shadows) and their
 * ground every pixel is transparent, and each subject drew: most of its own box is painted, or on a
 * ground, some of it differs from the ground. It is cut to the subjects and their shadows, trimmed to
 * what is painted, and scaled to fit `ISOLATED.span` of the canvas, never past three output px per
 * CSS px, then centred (the ground, or the subjects' boxes, never their shadows) on a transparent
 * 1920x1080 canvas. Too small to read at that size, the capture says to isolate its whole panel or
 * a group.
 */
export async function shootIsolated(
  page: Page,
  name: string,
  subjects: Locator | Locator[],
  opts: IsolatedOptions = {},
): Promise<void> {
  begin(name);
  const room = opts.room ?? 0;
  if (!(room >= 0 && room <= 64))
    throw new Error(`${name}: room ${room} px; the ground kept round the subjects is 0 to 64`);
  const handles = (
    await Promise.all((Array.isArray(subjects) ? subjects : [subjects]).map((l) => l.elementHandles()))
  ).flat();
  if (handles.length === 0) throw new Error(`${name}: no subject on the page`);
  try {
    for (const [i, h] of handles.entries())
      await h.evaluate((el, i) => (el as Element).setAttribute('data-sc-shot', String(i)), i);
  } finally {
    await Promise.all(handles.map((h) => h.dispose()));
  }
  try {
    const dpr = await ready(page, name, opts);
    await assertRailsWhole(page, name, '[data-sc-shot]');
    const seen = await inspect(page, room);
    if (seen.subjects.length !== handles.length)
      seen.problems.push(`${handles.length} subjects were marked and ${seen.subjects.length} are still on the page`);
    const bare = seen.subjects.filter((s) => s.bare);
    if (room > 0 && bare.length === 0)
      seen.problems.push(`room is for subjects with no box of their own, and every subject here has one`);
    if (opts.hug && room === 0)
      seen.problems.push(`hug cuts the ground round the subjects, and there is no room of ground`);
    if (room === 0 && bare.length > 0)
      seen.problems.push(
        `${bare.map((s) => s.label).join(', ')} ${bare.length === 1 ? 'has' : 'have'} no box of ${bare.length === 1 ? 'its' : 'their'} own and would sit on the sky; give the room of ground ${bare.length === 1 ? 'it sits' : 'they sit'} on`,
      );
    if (seen.problems.length) throw new Error(`${name}: the subjects cannot be isolated: ${seen.problems.join('; ')}`);

    let png: Buffer;
    let made: Isolation;
    try {
      made = await page.evaluate(isolate, {
        room,
        back: seen.subjects.filter((s) => s.backed && !s.bare).map((s) => s.mark),
        bare: bare.map((s) => s.mark),
        corner: ISOLATED.corner,
        hug: opts.hug ?? false,
      });
      png = await screenshot(page, name, dpr, true);
    } finally {
      await page.evaluate(() => (window as unknown as { __scShotRestore?: () => void }).__scShotRestore?.());
    }

    const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const W = info.width;
    const H = info.height;
    const at = (x: number, y: number) => (y * W + x) * 4;
    const alphaAt = (x: number, y: number) => data[at(x, y) + 3];
    const px = (v: number) => Math.round(v * dpr);
    // What may be painted: each subject's box grown by the reach of its own shadow, at least
    // ISOLATED.grow, and the ground behind them.
    const rooms = seen.subjects.map(({ box, reach }) => {
      const g = (r: number) => Math.max(ISOLATED.grow, Math.ceil(r) + 1);
      return {
        left: Math.max(0, px(box.x - g(reach.left))),
        top: Math.max(0, px(box.y - g(reach.top))),
        right: Math.min(W, px(box.x + box.width + g(reach.right))),
        bottom: Math.min(H, px(box.y + box.height + g(reach.bottom))),
      };
    });
    if (made.ground) {
      const g = made.ground.rect;
      rooms.push({
        left: Math.max(0, px(g.x) - 1),
        top: Math.max(0, px(g.y) - 1),
        right: Math.min(W, px(g.x + g.width) + 1),
        bottom: Math.min(H, px(g.y + g.height) + 1),
      });
    }
    // Nothing else leaked: outside every room, not one pixel is painted.
    let stray = 0;
    const where = { left: W, top: H, right: 0, bottom: 0 };
    for (let y = 0; y < H; y++) {
      const open = rooms.filter((r) => y >= r.top && y < r.bottom);
      for (let x = 0; x < W; x++) {
        if (open.some((r) => x >= r.left && x < r.right) || alphaAt(x, y) === 0) continue;
        stray++;
        where.left = Math.min(where.left, x);
        where.top = Math.min(where.top, y);
        where.right = Math.max(where.right, x);
        where.bottom = Math.max(where.bottom, y);
      }
    }
    if (stray > 0)
      throw new Error(
        `${name}: ${stray} device px outside the subjects are painted, between ${Math.floor(where.left / dpr)},${Math.floor(where.top / dpr)} and ${Math.ceil(where.right / dpr)},${Math.ceil(where.bottom / dpr)} CSS px; something besides them still draws`,
      );
    // And each subject is there: most of its own box is painted, or on a ground, it drew on the
    // part of the ground under it (opaque, and not the ground's colour).
    for (const { box, label } of seen.subjects) {
      const ground = made.ground;
      const g = ground?.rect;
      const x0 = px(g ? Math.max(box.x, g.x) : box.x);
      const y0 = px(g ? Math.max(box.y, g.y) : box.y);
      const x1 = px(g ? Math.min(box.x + box.width, g.x + g.width) : box.x + box.width);
      const y1 = px(g ? Math.min(box.y + box.height, g.y + g.height) : box.y + box.height);
      if (x1 <= x0 || y1 <= y0) throw new Error(`${name}: ${label} is not on the ground put behind the subjects`);
      let hit = 0;
      for (let y = y0; y < y1; y++)
        for (let x = x0; x < x1; x++) {
          const i = at(x, y);
          if (!ground) hit += data[i + 3] > 0 ? 1 : 0;
          else
            hit +=
              data[i + 3] >= 250 &&
              Math.max(
                Math.abs(data[i] - ground.color[0]),
                Math.abs(data[i + 1] - ground.color[1]),
                Math.abs(data[i + 2] - ground.color[2]),
              ) > 10
                ? 1
                : 0;
        }
      const share = hit / ((x1 - x0) * (y1 - y0));
      if (ground ? share < ISOLATED.drew : share < ISOLATED.painted)
        throw new Error(
          `${name}: ${label} ${ground ? `differs from its ground in ${(share * 100).toFixed(2)}% of the ground under it` : `is only ${Math.round(share * 100)}% painted`} once isolated; it did not draw`,
        );
    }

    // The cut: every room, trimmed to what is painted.
    const cut = {
      left: Math.min(...rooms.map((r) => r.left)),
      top: Math.min(...rooms.map((r) => r.top)),
      right: Math.max(...rooms.map((r) => r.right)),
      bottom: Math.max(...rooms.map((r) => r.bottom)),
    };
    const trim = { left: cut.right, top: cut.bottom, right: cut.left, bottom: cut.top };
    for (let y = cut.top; y < cut.bottom; y++)
      for (let x = cut.left; x < cut.right; x++)
        if (alphaAt(x, y) > 0) {
          trim.left = Math.min(trim.left, x);
          trim.top = Math.min(trim.top, y);
          trim.right = Math.max(trim.right, x + 1);
          trim.bottom = Math.max(trim.bottom, y + 1);
        }
    const crop = { width: trim.right - trim.left, height: trim.bottom - trim.top };

    // The size: inside the span, never past the capture's own pixels, and big enough to read.
    const css = { width: crop.width / dpr, height: crop.height / dpr };
    const z = Math.min(
      (ISOLATED.span * WINDOW.width) / css.width,
      (ISOLATED.span * WINDOW.height) / css.height,
      Math.min(ISOLATED.most, dpr),
    );
    const size = { width: Math.round(css.width * z), height: Math.round(css.height * z) };
    if (size.width < ISOLATED.least.width * WINDOW.width && size.height < ISOLATED.least.height * WINDOW.height)
      throw new Error(
        `${name}: ${Math.round(css.width)}x${Math.round(css.height)} CSS px makes ${size.width}x${size.height} at ${z.toFixed(2)}x, under ${ISOLATED.least.width * 100}% of the width and ${ISOLATED.least.height * 100}% of the height: too small to read alone; isolate its whole panel or a group`,
      );
    const piece = await sharp(png)
      .extract({ left: trim.left, top: trim.top, width: crop.width, height: crop.height })
      .resize(size.width, size.height, { fit: 'fill', kernel: 'lanczos3' })
      .png()
      .toBuffer();

    // Centred on the ground, or on the subjects' own boxes, so a shadow falling below does not lift
    // them off centre.
    const g = made.ground?.rect;
    const union = g
      ? { left: g.x, top: g.y, right: g.x + g.width, bottom: g.y + g.height }
      : {
          left: Math.min(...seen.subjects.map((s) => s.box.x)),
          top: Math.min(...seen.subjects.map((s) => s.box.y)),
          right: Math.max(...seen.subjects.map((s) => s.box.x + s.box.width)),
          bottom: Math.max(...seen.subjects.map((s) => s.box.y + s.box.height)),
        };
    const scale = z / dpr;
    const clamp = (v: number, hi: number) => Math.min(Math.max(v, 0), hi);
    const left = Math.round(
      clamp(WINDOW.width / 2 - (((union.left + union.right) / 2) * dpr - trim.left) * scale, WINDOW.width - size.width),
    );
    const top = Math.round(
      clamp(
        WINDOW.height / 2 - (((union.top + union.bottom) / 2) * dpr - trim.top) * scale,
        WINDOW.height - size.height,
      ),
    );
    const frame = await sharp({
      create: { width: WINDOW.width, height: WINDOW.height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .composite([{ input: piece, left, top }])
      .png()
      .toBuffer();
    const how = [
      `${seen.subjects.length} subject${seen.subjects.length === 1 ? '' : 's'}, ${Math.round(css.width)}x${Math.round(css.height)} CSS px with their shadows, ${z.toFixed(2)}x to ${size.width}x${size.height} at ${left},${top}`,
      ...(made.backed.length ? [`backed ${made.backed.join(', ')}`] : []),
      ...(made.ground ? [`on ${made.ground.label}`] : []),
    ];
    await write(name, frame, 'isolated', `isolated from ${dpr}x: ${how.join('; ')}`);
  } finally {
    await page.evaluate(() => {
      for (const el of Array.from(document.querySelectorAll('[data-sc-shot]'))) el.removeAttribute('data-sc-shot');
    });
  }
}

/**
 * The marked subjects, measured and checked against every rule an isolated picture has to meet, in
 * the page as it stands. `backed`: its own fill lets the page through, so it is backed with what it
 * sits on. `bare`: it has no box of its own at all (no fill, picture, border or shadow), so it needs
 * the room of ground it sits on, which counts as its own reach.
 */
function inspect(page: Page, room: number) {
  return page.evaluate(
    ({ rules, room }) => {
      const problems: string[] = [];
      const describe = (el: Element) =>
        `<${el.tagName.toLowerCase()} class="${(el.getAttribute('class') ?? '').trim()}"${el.getAttribute('aria-label') ? ` aria-label="${el.getAttribute('aria-label')}"` : ''}>`;
      /** A computed colour's alpha, 0..1. */
      const alpha = (color: string) => {
        if (color === 'transparent') return 0;
        const a =
          color.match(/^rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+%?)\)$/)?.[1] ?? color.match(/\/\s*([\d.]+%?)\s*\)$/)?.[1];
        if (a === undefined) return 1;
        return a.endsWith('%') ? Number.parseFloat(a) / 100 : Number.parseFloat(a);
      };
      const all = Array.from(document.querySelectorAll<HTMLElement>('[data-sc-shot]'));
      const subjects = all.map((el) => {
        const label = describe(el);
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        if (all.some((other) => other !== el && other.contains(el)))
          problems.push(`${label} is inside another subject`);
        if (!el.checkVisibility({ visibilityProperty: true, opacityProperty: true }))
          problems.push(`${label} is not visible`);
        if (r.width < 1 || r.height < 1) problems.push(`${label} did not lay out (${r.width}x${r.height})`);
        if (Number(cs.opacity) < 1) problems.push(`${label} is see-through (opacity ${cs.opacity})`);

        const fill = alpha(cs.backgroundColor);
        const glass = cs.backdropFilter !== 'none';
        const backed = fill < 1 || glass;
        const border = ['top', 'right', 'bottom', 'left'].some(
          (side) =>
            Number.parseFloat(cs.getPropertyValue(`border-${side}-width`)) > 0 &&
            alpha(cs.getPropertyValue(`border-${side}-color`)) > 0,
        );
        const bare = fill === 0 && !glass && cs.backgroundImage === 'none' && !border && cs.boxShadow === 'none';

        // How far its own shadow reaches past each side. A blurred edge fades out over one and a half
        // times its blur radius (the renderer draws three sigma of a sigma of half the radius).
        const reach = bare
          ? { top: room, right: room, bottom: room, left: room }
          : { top: 0, right: 0, bottom: 0, left: 0 };
        if (cs.boxShadow !== 'none')
          for (const layer of cs.boxShadow.split(/,(?![^(]*\))/)) {
            if (/\binset\b/.test(layer)) continue;
            const [x = 0, y = 0, blur = 0, spread = 0] = (
              layer.replace(/[a-z-]+\([^)]*\)/gi, ' ').match(/-?\d*\.?\d+px/g) ?? []
            ).map(Number.parseFloat);
            const out = blur * 1.5 + spread;
            reach.left = Math.max(reach.left, out - x);
            reach.right = Math.max(reach.right, out + x);
            reach.top = Math.max(reach.top, out - y);
            reach.bottom = Math.max(reach.bottom, out + y);
          }
        const outer = {
          left: r.left - reach.left,
          top: r.top - reach.top,
          right: r.right + reach.right,
          bottom: r.bottom + reach.bottom,
        };
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const c = rules.clear;
        if (r.left < c || r.top < c || r.right > vw - c || r.bottom > vh - c)
          problems.push(
            `${label} is not whole inside the window ${c} px clear of every edge: ${Math.round(r.left)},${Math.round(r.top)} to ${Math.round(r.right)},${Math.round(r.bottom)} in ${vw}x${vh}`,
          );
        else if (outer.left < 0 || outer.top < 0 || outer.right > vw || outer.bottom > vh)
          problems.push(
            `${label}'s own shadow or ground runs past the window's edge (to ${Math.round(outer.left)},${Math.round(outer.top)} and ${Math.round(outer.right)},${Math.round(outer.bottom)}), so the window cuts it`,
          );

        for (let a = el.parentElement; a; a = a.parentElement) {
          const s = getComputedStyle(a);
          const who = describe(a);
          // Anything that changes how it looks from above would make the picture lie once it is gone.
          if (Number(s.opacity) < 1) problems.push(`${label} is inside ${who} at opacity ${s.opacity}`);
          if (s.filter !== 'none') problems.push(`${label} is inside ${who}, filtered ${s.filter}`);
          if (s.clipPath !== 'none') problems.push(`${label} is inside ${who}, clipped to ${s.clipPath}`);
          if (s.maskImage !== 'none' && s.maskImage !== '') problems.push(`${label} is inside ${who}, masked`);
          // Any ancestor that clips (overflow other than visible, or paint containment) must hold it
          // whole, and its shadow with it.
          const paint = /paint|strict|content/.test(s.contain);
          const clipX = paint || s.overflowX !== 'visible';
          const clipY = paint || s.overflowY !== 'visible';
          if (!clipX && !clipY) continue;
          if (a === document.documentElement || a === document.body) continue; // the window, checked above
          const b = a.getBoundingClientRect();
          const left = b.left + a.clientLeft;
          const top = b.top + a.clientTop;
          const right = left + a.clientWidth;
          const bottom = top + a.clientHeight;
          if (
            (clipX && (r.left < left - 0.5 || r.right > right + 0.5)) ||
            (clipY && (r.top < top - 0.5 || r.bottom > bottom + 0.5))
          )
            problems.push(`${label} is clipped by ${who}`);
          else if (
            !bare &&
            ((clipX && (outer.left < left - 0.5 || outer.right > right + 0.5)) ||
              (clipY && (outer.top < top - 0.5 || outer.bottom > bottom + 0.5)))
          )
            problems.push(`${label}'s own shadow is clipped by ${who}`);
        }
        return {
          label,
          mark: el.getAttribute('data-sc-shot') ?? '',
          box: { x: r.left, y: r.top, width: r.width, height: r.height },
          reach,
          backed,
          bare,
        };
      });
      return { problems, subjects };
    },
    { rules: ISOLATED, room },
  ) as Promise<{
    problems: string[];
    subjects: { label: string; mark: string; box: Box; reach: Reach; backed: boolean; bare: boolean }[];
  }>;
}

/** What `isolate` did: the subjects it backed, and the ground it put behind them, if any. */
type Isolation = {
  backed: string[];
  ground: { rect: Box; color: [number, number, number]; label: string } | null;
};

/**
 * Runs in the page: only the marked subjects paint, on a transparent ground. `back` are the marks of
 * the subjects with a box of their own to back with what they sit on. `bare` are the marks of those
 * with no box at all: when `room` is set, one panel of the ground they sit on goes behind every
 * subject, `room` px past their union, with the corners of the app's `corner` token. Every inline
 * style it sets is recorded and `window.__scShotRestore()` puts each back as it was, the panel
 * included.
 */
function isolate({
  room,
  back,
  bare,
  corner,
  hug,
}: {
  room: number;
  back: string[];
  bare: string[];
  corner: string;
  hug: boolean;
}): Isolation {
  const saved: [ElementCSSInlineStyle, string, string, string][] = [];
  const added: Element[] = [];
  const set = (el: Element, prop: string, value: string) => {
    const style = (el as HTMLElement).style;
    if (!style) return;
    saved.push([el as HTMLElement, prop, style.getPropertyValue(prop), style.getPropertyPriority(prop)]);
    style.setProperty(prop, value, 'important');
  };
  (window as unknown as { __scShotRestore?: () => void }).__scShotRestore = () => {
    for (const el of added.splice(0)) el.remove();
    for (const [el, prop, value, priority] of saved.reverse()) {
      if (value) el.style.setProperty(prop, value, priority);
      else el.style.removeProperty(prop);
    }
    saved.length = 0;
  };

  const subjects = Array.from(document.querySelectorAll<HTMLElement>('[data-sc-shot]'));
  /** A computed colour as [r, g, b, alpha 0..1]: sRGB read as written, anything else through a canvas. */
  const rgba = (color: string): [number, number, number, number] => {
    if (color === 'transparent') return [0, 0, 0, 0];
    const m = color.match(/^rgba?\(([^)]+)\)$/);
    if (m) {
      const [r, g, b, a = '1'] = m[1].split(/[\s,/]+/).filter(Boolean);
      const alpha = a.endsWith('%') ? Number.parseFloat(a) / 100 : Number.parseFloat(a);
      return [Number.parseFloat(r), Number.parseFloat(g), Number.parseFloat(b), alpha];
    }
    const probe = document.createElement('canvas').getContext('2d');
    if (!probe) throw new Error(`cannot read the colour ${color}`);
    probe.fillStyle = color;
    probe.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = probe.getImageData(0, 0, 1, 1).data;
    return [r, g, b, a / 255];
  };
  const over = ([r, g, b, a]: number[], [R, G, B]: number[]): [number, number, number] => [
    Math.round(r * a + R * (1 - a)),
    Math.round(g * a + G * (1 - a)),
    Math.round(b * a + B * (1 - a)),
  ];
  /** What an element sits on in the app: its ancestors' fills, down to the first opaque one, else the page's. */
  const ground = (el: Element): [number, number, number] => {
    const layers: [number, number, number, number][] = [];
    for (let a = el.parentElement; a; a = a.parentElement) {
      const c = rgba(getComputedStyle(a).backgroundColor);
      if (c[3] === 0) continue;
      layers.push(c);
      if (c[3] >= 1) break;
    }
    let base: [number, number, number] | null = null;
    const bottom = layers.at(-1);
    if (bottom && bottom[3] >= 1) {
      layers.pop();
      base = [bottom[0], bottom[1], bottom[2]];
    }
    if (!base) {
      const page = document.createElement('div');
      page.style.background = 'var(--sc-bg)';
      document.body.append(page);
      const c = rgba(getComputedStyle(page).backgroundColor);
      base = [c[0], c[1], c[2]];
      page.remove();
    }
    for (const layer of layers.reverse()) base = over(layer, base);
    return base;
  };
  const css = ([r, g, b]: number[]) => `rgb(${r}, ${g}, ${b})`;

  // A see-through subject with a box of its own is backed with what it sits on, under its own box
  // and corners, before anything around it stops painting.
  const backed: string[] = [];
  for (const s of subjects) {
    const mark = s.getAttribute('data-sc-shot') ?? '';
    if (!back.includes(mark)) continue;
    const cs = getComputedStyle(s);
    const fill = over(rgba(cs.backgroundColor), ground(s));
    set(s, 'background-color', css(fill));
    if (cs.backdropFilter !== 'none') set(s, 'backdrop-filter', 'none');
    backed.push(`.${Array.from(s.classList).join('.')} on ${css(fill)}`);
  }

  // Subjects with no box of their own keep the ground they sit on: one colour for all of them.
  let panel: Isolation['ground'] = null;
  if (room > 0 && bare.length > 0) {
    const grounds = subjects.filter((s) => bare.includes(s.getAttribute('data-sc-shot') ?? '')).map(ground);
    const color = grounds[0];
    if (grounds.some((g) => g.some((v, i) => Math.abs(v - color[i]) > 1)))
      throw new Error(`the subjects with no box of their own sit on different grounds: ${grounds.map(css).join(', ')}`);
    const radius = getComputedStyle(document.documentElement).getPropertyValue(corner).trim();
    if (!/^\d+(\.\d+)?px$/.test(radius)) throw new Error(`the app's ${corner} is "${radius}", not a length`);
    // A subject with no box of its own shows only what it draws: hugged, that is its extent.
    const boxes = subjects.map((s) => {
      if (!hug || !bare.includes(s.getAttribute('data-sc-shot') ?? '')) return s.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(s);
      const drawn = range.getBoundingClientRect();
      if (drawn.width < 1 || drawn.height < 1)
        throw new Error(`.${Array.from(s.classList).join('.')} draws nothing to hug`);
      return drawn;
    });
    const rect = {
      x: Math.min(...boxes.map((b) => b.left)) - room,
      y: Math.min(...boxes.map((b) => b.top)) - room,
      width: 0,
      height: 0,
    };
    rect.width = Math.max(...boxes.map((b) => b.right)) + room - rect.x;
    rect.height = Math.max(...boxes.map((b) => b.bottom)) + room - rect.y;
    if (
      rect.x < 0 ||
      rect.y < 0 ||
      rect.x + rect.width > window.innerWidth ||
      rect.y + rect.height > window.innerHeight
    )
      throw new Error(
        `the ground round the subjects runs past the window (${Math.round(rect.x)},${Math.round(rect.y)} ${Math.round(rect.width)}x${Math.round(rect.height)})`,
      );
    panel = {
      rect,
      color,
      label: `${css(color)}, ${room} px round ${hug ? 'what they draw' : 'them'}, corners ${radius} (${corner})`,
    };
  }

  const ancestors = new Set<Element>();
  for (const s of subjects) for (let a = s.parentElement; a; a = a.parentElement) ancestors.add(a);
  for (const a of ancestors) set(a, 'visibility', 'hidden');
  for (const s of subjects) set(s, 'visibility', 'visible');
  // Whatever outside the subjects still paints (its own rule says visible) stops.
  for (const el of Array.from(document.body.querySelectorAll('*'))) {
    if (ancestors.has(el) || subjects.some((s) => s === el || s.contains(el))) continue;
    if (getComputedStyle(el).visibility === 'visible') set(el, 'visibility', 'hidden');
  }
  set(document.documentElement, 'background', 'transparent');
  set(document.body, 'background', 'transparent');

  // The ground goes in last, under everything: fixed, behind the root's own layer, so every subject,
  // whatever layer it paints in, paints over it.
  if (panel) {
    const g = document.createElement('div');
    g.setAttribute('aria-hidden', 'true');
    const { rect, color } = panel;
    g.style.cssText = `position:fixed;left:${rect.x}px;top:${rect.y}px;width:${rect.width}px;height:${rect.height}px;border-radius:var(${corner});background:${css(color)};z-index:-1;pointer-events:none;visibility:visible`;
    document.body.prepend(g);
    added.push(g);
  }
  return { backed, ground: panel };
}

function svg(size: { width: number; height: number }, body: string): Buffer {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size.width}" height="${size.height}" viewBox="0 0 ${size.width} ${size.height}">${body}</svg>`,
  );
}

/**
 * Write a 1920x1080 frame with alpha as `src/assets/whatsnew/<name>.webp`, at the best quality that
 * fits under its kind's ceiling, no metadata.
 */
async function write(name: string, frame: Buffer, kind: Kind, how: string): Promise<void> {
  const { width = 0, height = 0 } = await sharp(frame).metadata();
  if (width !== WINDOW.width || height !== WINDOW.height)
    throw new Error(`${name}: the frame is ${width}x${height}, not ${WINDOW.width}x${WINDOW.height}`);
  for (const quality of QUALITIES) {
    const data = await sharp(frame).webp({ quality, alphaQuality: 100, smartSubsample: true, effort: 6 }).toBuffer();
    if (data.length > MAX_KIB[kind] * 1024) continue;
    const out = await sharp(data).metadata();
    if (out.width !== WINDOW.width || out.height !== WINDOW.height || !out.hasAlpha)
      throw new Error(`${name}: wrote ${out.width}x${out.height}${out.hasAlpha ? '' : ' without alpha'}`);
    mkdirSync(OUT, { recursive: true });
    writeFileSync(join(OUT, `${name}.webp`), data);
    console.log(`${name}.webp ${width}x${height} ${(data.length / 1024).toFixed(1)} KiB q${quality}, ${how}`);
    return;
  }
  throw new Error(`${name}: over ${MAX_KIB[kind]} KiB at quality ${QUALITIES.at(-1)}; show a calmer state`);
}

/** A git-tracked `templates/previews/**.jpg` into the library; its hash. Nothing else may be uploaded. */
export async function upload(request: APIRequestContext, repoPath: string): Promise<string> {
  if (!/^templates\/previews\/[\w/-]+\.jpg$/.test(repoPath)) throw new Error(`${repoPath}: not a catalog preview`);
  execFileSync('git', ['ls-files', '--error-unmatch', repoPath], { cwd: ROOT, stdio: 'ignore' });
  const buffer = readFileSync(join(ROOT, repoPath));
  const res = await request.post('/api/images', {
    multipart: { file: { name: basename(repoPath), mimeType: 'image/jpeg', buffer } },
  });
  expect(res.ok(), `upload ${repoPath}`).toBe(true);
  return ((await res.json()) as { hash: string }).hash;
}

/** A public, fictional brand from the demo catalog, by name; the only kind of brand a capture holds. */
export async function seedBrand(request: APIRequestContext, name: string): Promise<{ id: string; slug: string }> {
  const res = await request.post('/api/brands', { data: { brand: { specVersion: '0.1', meta: { name } } } });
  expect(res.ok(), await res.text()).toBe(true);
  SEEDED.add(name);
  return (await res.json()) as { id: string; slug: string };
}

/** A scene the brand owns, written from a catalog scene's own words and wearing its tracked picture. */
export async function seedScene(
  request: APIRequestContext,
  brandId: string,
  catalogId: string,
): Promise<{ id: string; name: string; description: string }> {
  const s = JSON.parse(readFileSync(join(ROOT, 'templates', `${catalogId}.json`), 'utf8'));
  const previewHash = await upload(request, `templates/previews/${catalogId}.jpg`);
  const { name, prompt, lighting, description, subject, collections, verticals } = s;
  const res = await request.post(`/api/brands/${brandId}/scenes`, {
    data: { name, prompt, lighting, description, subject, collections, verticals, previewHash },
  });
  expect(res.ok(), await res.text()).toBe(true);
  return { id: ((await res.json()) as { scene: { id: string } }).scene.id, name, description };
}

/**
 * One of the brand's own presenters, made from a catalog presenter: its tracked portrait as the face
 * view, and its own words for who they are (the line under the name, age, hair, face, skin, build
 * and the kinds of product they suit).
 */
export async function seedPresenter(
  request: APIRequestContext,
  brandId: string,
  catalogId: string,
): Promise<{ id: string; name: string }> {
  const p = JSON.parse(readFileSync(join(ROOT, 'templates', 'presenters', `${catalogId}.json`), 'utf8'));
  const hash = await upload(request, `templates/previews/presenters/${catalogId}.jpg`);
  const { name, presentation, descriptor, ageRange, hair, facial, skin, build, suitableCategories } = p;
  const res = await request.post(`/api/brands/${brandId}/presenters`, {
    data: {
      name,
      shotHashes: [hash],
      shotAngles: ['portrait'],
      sourceHashes: [hash],
      presentation,
      descriptor,
      ageRange,
      hair,
      facial,
      skin,
      build,
      suitableCategories,
    },
  });
  expect(res.ok(), await res.text()).toBe(true);
  return { id: ((await res.json()) as { presenter: { id: string } }).presenter.id, name };
}

/**
 * Codex set up and ready, as a Mac with Codex CLI installed and signed in shows it. The capture's
 * Scenri never runs Codex, so both status answers are stubbed: the providers list is the server's
 * own with Codex marked ready and the capture's placeholder engine left out, and the setup check
 * says ready. Neither carries an account, an email, a path, a key or a version.
 */
export async function stubCodexReady(page: Page): Promise<void> {
  await page.route(/\/api\/engines$/, async (r) => {
    const list = (await (await r.fetch()).json()) as { id: string }[];
    if (!list.some((e) => e.id === 'codex-cli')) throw new Error('the server lists no Codex engine to show ready');
    await r.fulfill({
      json: list
        .filter((e) => e.id !== 'demo')
        .map((e) => (e.id === 'codex-cli' ? { ...e, available: true, reason: null, code: null } : e)),
    });
  });
  await page.route(/\/api\/engines\/codex\/status(\?.*)?$/, (r) =>
    r.fulfill({ json: { state: 'ready', platform: 'mac' } }),
  );
}
