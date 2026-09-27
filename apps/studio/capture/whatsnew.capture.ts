import { type APIRequestContext, expect, type Locator, type Page, test } from '@playwright/test';
import { arrived, isolate } from '../e2e/harness.js';
import { prep } from '../visual/shared.js';
import { seedBrand, seedPresenter, seedScene, shootIsolated, shootWindow, stubLocalAccess, WINDOW } from './shoot.js';

/**
 * The What's New pictures, one test per file, named as the file is:
 * `pnpm capture:whatsnew -g 0.19.0` shoots one release's. An empty home and a
 * public fictional brand from the demo catalog, so no library of anyone's shows.
 * One picture per update, of one of two kinds (see shoot.ts): the whole
 * 1920x1080 window for a change that is a page, or the component that changed,
 * isolated from the page exactly as the app draws it.
 */
isolate({ brand: false });

let seeded: Promise<{ id: string; slug: string }> | null = null;
const brand = (request: APIRequestContext) => {
  seeded ??= seedBrand(request, 'Aldergate');
  return seeded;
};

/** The brand's own presenters for 0.17.1 and 0.17.2, from the catalog's portraits and words. */
const CAST = ['amara', 'kwame'];

/**
 * The brand's own scenes for 0.17.0, from catalog scenes with tracked pictures. The wall shows the
 * newest first, seven to a row in this window, so seeded oldest first (this row reversed, then the
 * rest) they fill three rows and the last reads left to right as written here. The run is its middle
 * five, balanced over the bar that floats in the middle of the window; PICKED are their places in it.
 */
const LAST_ROW = [
  'hair-nest',
  'pink-ball-pit',
  'green-tyre-stack',
  'paper-garden',
  'cobalt-container',
  'martini-hour',
  'red-light-blade',
];
const ABOVE = [
  'balloon-knot',
  'beauty-dish',
  'block-tower',
  'chalk-steps',
  'clay-court',
  'coal-blind-light',
  'glass-block-room',
  'lantern-room',
  'laundry-line',
  'linen-morning-room',
  'model-village',
  'palm-shade-garden',
  'pink-smoke',
  'sunlit-color-field',
];
const PICKED = [0, 2, 3];

let cast: Promise<Map<string, string>> | null = null;
/** The cast, seeded once for the file: each name to its presenter's id. */
const presenters = (request: APIRequestContext) => {
  cast ??= (async () => {
    const { id } = await brand(request);
    const ids = new Map<string, string>();
    for (const c of CAST) {
      const p = await seedPresenter(request, id, c);
      ids.set(p.name, p.id);
    }
    return ids;
  })();
  return cast;
};

async function box(l: Locator, what: string) {
  const b = await l.boundingBox();
  if (!b) throw new Error(`${what} did not lay out`);
  return b;
}

/** Scroll the pane `target` scrolls in by `dy` CSS px, and prove the pane went that far. */
async function scrollBy(page: Page, target: Locator, dy: number): Promise<void> {
  const moved = await target.evaluate((el, dy) => {
    let pane = el.parentElement;
    while (pane && !(/auto|scroll/.test(getComputedStyle(pane).overflowY) && pane.scrollHeight > pane.clientHeight))
      pane = pane.parentElement;
    if (!pane) throw new Error('no scroll pane');
    const from = pane.scrollTop;
    pane.scrollTop = from + dy;
    return pane.scrollTop - from;
  }, dy);
  expect(Math.abs(moved - dy), `the pane scrolled ${moved} of ${dy} px`).toBeLessThan(1);
  await page.waitForTimeout(200);
}

/** The bottom of the top bar, CSS px. */
async function topBarBottom(page: Page): Promise<number> {
  const bar = await box(page.locator('.sc-topbar'), 'the top bar');
  return bar.y + bar.height;
}

/** A row of kinds' edges and its tabs', CSS px from the window's left. */
async function railOf(rail: Locator) {
  return rail.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const tabs = Array.from(el.querySelectorAll('[role=tab]'), (t) => {
      const b = t.getBoundingClientRect();
      return { label: t.textContent ?? '', left: b.left, right: b.right };
    });
    return { left: r.left, right: r.right, tabs };
  });
}

/**
 * Create's prompt, lifted clear of the window's bottom edge. It floats just above that edge, and
 * its own shadow, and the shadow of a list opened from it, fall past it, where the window cuts
 * them; lifted by as much as the card's shadow falls, and a margin, all of it is drawn whole.
 * Nothing is drawn differently. Lift it before opening anything from it, so that follows.
 */
async function liftPrompt(card: Locator): Promise<void> {
  await card.evaluate((el) => {
    const dock = el.closest<HTMLElement>('.sc-canvas-dock');
    if (!dock) throw new Error('the prompt is not in the canvas dock');
    let fall = 0;
    for (const layer of getComputedStyle(el).boxShadow.split(/,(?![^(]*\))/)) {
      if (/\binset\b/.test(layer)) continue;
      const [, y = 0, blur = 0, spread = 0] = (
        layer.replace(/[a-z-]+\([^)]*\)/gi, ' ').match(/-?\d*\.?\d+px/g) ?? []
      ).map(Number.parseFloat);
      fall = Math.max(fall, y + blur * 1.5 + spread);
    }
    const lift = Math.ceil(el.getBoundingClientRect().bottom + fall + 16 - window.innerHeight);
    if (lift > 0) dock.style.setProperty('translate', `0 ${-lift}px`);
  });
}

/**
 * How far Create's prompt card keeps `what` from its own edge, CSS px: below it for the settings
 * row, before its first word for the line of the prompt.
 */
const cardPadding = (what: Locator, side: 'bottom' | 'left') =>
  what.evaluate((el, side) => {
    const card = el.closest<HTMLElement>('.sc-promptcard');
    if (!card) throw new Error('not in the prompt card');
    const c = card.getBoundingClientRect();
    const border = Number.parseFloat(getComputedStyle(card).getPropertyValue(`border-${side}-width`));
    if (side === 'bottom') return c.bottom - border - el.getBoundingClientRect().bottom;
    const words = document.createRange();
    words.selectNodeContents(el);
    return words.getBoundingClientRect().left - (c.left + border);
  }, side);

/** A block's own padding on its left, CSS px: how far the page keeps words from its edge. */
const paddingOf = (l: Locator) => l.evaluate((el) => Number.parseFloat(getComputedStyle(el).paddingLeft));

test('0.19.0-home-examples', async ({ page, request }) => {
  // window: Home scrolled to the examples, their kinds just under the top bar, the wall below and
  // the composer floating at the bottom, as the window shows them.
  const { slug } = await brand(request);
  await page.setViewportSize(WINDOW);
  await prep(page, 'dark');
  await page.goto(`/${slug}`);
  await expect(page.locator('.sc-masonry[data-wall] img').first()).toBeVisible();
  const tabs = page.getByRole('tablist', { name: 'Categories' });
  await expect(tabs.getByText('All examples', { exact: true })).toBeVisible();
  await scrollBy(page, tabs, (await box(tabs, 'the row of kinds')).y - ((await topBarBottom(page)) + 12));
  // Where the row of kinds is wider than the window it cannot all show: it must end between two
  // kinds, every kind shown whole and clear of the edge fade, and sit whole under the top bar.
  const row = await railOf(tabs);
  expect(row.tabs.map((t) => t.label)[0]).toMatch(/^All examples/);
  for (const t of row.tabs) expect(t.right <= row.right - 8 || t.left >= row.right, `${t.label} is cut`).toBe(true);
  const at = await box(tabs, 'the row of kinds');
  expect(at.y).toBeGreaterThanOrEqual(await topBarBottom(page));
  expect(row.left).toBeGreaterThanOrEqual(0);
  await shootWindow(page, '0.19.0-home-examples');
});

test('0.18.0-portrait-standard', async ({ page, request }) => {
  // isolated: the settings a new shot starts with, from Create's prompt: Portrait, one picture and
  // Standard, with the shape list open on Portrait. The three settings are marks and words on the
  // prompt card with no box of their own, so they keep the card's ground round them, as far as the
  // card's own padding below them; the list keeps its own box and shadow over that ground.
  const { slug } = await brand(request);
  await page.setViewportSize(WINDOW);
  await prep(page, 'dark');
  await page.goto(`/${slug}/create`);
  const card = page.locator('.sc-canvas-dock .sc-promptcard');
  await expect(card).toBeVisible();
  // a new shot: nothing written yet
  await expect(card.locator('.sc-brief-line')).toHaveText('');
  const pills = card.locator('.sc-prompt-pills');
  await expect(pills).toContainText('Portrait');
  await expect(pills).toContainText('1');
  await expect(pills).toContainText('Standard');
  const room = await cardPadding(pills, 'bottom');
  expect(room, "the card's padding below its settings").toBeGreaterThanOrEqual(12);
  await liftPrompt(card);
  await pills.getByRole('button', { name: /^Aspect Portrait/ }).click();
  const list = page.locator('.sc-setpop').filter({ has: page.getByRole('radiogroup', { name: 'Aspect ratio' }) });
  await expect(list.getByRole('radio', { name: 'Portrait, 4:5' })).toHaveAttribute('aria-checked', 'true');
  // the list closes when its focus goes, so the pointer is parked by hand and the focus kept
  await page.mouse.move(1, WINDOW.height - 1);
  await shootIsolated(page, '0.18.0-portrait-standard', [pills, list], { posed: true, room });
});

test('0.17.2-presenter-prompt', async ({ page, request }) => {
  // isolated: the words of a prompt waiting in Create's composer, naming two of the brand's own
  // presenters, each a chip with their face: the first put there from her page, the second typed
  // with @, the way the brand's own come first. The line is words and chips on the prompt card with
  // no box of their own, so it keeps the card's ground round what it draws, as far as the card
  // keeps its first word from its edge.
  const { slug } = await brand(request);
  const ids = await presenters(request);
  const amara = ids.get('Amara') as string;
  const kwame = ids.get('Kwame') as string;
  await page.setViewportSize(WINDOW);
  await prep(page, 'dark');
  await page.goto(`/${slug}/presenters/${amara}`);
  await page.getByRole('button', { name: 'Use in a shot' }).click();
  await expect(page).toHaveURL(/\/create/);
  const card = page.locator('.sc-canvas-dock .sc-promptcard');
  const line = card.locator('.sc-brief-line');
  await expect(card.locator(`.sc-brief [data-tok^="h:${amara}"]`)).toHaveCount(1);
  await line.click();
  await page.keyboard.press('End');
  await page.keyboard.type(' and @Kwame');
  await page.keyboard.press('Enter');
  await expect(card.locator(`.sc-brief [data-tok^="h:${kwame}"]`)).toHaveCount(1);
  await page.keyboard.type(' by a window');
  // the line's zero-width guards round its chips are not words
  await expect
    .poll(() => line.evaluate((el) => (el.textContent ?? '').replace(/[\u200b\ufeff]/g, '')))
    .toBe('Amara and Kwame by a window');
  const room = await cardPadding(line, 'left');
  expect(room, 'the card keeps its first word from its edge').toBeGreaterThanOrEqual(12);
  await shootIsolated(page, '0.17.2-presenter-prompt', line, { room, hug: true });
});

test('0.17.1-presenter-identity', async ({ page, request }) => {
  // isolated: one of the brand's own presenters as their page opens: the face, the name, what they
  // are filed under, and the line that says their hair and build, with the page's own actions.
  // Words on the page have no box of their own, so they keep the page's ground round them, as far
  // as the page's own padding.
  const { slug } = await brand(request);
  const ids = await presenters(request);
  await page.setViewportSize(WINDOW);
  await prep(page, 'dark');
  await page.goto(`/${slug}/presenters/${ids.get('Kwame')}`);
  const main = page.locator('main.sc-presenterpage');
  await expect(main.locator('h1')).toHaveText('Kwame');
  await expect(main.locator('.sc-lookpage-lede')).toHaveText('Lifestyle · twists and fade · athletic build');
  await expect(main.locator('.sc-presenterpage-avatar img')).toBeVisible();
  const room = await paddingOf(main);
  expect(room, "the page's own padding").toBeGreaterThanOrEqual(16);
  await shootIsolated(
    page,
    '0.17.1-presenter-identity',
    [
      main.locator('.sc-presenterpage-avatar'),
      main.locator('h1'),
      main.locator('.sc-lookpage-cats'),
      main.locator('.sc-lookpage-lede'),
      main.locator('.sc-lookpage-acts > *'),
    ],
    { room },
  );
});

test('0.17.0-select-several', async ({ page, request }) => {
  // isolated: a run of five of your own scenes in the compact wall, three of them picked and two
  // not, and the selection bar that acts on them, in the layout the page gives them. Scenes, not
  // presenters: a picked card's ring is white, and it vanishes on a portrait's white ground.
  const { id, slug } = await brand(request);
  await page.setViewportSize(WINDOW);
  await prep(page, 'dark');
  // a scene card is labelled with the scene's description
  const told = new Map<string, string>();
  for (const s of [...[...LAST_ROW].reverse(), ...ABOVE]) told.set(s, (await seedScene(request, id, s)).description);
  await page.goto(`/${slug}/scenes`);
  const compact = page.getByRole('radio', { name: /Compact/ });
  if (!(await compact.isChecked())) await compact.click();
  const cards = page.locator('.sc-owned .sc-lookcard');
  await expect(cards.locator('img')).toHaveCount(told.size);

  // The last row, whole and in the order seeded, and the five in it nearest the middle of the window.
  const boxes = await Promise.all((await cards.all()).map((c, i) => box(c, `card ${i}`)));
  const lastY = Math.max(...boxes.map((b) => b.y));
  const row = boxes.map((b, i) => ({ ...b, i })).filter((b) => Math.abs(b.y - lastY) < 1);
  const shown = await Promise.all(
    row.map((c) => cards.nth(c.i).locator('.sc-lookcard-open').getAttribute('aria-label')),
  );
  expect(shown, 'the last row, left to right').toEqual(LAST_ROW.map((s) => told.get(s)));
  const middle = WINDOW.width / 2;
  const run = [...row]
    .sort((a, b) => Math.abs(a.x + a.width / 2 - middle) - Math.abs(b.x + b.width / 2 - middle))
    .slice(0, 5)
    .sort((a, b) => a.x - b.x);
  // the gap between two rows of the wall, which the run keeps above the bar
  const gap = lastY - Math.max(...boxes.filter((b) => b.y < lastY - 1).map((b) => b.y + b.height));

  for (const n of PICKED) await cards.nth(run[n].i).locator('.sc-lookcard-pick').click();
  await expect(page.locator('.sc-picked-n')).toContainText(String(PICKED.length));
  const bar = page.getByRole('toolbar', { name: 'Selection' });
  await expect(bar).toHaveClass(/\bsc-picked\b/);
  // The bar floats 18 px above the window's bottom edge and its own shadow falls past that edge,
  // where the window cuts it. Lifted clear, its shadow is drawn whole; the wall is scrolled after,
  // so the run sits one row gap above the bar, as a wall scrolled there shows it.
  await bar.evaluate((el) => {
    const dock = el.closest<HTMLElement>('.sc-wall-dock');
    if (!dock) throw new Error('the selection bar is not in the wall dock');
    dock.style.setProperty('translate', '0 -48px');
  });
  const barAt = await box(bar, 'the selection bar');
  const runAt = await box(cards.nth(run[0].i), 'the run');
  await scrollBy(page, cards.nth(run[0].i), runAt.y + runAt.height - (barAt.y - gap));
  const centre = (run[0].x + run[4].x + run[4].width) / 2;
  expect(Math.abs(centre - (barAt.x + barAt.width / 2)), 'the run is centred over the bar').toBeLessThan(8);

  await shootIsolated(page, '0.17.0-select-several', [...run.map((c) => cards.nth(c.i)), bar]);
});

test('0.16.0-local-access', async ({ page, request }) => {
  // isolated: the Other devices card from Settings > Local access, whole: the QR code, the address
  // and the six-digit code to type, the iPhone that just came in, and the rows that copy the link
  // and make a new code. Local access is stubbed with a made-up address and code (shoot.ts).
  const { slug } = await brand(request);
  await page.setViewportSize(WINDOW);
  await stubLocalAccess(page, new Date('2026-08-18T12:00:00').getTime());
  await prep(page, 'dark');
  await page.goto(`/${slug}?settings=phone`);
  const dialog = page.getByRole('dialog');
  const phone = dialog.locator('.sc-phone');
  await expect(phone.locator('.sc-qr')).toBeVisible();
  await expect(phone.locator('.sc-phone-key')).toHaveText(['http://192.168.1.20:4747', '305 918']);
  await expect(phone.locator('.sc-phone-arrival')).toContainText('iPhone');
  const card = dialog.locator('.sc-set-card').filter({ has: page.locator('.sc-phone') });
  await shootIsolated(page, '0.16.0-local-access', card);
});

test('0.15.1-choose-a-world', async ({ page, request }) => {
  // isolated: Create scene's Guide me asking what world, the eight pictures a world is chosen from,
  // and Sunlit stone, the one chosen, lit: the question as it stands when its answer is changed.
  // A question in the conversation is words and pictures on the rail, with no box of its own, so
  // it keeps the rail's ground round it, as far as the rail's own padding beside it.
  const { slug } = await brand(request);
  await page.setViewportSize(WINDOW);
  await prep(page, 'dark');
  await page.goto(`/${slug}/scenes/new`);
  await arrived(page, '.sc-pstudio[data-kind="scene"]');
  const studio = page.locator('.sc-pstudio[data-kind="scene"]');
  const turn = (key: string) => studio.locator(`[data-turn="${key}"]`);
  await turn('q:source').getByRole('button', { name: 'Guide me', exact: true }).click();
  await expect(turn('q:world')).toContainText('Choose a starting world');
  await turn('q:world').getByRole('button', { name: 'Sunlit stone', exact: true }).click();
  await expect(turn('q:surface')).toBeVisible();
  await studio.getByText('Sunlit stone', { exact: true }).last().hover();
  await studio.getByRole('button', { name: 'Change this answer' }).last().click();
  const world = turn('q:world');
  const asked = turn('scenri:asked-world');
  await expect(asked).toContainText('What world?');
  await expect(world.locator('.sc-convo-plate')).toHaveCount(8);
  await expect(world.locator('.sc-convo-plate[data-on]')).toHaveAccessibleName('Sunlit stone');
  const rail = await box(studio.locator('.sc-convo-log'), 'the conversation');
  const q = await box(world, 'the question');
  const room = Math.min(q.x - rail.x, rail.x + rail.width - (q.x + q.width));
  expect(room, "the rail's padding beside the question").toBeGreaterThanOrEqual(16);
  await shootIsolated(page, '0.15.1-choose-a-world', [asked, world], { room });
});
