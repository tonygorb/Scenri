import { fileURLToPath } from 'node:url';
import { type APIRequestContext, expect, type Locator, type Page, test } from '@playwright/test';
import { isolate } from '../e2e/harness.js';
import { prep } from '../visual/shared.js';
import { seedBrand, seedPresenter, seedScene, shootIsolated, shootWindow, WINDOW } from './shoot.js';

/**
 * The What's New pictures, one test per file, named as the file is:
 * `pnpm capture:whatsnew -g 0.19.0` shoots one release's. An empty home and a
 * public fictional brand from the demo catalog, so no library of anyone's shows.
 * One picture per update, of one of two kinds (see shoot.ts): the whole
 * 1920x1080 window for a change that is a page, or the component that changed,
 * isolated from the page exactly as the app draws it.
 */
isolate({
  brand: false,
  env: {
    // 0.20.0 holds a batch's later pictures while its first lands (no other capture here draws),
    // and the first answers with a tracked showcase photograph rather than the demo engine's card.
    SCENRI_DEMO_STAGGER_MS: '600000',
    SCENRI_DEMO_PHOTOS: fileURLToPath(new URL('../../../templates/previews/showcase/', import.meta.url)),
  },
});

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

test('0.22.0-people-places', async ({ page, request }) => {
  // isolated, by Tony's direction (2026-10-07): the two kinds the update renames, as two of the
  // prompt's own chips side by side, each with a real catalog picture, the name the app now gives
  // the kind, and the caret the site's chips carry to say they open (Phosphor caretDown, 0.6em, the
  // muted ink). Built in the prompt line from the app's own chip, the way the site shows them,
  // rather than a state the prompt reaches by itself: a chip there carries a thing's name.
  const { slug } = await brand(request);
  const json = async (path: string) => (await request.get(path)).json();
  // the tracked 4:5 portrait card (the square avatar ships in the downloaded library), framed the
  // way the chip frames a card: crop=top
  const person = (await json('/api/presenters')).presenters.find((p: { id: string }) => p.id === 'amara')
    .previewUrl as string;
  const place = (await json('/api/scenes')).scenes.find((s: { id: string }) => s.id === 'balloon-knot')
    .previewUrl as string;
  await page.setViewportSize(WINDOW);
  await prep(page, 'dark');
  await page.goto(`/${slug}/create`);
  const card = page.locator('.sc-canvas-dock .sc-promptcard');
  await expect(card).toBeVisible();
  const line = card.locator('.sc-brief-line');
  await expect(line).toHaveText('');
  await liftPrompt(card);
  await line.evaluate(
    (el, chips) => {
      el.replaceChildren();
      const caret =
        'M213.66,101.66l-80,80a8,8,0,0,1-11.32,0l-80-80A8,8,0,0,1,53.66,90.34L128,164.69l74.34-74.35a8,8,0,0,1,11.32,11.32Z';
      chips.forEach(([kind, src, label], i) => {
        if (i) el.append(' ');
        const chip = document.createElement('span');
        chip.className = 'sc-token';
        chip.dir = 'ltr';
        chip.dataset.kind = kind;
        chip.dataset.capture = '';
        const img = document.createElement('img');
        img.src = src;
        img.alt = '';
        if (kind === 'character') img.dataset.crop = 'top';
        const text = document.createElement('span');
        text.className = 'sc-token-label';
        text.textContent = label;
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 256 256');
        svg.setAttribute('aria-hidden', 'true');
        svg.style.cssText = 'width: 0.6em; height: 0.6em; flex: none; fill: var(--sc-fg3);';
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', caret);
        svg.append(path);
        chip.append(img, text, svg);
        el.append(chip);
      });
      // the chips are sized in em, so the line's type size scales both as one: uniform scaling,
      // large enough to read in the dialog
      const line = el as HTMLElement;
      line.style.fontSize = `${Number.parseFloat(getComputedStyle(line).fontSize) * 2}px`;
      line.blur();
    },
    [
      ['character', person, 'People'],
      ['template', place, 'Places'],
    ],
  );
  const chips = line.locator('.sc-token[data-capture]');
  await expect(chips).toHaveText(['People', 'Places']);
  for (const img of await chips.locator('img').all()) {
    await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0)).toBe(true);
  }
  await page.mouse.move(1, WINDOW.height - 1);
  await shootIsolated(page, '0.22.0-people-places', await chips.all(), { posed: true });
});

test('0.20.0-made-in-place', async ({ page, request }) => {
  // isolated: Create's newest batch, two shots from one prompt: the first has landed, and the
  // second is still being made, a swirl in the place its picture will land, with its clock and
  // Cancel. A landed tile is its picture, with no box of its own once it has pixels, so the feed's
  // ground is kept round the pair, as far as the gap between its two tiles.
  const { id, slug } = await seedBrand(request, 'Brixa');
  await page.setViewportSize(WINDOW);
  await prep(page, 'dark');
  await page.goto(`/${slug}/create`);
  await page.evaluate(() => {
    localStorage.setItem('scenri:count', '2');
    localStorage.setItem('scenri:format', JSON.stringify('portrait'));
  });
  await page.goto(`/${slug}/create`);
  const line = page.locator('.sc-canvas-dock .sc-brief-line');
  await expect(line).toBeVisible();
  const answered = page.waitForResponse((r) => r.url().endsWith('/api/nodes') && r.request().method() === 'POST');
  await line.click();
  await page.keyboard.type('A bottle on warm stone in low evening sun');
  await page.locator('.sc-canvas-dock .sc-send').click();
  const ids = ((await (await answered).json()).siblings as { id: string }[]).map((s) => s.id);
  expect(ids).toHaveLength(2);
  const tile = (n: string) => page.locator(`.sc-cell[data-fb-node="${n}"]`);
  // the first has landed and painted; the second is still being made, with its swirl
  await expect(tile(ids[0]).locator('.sc-cellimg[data-loaded]')).toBeVisible({ timeout: 30_000 });
  for (const n of ids.slice(1)) {
    await expect(tile(n)).toHaveAttribute('data-running', 'true');
    await expect(tile(n).locator('.sc-rendering canvas')).toBeVisible();
    await expect(tile(n).getByRole('button', { name: 'Cancel' })).toBeVisible();
  }
  // The page clock is frozen before the server's; pinned a little after the pair started, the
  // clock reads as a picture being worked on rather than one not begun.
  const feed = await (await request.get(`/api/brands/${id}/feed?limit=60`)).json();
  const since = (feed.items as { id: string; startedAt?: string | null; createdAt: string }[])
    .filter((x) => ids.includes(x.id))
    .map((x) => x.startedAt || x.createdAt)
    .map((t) => Date.parse(t.includes('T') ? t : `${t.replace(' ', 'T')}Z`));
  await page.clock.setFixedTime(Math.max(...since) + 14_000);
  for (const n of ids.slice(1)) await expect(tile(n).locator('.sc-cell-tag')).toHaveText('0:14');
  // one row, in the order they were asked for
  const boxes = await Promise.all(ids.map((n, i) => box(tile(n), `shot ${i + 1}`)));
  for (let i = 1; i < boxes.length; i++) {
    expect(Math.abs(boxes[i].y - boxes[0].y), 'the pair sits in one row').toBeLessThan(2);
    expect(boxes[i].x, 'the batch runs in the order it was asked for').toBeGreaterThan(boxes[i - 1].x);
  }
  const room = Math.round(boxes[1].x - (boxes[0].x + boxes[0].width));
  expect(room, 'the gap between the two tiles').toBeGreaterThanOrEqual(8);
  await shootIsolated(page, '0.20.0-made-in-place', ids.map(tile), { room });
});

test('0.21.0-home-examples', async ({ page, request }) => {
  // window: Home at the examples, the new ones in the first row of the wall.
  const { slug } = await brand(request);
  await page.setViewportSize(WINDOW);
  await prep(page, 'dark');
  await page.goto(`/${slug}`);
  await expect(page.locator('.sc-masonry[data-wall] img').first()).toBeVisible();
  const tabs = page.getByRole('tablist', { name: 'Categories' });
  await expect(tabs.getByText('All examples', { exact: true })).toBeVisible();
  await scrollBy(page, tabs, (await box(tabs, 'the row of kinds')).y - ((await topBarBottom(page)) + 12));
  const row = await railOf(tabs);
  expect(row.tabs.map((t) => t.label)[0]).toMatch(/^All examples/);
  for (const t of row.tabs) expect(t.right <= row.right - 8 || t.left >= row.right, `${t.label} is cut`).toBe(true);
  const at = await box(tabs, 'the row of kinds');
  expect(at.y).toBeGreaterThanOrEqual(await topBarBottom(page));
  expect(row.left).toBeGreaterThanOrEqual(0);
  await expect(page.getByText('Olea Hand Cream from the tote')).toBeVisible();
  await shootWindow(page, '0.21.0-home-examples');
});

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
  await page.goto(`/${slug}/people/${amara}`);
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
  await page.goto(`/${slug}/people/${ids.get('Kwame')}`);
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
  await page.goto(`/${slug}/places`);
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
