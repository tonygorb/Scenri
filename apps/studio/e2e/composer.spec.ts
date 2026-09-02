import { test, expect, type Page } from '@playwright/test';
import { isolate } from './harness.js';

/**
 * The caret and focus behaviour of the brief.
 *
 * These cases cannot be written in jsdom: only trusted events move focus, and
 * Chromium's editing caret is a (node, offset) anchor that behaves differently
 * from what the Selection API reports. Every regression in this area this far
 * has been invisible to unit tests and obvious within seconds of real clicking,
 * so this spec clicks and types for real.
 */

// A Scenri of this file's own, on an empty home, seeded from scratch.
isolate();

const line = (p: Page) => p.locator('.sc-brief-line').first();
const dock = (p: Page) => p.locator('.sc-canvas-dock').first();
const chips = (p: Page) => p.locator('.sc-brief-line .sc-token');

/** What the sentence reads as, chips included. */
const sentence = async (p: Page) => (await line(p).textContent())?.replace(/ /g, ' ') ?? '';

/**
 * Open the attach panel and pick a tab.
 *
 * Attach used to be two clicks: a menu naming five kinds, then a panel that
 * already had those same five as tabs. The menu is gone, so this opens the
 * panel and goes straight to the tab.
 */
async function plusMenu(p: Page, tab: RegExp) {
  const panel = p.locator('.sc-attachpanel');
  if (await panel.isVisible().catch(() => false)) {
    await dock(p).locator('.sc-attach-toggle').click();
  }
  await dock(p).locator('.sc-attach-toggle').click();
  await p.locator('.sc-ap-tabs button', { hasText: tab }).click();
  await attachCards(p).first().waitFor();
}

/**
 * The attachable cards, which is not every card in the panel: the Products tab
 * leads with "Add product", a button that opens a dialog rather than inserting
 * a chip, so picking by raw index there attaches nothing.
 */
const attachCards = (p: Page) => p.locator('.sc-ap-card:not(.sc-ap-add)');

async function pickCard(p: Page, index = 0) {
  await attachCards(p).nth(index).click();
  await expect(chips(p)).not.toHaveCount(0);
}

const pick = (p: Page) => p.locator('.sc-swap');
/** The choosable grid, which is not the Current row and not the Add card. */
const cards = (p: Page) => p.locator('.sc-swap .sc-swap-grid .sc-swap-card');
const pickSearch = (p: Page) => p.locator('.sc-swap-search input');
/** What is on, lifted out of the grid so it is never in two places at once. */
const currentRow = (p: Page) => p.locator('.sc-swap-cur');

/**
 * Click a chip, which is the whole gesture: change this one.
 *
 * `at` is where across the chip to land, because the click still places the
 * caret before the picker opens — and which side of the chip it lands on is
 * what the picker has to hand back when it closes.
 */
async function openPicker(p: Page, index = 0, at = 0.5) {
  const box = await chips(p).nth(index).boundingBox();
  if (!box) throw new Error('no chip to open');
  await p.mouse.click(box.x + box.width * at, box.y + box.height / 2);
  await pick(p).waitFor();
}

/**
 * Click exactly at a character in the line.
 *
 * A Playwright text locator resolves to the element that contains the text,
 * which here is the whole line, so its box is useless for aiming at a word.
 * A Range around the character gives the real coordinates.
 */
async function clickAtChar(p: Page, nodeIndex: number, charOffset: number) {
  const pt = await p.evaluate(
    ([ni, off]) => {
      const el = document.querySelector('.sc-brief-line')!;
      const node = el.childNodes[ni as number];
      const len = (node.textContent ?? '').length;
      const r = document.createRange();
      r.setStart(node, Math.min(off as number, len));
      r.setEnd(node, Math.min((off as number) + 1, len));
      const b = r.getBoundingClientRect();
      return { x: b.left + 1, y: b.top + b.height / 2 };
    },
    [nodeIndex, charOffset],
  );
  await p.mouse.click(pt.x, pt.y);
}

test.beforeEach(async ({ page }) => {
  // the brief lives on the hub: Home is the way in and carries no tools
  await page.goto('/');
  // a brand is the whole first segment now: one segment, and not the wizard
  await page.waitForURL((u) => {
    const seg = u.pathname.split('/').filter(Boolean);
    return seg.length === 1 && seg[0] !== 'setup';
  });
  await page.goto(`${new URL(page.url()).pathname}/create`);
  await line(page).waitFor();
  // A fresh, param-less /create must never open in refine mode. The draft no
  // longer persists a branch target, so a chip here could only be a
  // regression — this used to be a defensive dismissal, now it is the lock.
  await expect(page.locator('.sc-target')).toHaveCount(0);
  // Typed text still restores on purpose; clear whatever the last test left.
  await line(page).click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('Backspace');
});

test('a refusal is on the screen, and the brief survives it', async ({ page }) => {
  // The server writes these to be acted on — which engine cannot carry the
  // product, which cap was hit. They used to arrive only as the send button's
  // tooltip, so a click looked like it had done nothing at all.
  const refusal =
    'Demo cannot carry enough reference images, so Cold brew can would be named in the prompt but never shown.';
  await page.route('**/api/nodes', (route) =>
    route.request().method() === 'POST'
      ? route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: refusal }) })
      : route.fallback(),
  );

  await page.keyboard.type('a shot that will be refused');
  await dock(page).locator('.sc-send').click();

  // A refused send is reported as an event, in the same toast every other
  // failure in the app uses; it no longer owns a card above the composer.
  const failed = page.locator('.sc-toast', { hasText: 'That did not send' });
  await expect(failed).toBeVisible();
  await expect(failed).toContainText(refusal);

  // nothing typed is thrown away by a send that never happened
  expect(await sentence(page)).toContain('a shot that will be refused');

  await failed.locator('.sc-toast-x').click();
  await expect(failed).toHaveCount(0);
});

test('the settings ride along with the brief, so a shot can be run again as itself', async ({ page }) => {
  // A recipe that cannot reproduce its own shot is not a recipe: retrying a
  // four-variant run used to come back with a single frame, because the count
  // was guessed from images a failed shot never had.
  let body: any = null;
  await page.route('**/api/nodes', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    body = route.request().postDataJSON();
    await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'not today' }) });
  });

  await page.keyboard.type('a shot whose recipe must survive');
  // On a desktop the three settings are pills in the row; a narrow composer
  // collapses the same three behind More, and a phone opens them as a sheet.
  await dock(page).locator('.sc-prompt-pills [aria-label="2 shots"]').click();
  await page.locator('.sc-setpop').getByRole('radio', { name: '3 shots' }).click();
  await dock(page).locator('.sc-send').click();
  await expect(page.locator('.sc-toast', { hasText: 'That did not send' })).toBeVisible();

  expect(body?.count).toBe(3);
  expect(body?.brief?.variants).toBe(3);
  expect(body?.brief?.quality).toBeTruthy();
});

test('opening a curated example never rewrites your own defaults', async ({ page }) => {
  // The example's settings are borrowed for the brief on screen. They used to
  // be written straight into the machine's prefs, so looking at one 4-variant
  // example quietly changed what every later shot would cost.
  const before = await page.evaluate(() => {
    localStorage.setItem('scenri:count', '2');
    localStorage.setItem('scenri:quality', '"standard"');
    return localStorage.getItem('scenri:count');
  });
  expect(before).toBe('2');

  await page.goto(`/${new URL(page.url()).pathname.split('/')[1]}`);
  const card = page.locator('[data-wall] .sc-lookcard').first();
  await card.waitFor();
  // the pill surfaces on hover and then covers the card body, so hovering is
  // part of pressing it
  await card.hover();
  await card.locator('.sc-lookcard-use').click();
  await expect(page.locator('.sc-toast', { hasText: 'Starting from' })).toBeVisible();

  expect(await page.evaluate(() => localStorage.getItem('scenri:count'))).toBe('2');
  expect(await page.evaluate(() => localStorage.getItem('scenri:quality'))).toBe('"standard"');
});

test('opening a shot leaves the draft in the dock alone', async ({ page }) => {
  // There is one saved draft per brand and two composers on screen: the dock
  // keeps one, an open shot mounts another. Opening a shot used to overwrite
  // a half-typed brief with that second composer's empty sentence.
  await page.keyboard.type('a brief nobody asked to lose');
  await expect(page.locator('.sc-cell').first()).toBeVisible();
  await page.locator('.sc-cell').first().click();
  await page.waitForURL(/\/shots\//);
  await expect(page.locator('.sc-ovl')).toBeVisible();

  await page.keyboard.press('Escape');
  await page.waitForURL((u) => !u.pathname.includes('/shots/'));
  expect(await sentence(page)).toContain('a brief nobody asked to lose');

  // and the draft on disk is still that brief, not the overlay's empty one
  await page.reload();
  await line(page).waitFor();
  expect(await sentence(page)).toContain('a brief nobody asked to lose');
  // no phantom "picked up where you left off" for a draft the overlay wrote
  await expect(page.locator('.sc-target')).toHaveCount(0);
});

test('a scene inside an open shot starts a new shot rather than editing it', async ({ page }) => {
  // A scene is a fresh setup by definition. On the hub the branch chip lets go
  // to say so; inside a shot there is no chip to let go, so this used to run
  // as an edit of the picture on screen — the one thing it must not be.
  await expect(page.locator('.sc-cell').first()).toBeVisible();
  await page.locator('.sc-cell').first().click();
  await page.waitForURL(/\/shots\//);
  const editor = page.locator('.sc-ovl-edit');
  await expect(editor.locator('.sc-send')).toHaveAttribute('aria-label', 'Refine');

  await editor.locator('.sc-brief-line').click();
  await editor.locator('.sc-attach-toggle').click();
  await page.locator('.sc-ap-tabs button', { hasText: /scenes/i }).click();
  await attachCards(page).first().click();

  await expect(editor.locator('.sc-send')).toHaveAttribute('aria-label', 'Generate');
  await expect(page.locator('.sc-target-note-alone')).toHaveText('A scene starts a new shot.');
});

test('refining points at the version it just made, not the one it started from', async ({ page }) => {
  // "make it tighter" and then "now warmer" both used to run against the
  // original, so the second instruction quietly threw away the first.
  //
  // The version is fabricated rather than generated: a real one would leave a
  // shot and a finish notification behind in a brand every other spec shares,
  // and this case is about what the composer does with the id it is handed.
  const REFINED = 'refined-by-spec';
  let existingImage: string | null = null;
  // The version does not exist until the refine that makes it. Adding it to the
  // tree up front put a newer version on the shot before anyone asked for one,
  // and branching from a shot reaches for its newest version — so the chip
  // arrived already pointing at the answer and the case proved nothing.
  let refined = false;

  await page.route('**/api/brands/*/workspace', async (route) => {
    const res = await route.fetch();
    const ws = await res.json();
    const donor = (ws.nodes ?? []).find((n: any) => n.kind !== 'root' && n.status === 'done' && n.images.length);
    existingImage = donor?.images?.[0] ?? null;
    if (refined && donor && !(ws.nodes ?? []).some((n: any) => n.id === REFINED)) {
      ws.nodes.push({ ...donor, id: REFINED, parentId: donor.id, kind: 'edit', prompt: 'made it tighter' });
    }
    await route.fulfill({ response: res, json: ws });
  });
  await page.route('**/api/nodes', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    refined = true;
    await route.fulfill({
      status: 202,
      contentType: 'application/json',
      body: JSON.stringify({
        id: REFINED,
        parentId: null,
        kind: 'edit',
        prompt: 'made it tighter',
        engineId: 'demo',
        status: 'done',
        images: existingImage ? [existingImage] : [],
        costUsd: 0,
        kept: false,
        error: null,
        createdAt: new Date().toISOString(),
        overlays: {},
        brief: null,
        archived: false,
      }),
    });
  });

  await page.reload();
  await line(page).waitFor();
  await expect(page.locator('.sc-cell').first()).toBeVisible();
  await page.locator('.sc-cell').first().hover();
  await page.locator('.sc-cell-branch').first().click();

  const chip = page.locator('.sc-target');
  await expect(chip).toBeVisible();
  await expect(dock(page).locator('.sc-send')).toHaveAttribute('aria-label', 'Refine');
  // the chip's identity is the branch param, not its label: two refines of the
  // same wording produce two shots that read exactly alike
  const startedFrom = new URL(page.url()).searchParams.get('branch');
  expect(startedFrom).toBeTruthy();
  expect(startedFrom).not.toBe(REFINED);

  await line(page).click();
  await page.keyboard.type('make it tighter');
  await dock(page).locator('.sc-send').click();

  // the chip stays, and points at the new version rather than the old shot
  await expect.poll(() => new URL(page.url()).searchParams.get('branch'), { timeout: 10_000 }).toBe(REFINED);
  await expect(chip).toBeVisible();
});

test('a refine target does not follow you to a fresh Create', async ({ page }) => {
  // The target and the instruction typed for it are one conversation, held by
  // the URL. Persisting them meant a refine parked weeks ago hijacked every
  // later fresh Create into edit mode, across tabs, for thirty days.
  await expect(page.locator('.sc-cell').first()).toBeVisible();
  await page.locator('.sc-cell').first().hover();
  await page.locator('.sc-cell-branch').first().click();
  await expect(page.locator('.sc-target')).toBeVisible();

  await line(page).click();
  await page.keyboard.type('make it warmer');
  // outlive the 500ms draft debounce: this is exactly when the old code wrote
  // the target into localStorage
  await page.waitForTimeout(700);

  // leave the conversation, then start a genuinely fresh Create
  await page.goto('/');
  await page.waitForURL((u) => u.pathname.split('/').filter(Boolean).length === 1);
  await page.goto(`${new URL(page.url()).pathname}/create`);
  await line(page).waitFor();

  await expect(page.locator('.sc-target')).toHaveCount(0);
  expect(await sentence(page)).not.toContain('make it warmer');
});

test('a reload mid-refine keeps the target, not the unsent instruction', async ({ page }) => {
  // The URL owns the conversation: "branch, go look at something, come back"
  // survives a reload because `?branch=` does. The half-typed instruction is
  // session work and starts over.
  await expect(page.locator('.sc-cell').first()).toBeVisible();
  await page.locator('.sc-cell').first().hover();
  await page.locator('.sc-cell-branch').first().click();
  await expect(page.locator('.sc-target')).toBeVisible();

  await line(page).click();
  await page.keyboard.type('tighten the crop');
  await page.waitForTimeout(700);

  await page.reload();
  await line(page).waitFor();

  await expect(page.locator('.sc-target')).toBeVisible();
  expect(await sentence(page)).not.toContain('tighten the crop');
});

test('a version still rendering holds the button rather than making a new shot', async ({ page }) => {
  // Sending while the chip points at something unfinished would silently make
  // a new root shot — the one substitution this composer exists not to do. The
  // workspace is rewritten so the target reads as still running, which is the
  // state a real refine passes through too quickly to catch on the demo engine.
  const held = await page.evaluate(async () => {
    const slug = location.pathname.split('/')[1];
    const brands = await (await fetch('/api/brands')).json();
    const b = brands.find((x: any) => x.slug === slug);
    const ws = await (await fetch(`/api/brands/${b.id}/workspace`)).json();
    return (ws.nodes ?? []).find((n: any) => n.kind !== 'root' && n.status === 'done' && n.images.length)?.id ?? null;
  });
  expect(held).toBeTruthy();

  // that one shot now reads as still rendering, which is the state a real
  // refine passes through too quickly to catch on the demo engine
  await page.route('**/api/brands/*/workspace', async (route) => {
    const res = await route.fetch();
    const ws = await res.json();
    const n = (ws.nodes ?? []).find((x: any) => x.id === held);
    if (n) {
      n.status = 'running';
      n.images = [];
    }
    await route.fulfill({ response: res, json: ws });
  });

  await page.goto(`${new URL(page.url()).pathname}?branch=${held}`);
  await page.locator('.sc-brief-line').first().waitFor();
  await page.locator('.sc-brief-line').first().click();
  await page.keyboard.type('crop tighter');

  // No sentence any more: the chip's shimmer says it, and the held button's
  // own tooltip explains itself. The hold is the contract being tested.
  await expect(page.locator('.sc-target-note')).toHaveCount(0);
  await expect(dock(page).locator('.sc-send')).toHaveAttribute('aria-disabled', 'true');
  await expect(dock(page).locator('.sc-send')).toHaveAttribute('title', /Wait for this version to finish/);
});

test('scenes sit out while a refine is armed, and come back when it ends', async ({ page }) => {
  // A scene starts a new shot, so letting one land mid-refine silently traded
  // the armed refine for a chip — a mode flip as a click's side effect. The
  // panel now says so instead: cards visible, dimmed, disabled, with the way
  // out written above them. Ending the refine restores them.
  await expect(page.locator('.sc-cell').first()).toBeVisible();
  await page.locator('.sc-cell').first().hover();
  await page.locator('.sc-cell-branch').first().click();
  await expect(page.locator('.sc-target')).toBeVisible();

  await page.locator('.sc-attach-toggle').first().click();
  await page.locator('.sc-ap-tabs button', { hasText: /scenes/i }).click();
  await expect(page.locator('.sc-ap-hint')).toContainText('sit out while you are refining');
  await expect(attachCards(page).first()).toBeDisabled();

  // X on the refine chip ends it (the click outside also closes the panel);
  // reopened, the catalog is back in business with no hint
  await page.locator('.sc-target-chip button').click();
  await expect(page.locator('.sc-target')).toHaveCount(0);
  await page.locator('.sc-attach-toggle').first().click();
  await page.locator('.sc-ap-tabs button', { hasText: /scenes/i }).click();
  await expect(page.locator('.sc-ap-hint')).toHaveCount(0);
  await expect(attachCards(page).first()).toBeEnabled();
});

test('arming a refine lets a lingering scene chip go', async ({ page }) => {
  // The other direction stays: a scene chip in a FRESH sentence loses to an
  // explicit Refine press on a card — it used to be refused over and over
  // until the chip was removed by hand.
  await page.locator('.sc-attach-toggle').first().click();
  await page.locator('.sc-ap-tabs button', { hasText: /scenes/i }).click();
  await attachCards(page).first().click();
  await expect(line(page).locator('.sc-token[data-kind="template"]')).toHaveCount(1);

  await page.keyboard.press('Escape');
  await expect(page.locator('.sc-attachpanel')).toHaveCount(0);
  await page.locator('.sc-cell').first().hover();
  await page.locator('.sc-cell-branch').first().click();
  await expect(page.locator('.sc-target')).toBeVisible();
  await expect(line(page).locator('.sc-token[data-kind="template"]')).toHaveCount(0);
  await expect(dock(page).locator('.sc-send')).toHaveAttribute('aria-label', 'Refine');
});

// The ceiling is engine-independent, so the demo engine can prove it: twelve
// identities go in, the thirteenth card sits out with the sentence that says
// why, and the door refuses it the same way.
test('the thirteenth identity is refused, and the panel says why', async ({ page }) => {
  await dock(page).locator('.sc-attach-toggle').click();
  const tab = (name: string) => page.locator('.sc-ap-tabs button', { hasText: name });
  await tab('Products').click();
  const cards = attachCards(page);
  expect(await cards.count()).toBeGreaterThanOrEqual(13);
  for (let i = 0; i < 12; i++) {
    await cards.nth(i).click();
    await expect(chips(page)).toHaveCount(i + 1);
  }
  await expect(cards.nth(12)).toBeDisabled();
  // the reason rides on hover, so the grid never moves to explain itself
  await cards.nth(12).hover();
  await expect(page.getByRole('tooltip')).toContainText('Remove one to add another');
  await expect(page.locator('.sc-ap-hint')).toHaveCount(0);
  // a colour is not an identity and still goes in
  await tab('Colors').click();
  await expect(page.locator('.sc-ap-hint')).toHaveCount(0);
  await expect(attachCards(page).first()).toBeEnabled();
  await attachCards(page).first().click();
  await expect(chips(page)).toHaveCount(13);
  // and an identity removed reopens the door: the keyboard path every other
  // test uses, since the chip's x is a pointer-only, hover-revealed control.
  // The caret goes to the end without a pointer: a click into a three-row
  // line lands wherever its centre is, and that was a chip's x. One press
  // per chip: the colour, last and not an identity, then the twelfth identity.
  await line(page).evaluate((el) => {
    el.focus();
    const r = document.createRange();
    r.setStart(el, el.childNodes.length);
    r.collapse(true);
    const sel = getSelection()!;
    sel.removeAllRanges();
    sel.addRange(r);
  });
  await page.keyboard.press('Backspace');
  await expect(chips(page)).toHaveCount(12);
  await page.keyboard.press('Backspace');
  await expect(chips(page)).toHaveCount(11);
  // nothing clicked outside the panel, so it is still open
  await tab('Products').click();
  await expect(attachCards(page).nth(12)).toBeEnabled();
});

test('typing after a chip added from the plus menu', async ({ page }) => {
  await page.keyboard.type('change the background color of this ');
  await plusMenu(page, /shots/i);
  await pickCard(page);
  await page.keyboard.type('to warm beige');
  expect(await sentence(page)).toMatch(/Shot\s*to warm beige$/);
});

test('a chip lands at the caret, not at the end', async ({ page }) => {
  await page.keyboard.type('shoot it in golden light');
  // put the caret after "shoot it"
  for (let i = 0; i < ' in golden light'.length; i++) await page.keyboard.press('ArrowLeft');
  await plusMenu(page, /product/i);
  await pickCard(page);
  await page.keyboard.type('X');
  const text = await sentence(page);
  expect(text.startsWith('shoot it')).toBe(true);
  expect(text).toMatch(/X\s*in golden light$/); // typing carried on after the chip
});

test('$ reaches for a product and typing carries on', async ({ page }) => {
  await page.keyboard.type('put the ');
  await page.keyboard.type('$');
  await expect(page.locator('.sc-cmd-group')).toHaveText('Products');
  await page.locator('.sc-cmd-row').first().click();
  expect(await chips(page).first().getAttribute('data-tok')).toMatch(/^p:/);
  await page.keyboard.type('on ice');
  const text = await sentence(page);
  expect(text).not.toContain('$');
  expect(text).toMatch(/on ice$/);
});

test('/ reaches for a scene and typing carries on', async ({ page }) => {
  await page.keyboard.type('in ');
  await page.keyboard.type('/');
  await expect(page.locator('.sc-cmd-group')).toHaveText('Scenes');
  await page.locator('.sc-cmd-row').first().click();
  expect(await chips(page).first().getAttribute('data-tok')).toMatch(/^t:/);
  await page.keyboard.type('at dawn');
  const text = await sentence(page);
  expect(text).not.toContain('/');
  expect(text).toMatch(/at dawn$/);
});

test('@ reaches for a presenter and typing carries on', async ({ page }) => {
  await page.keyboard.type('with ');
  await page.keyboard.type('@');
  await expect(page.locator('.sc-cmd-group')).toHaveText('Presenters');
  await page.locator('.sc-cmd-row').first().click();
  expect(await chips(page).first().getAttribute('data-tok')).toMatch(/^h:/);
  await page.keyboard.type('on ice');
  const text = await sentence(page);
  expect(text).not.toContain('@');
  expect(text).toMatch(/on ice$/);
});

test('# reaches for a colour', async ({ page }) => {
  await page.keyboard.type('a shot ');
  await page.keyboard.type('#');
  await expect(page.locator('.sc-cmd-group', { hasText: 'Colors' })).toBeVisible();
  await expect(page.locator('.sc-cmd-group', { hasText: 'Scenes' })).toHaveCount(0);
  await expect(page.locator('.sc-cmd-swatch').first()).toBeVisible();
  await page.locator('.sc-cmd-row').first().click();
  await page.keyboard.type('at dawn');
  expect(await chips(page).first().getAttribute('data-tok')).toMatch(/^c:/);
  expect(await sentence(page)).toMatch(/at dawn$/);
});

test('a hex colour is text, not a scene query', async ({ page }) => {
  await page.keyboard.type('keep the cap #F5C518 exactly');
  // the menu must not be open, and nothing may have been eaten
  await expect(page.locator('.sc-cmd')).toHaveCount(0);
  const chip = chips(page).first();
  await expect(chip).toHaveAttribute('data-kind', 'color');
  expect(await chip.getAttribute('data-tok')).toMatch(/^c:#F5C518/);
  expect(await sentence(page)).toMatch(/keep the cap /);
  expect(await sentence(page)).toMatch(/exactly/);
});

test('a typed hex chip opens the picker from its custom row', async ({ page }) => {
  await page.keyboard.type('#ffffff');
  await expect(chips(page)).toHaveCount(1);
  await expect(chips(page).first()).toHaveAttribute('data-kind', 'color');
  await openPicker(page);
  await expect(pick(page)).toHaveAttribute('data-kind', 'color');
  const first = page.locator('.sc-swap-swatches .sc-swap-swatch').first();
  await expect(first).toHaveAttribute('data-on');
  await expect(first.locator('b')).toHaveText('#FFFFFF');
  await first.click();
  await expect(page.locator('.sc-cp')).toBeVisible();
});

test('Custom colour live-updates the chip without closing the menu', async ({ page }) => {
  await page.keyboard.type('#ffffff');
  await openPicker(page);
  await page.locator('.sc-swap-custom').click();
  await expect(page.locator('.sc-cp')).toBeVisible();
  await page.locator('.sc-cp-hex').fill('#00FF00');
  expect(await chips(page).first().getAttribute('data-tok')).toMatch(/^c:#00FF00/i);
  await expect(pick(page)).toBeVisible();
  await expect(page.locator('.sc-cp')).toBeVisible();
});

test('an email keeps its @', async ({ page }) => {
  await page.keyboard.type('credit tony@example.com in the corner');
  await expect(page.locator('.sc-cmd')).toHaveCount(0);
  expect(await sentence(page)).toContain('tony@example.com');
});

test('clicking moves the caret, before and after a chip', async ({ page }) => {
  await page.keyboard.type('alpha bravo ');
  await plusMenu(page, /product/i);
  await pickCard(page);
  await page.keyboard.type('charlie delta');

  // node 0 is "alpha bravo ", node 1 the chip, node 2 the text after it
  await clickAtChar(page, 0, 6); // just before "bravo"
  await page.keyboard.type('#');
  expect(await sentence(page)).toMatch(/^alpha #bravo/);

  await clickAtChar(page, 2, 8); // inside "charlie delta", right before "delta"
  await page.keyboard.type('@');
  expect(await sentence(page)).toMatch(/charlie @delta/);
});

test('backspace over a chip removes it and leaves one space', async ({ page }) => {
  await page.keyboard.type('one ');
  await plusMenu(page, /product/i);
  await pickCard(page);
  await page.keyboard.type('two');
  await expect(chips(page)).toHaveCount(1);

  // walk back over "two" to sit flush after the chip, then one Backspace takes it
  for (let i = 0; i < 'two'.length; i++) await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Backspace');
  await expect(chips(page)).toHaveCount(0);
  expect(await sentence(page)).not.toMatch(/ {2}/);
});

test('changing aspect and resolution does not disturb the sentence', async ({ page }) => {
  // A desktop composer has the room to state all three settings, so each has
  // its own control in the row. What is under test either way is the caret:
  // changing a setting must not repaint the sentence or steal the place you
  // were typing.
  await page.keyboard.type('a careful sentence');
  const pills = () => dock(page).locator('.sc-prompt-pills');
  // scoped to the open surface on purpose: all three shells render at once, so
  // the sheet's and More's own options answer to [role=radio] as well
  const open = () => page.locator('.sc-setpop');

  await pills().locator('[aria-label^="Aspect"]').click();
  await open().getByRole('radio', { name: /9:16/ }).click();
  // the surface hands the caret back as it closes, so typing before it has gone
  // puts the next keystroke somewhere nobody asked for
  await expect(open()).toHaveCount(0);
  await page.keyboard.type(' more');

  await pills().locator('[aria-label^="Resolution"]').click();
  await open().getByRole('radio', { name: /^High/ }).click();
  await expect(open()).toHaveCount(0);
  await page.keyboard.type(' still');

  // the sentence never repainted, and the caret came back both times
  expect(await sentence(page)).toBe('a careful sentence more still');
  expect(await page.evaluate(() => localStorage.getItem('scenri:format'))).toBe('"story"');
  expect(await page.evaluate(() => localStorage.getItem('scenri:quality'))).toBe('"high"');
});

test('a settings surface opens without painting a focus ring', async ({ page }) => {
  // Radix focuses the first tabbable thing in a surface it opens, which is the
  // option already set. That matched :focus-visible, so every picker opened
  // with the mouse arrived with the app's 2px ring drawn on it. The group takes
  // the focus instead, and the ring waits for an arrow key.
  await dock(page).locator('.sc-prompt-pills [aria-label^="Aspect"]').click();
  const pop = page.locator('.sc-setpop');
  await expect(pop).toBeVisible();
  expect(await pop.locator('[role="radio"]').evaluateAll((els) => els.some((e) => e.matches(':focus-visible')))).toBe(
    false,
  );

  // an arrow moves the choice and the focus together, the way a radio group does
  await page.keyboard.press('ArrowDown');
  await expect(pop.locator('[role="radio"][aria-checked="true"]')).toBeFocused();
  expect(await page.evaluate(() => localStorage.getItem('scenri:format'))).toBe('"portrait"');
});

test('one open picker gives way to the next on a single click', async ({ page }) => {
  // Each setting is its own Radix root. The open one used to treat a press on a
  // neighbouring trigger as an interaction outside itself and dismiss on the
  // very gesture that was opening the neighbour, so two layers raced over one
  // click: often the surface asked for opened and shut in the same frame, and
  // the control read as needing to be pressed twice.
  const pills = dock(page).locator('.sc-prompt-pills .sc-var');
  const open = page.locator('.sc-setpop[data-state="open"]');

  for (const i of [2, 0, 1, 2, 1, 0]) {
    await pills.nth(i).click();
    await expect(open, `control ${i} did not end up open`).toHaveCount(1);
    // and still open a few frames later, rather than opened and shut at once
    await page.waitForTimeout(200);
    await expect(open, `control ${i} opened and closed again`).toHaveCount(1);
  }
});

test('a picker closes on its own trigger, and on a click away from the row', async ({ page }) => {
  const pill = dock(page).locator('.sc-prompt-pills .sc-var').first();
  const open = page.locator('.sc-setpop[data-state="open"]');

  for (let i = 0; i < 3; i++) {
    await pill.click();
    await expect(open, `cycle ${i} open`).toHaveCount(1);
    await pill.click();
    await expect(open, `cycle ${i} shut by its own trigger`).toHaveCount(0);
  }

  await pill.click();
  await expect(open).toHaveCount(1);
  // somewhere the picker is not covering: it opens upward, over the brief
  await page.mouse.click(24, 200);
  await expect(open, 'a click away from the row still dismisses').toHaveCount(0);
});

test('a picker on its way out takes no clicks with it', async ({ page }) => {
  // Radix keeps the content mounted until the exit animation ends. For those
  // frames it was a full-size box with live pointer events over the composer,
  // and whatever was clicked next landed on a picker that had already gone.
  await dock(page).locator('.sc-prompt-pills .sc-var').first().click();
  await expect(page.locator('.sc-setpop[data-state="open"]')).toHaveCount(1);
  await page.keyboard.press('Escape');

  const live = await page.locator('.sc-setpop[data-state="closed"]').evaluateAll((els) =>
    els
      .map((e) => ({
        content: getComputedStyle(e).pointerEvents,
        wrapper: getComputedStyle(e.parentElement as HTMLElement).pointerEvents,
      }))
      .filter((s) => s.content !== 'none' || s.wrapper !== 'none'),
  );
  expect(live, 'a closing picker still takes pointer events').toEqual([]);
});

test('the composer and the compiler agree on the four shapes', async ({ page }) => {
  // Two hardcoded copies of the same list, one per package, and nothing can
  // import across them: the studio depends on neither @scenri/core nor
  // @scenri/cli. A shape the composer offers that the compiler sizes
  // differently is a picture that comes back the wrong shape, so both are
  // checked against one written-down answer here.
  const SHAPES = [
    { id: 'square', hint: '1:1', w: 1024, h: 1024 },
    { id: 'portrait', hint: '4:5', w: 1024, h: 1280 },
    { id: 'story', hint: '9:16', w: 1080, h: 1920 },
    { id: 'landscape', hint: '16:9', w: 1600, h: 900 },
  ];

  const server: { id: string; w: number; h: number }[] = await page.evaluate(async () =>
    (await fetch('/api/formats')).json(),
  );
  const byId = new Map(server.map((f) => [f.id, f]));
  expect(byId.size, 'the compiler ships a different number of shapes').toBe(SHAPES.length);
  for (const want of SHAPES) {
    expect(byId.get(want.id), `the compiler has no ${want.id}`).toBeTruthy();
    expect([byId.get(want.id)?.w, byId.get(want.id)?.h], `${want.id} is a different size in the compiler`).toEqual([
      want.w,
      want.h,
    ]);
  }

  // and the composer offers exactly those, in the order the picker draws them
  await dock(page).locator('.sc-prompt-pills [aria-label^="Aspect"]').click();
  const rows = page.locator('.sc-setpop [role="radio"]');
  await expect(rows).toHaveCount(SHAPES.length);
  expect(await rows.evaluateAll((els) => els.map((e) => e.getAttribute('data-id')))).toEqual(SHAPES.map((f) => f.id));
  expect(
    await page.locator('.sc-setpop .sc-setrow-v').evaluateAll((els) => els.map((e) => e.textContent?.trim())),
  ).toEqual(SHAPES.map((f) => f.hint));
});

test('copy and paste rebuilds the chips', async ({ page }) => {
  await page.keyboard.type('hero of ');
  await plusMenu(page, /product/i);
  await pickCard(page);
  await page.keyboard.type('at dusk');
  const original = await sentence(page);

  // copied, cleared, pasted back: the chip comes back as a chip
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('ControlOrMeta+c');
  await page.keyboard.press('Backspace');
  await expect(chips(page)).toHaveCount(0);
  await page.keyboard.press('ControlOrMeta+v');

  await expect(chips(page)).toHaveCount(1);
  expect(await sentence(page)).toContain(original.trim());
});

test('pasting a brief back into itself grows no twin', async ({ page }) => {
  // One chip per thing is the door rule for the menu, the panel and the rail;
  // the paste used to be the one door without it, and the whole brief pasted
  // at its own end doubled every chip, every time.
  await page.keyboard.type('hero of ');
  await plusMenu(page, /product/i);
  await pickCard(page);
  await page.keyboard.type('at dusk');

  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('ControlOrMeta+c');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ControlOrMeta+v');
  await page.keyboard.press('ControlOrMeta+v');

  await expect(chips(page)).toHaveCount(1);
  // the words still paste; only the twin does not
  expect((await sentence(page)).match(/at dusk/g)?.length).toBe(3);
});

test('a second scene swaps in place instead of stacking', async ({ page }) => {
  await page.keyboard.type('mood: ');
  await plusMenu(page, /scenes/i);
  await pickCard(page, 0);
  await expect(chips(page)).toHaveCount(1);
  const first = await chips(page).first().textContent();

  await plusMenu(page, /scenes/i);
  await pickCard(page, 2);
  await expect(chips(page)).toHaveCount(1);
  expect(await chips(page).first().textContent()).not.toBe(first);
  expect(await sentence(page)).toMatch(/^mood: /); // it kept its slot
});

/**
 * A scene is the one ingredient that arrives on its own, from a link. On its
 * own it is a seed nobody built on, so it is not a draft: it used to be saved
 * and then restored silently on every later cold load, which is how a scene
 * nobody had chosen turned up in the composer days later.
 */
test('a scene on its own is not a draft to come back to', async ({ page }) => {
  await plusMenu(page, /scenes/i);
  await pickCard(page, 0);
  await expect(chips(page)).toHaveCount(1);

  await page.reload();
  await line(page).waitFor();
  await expect(chips(page)).toHaveCount(0);
});

/**
 * And the `?scene=` it arrived from is spent once it lands. It used to sit in
 * the address bar until something was sent, so the next mount re-applied it:
 * removing the chip and reloading handed the same chip straight back.
 *
 * Arrives on the whole URL Home's compose card builds rather than the seed
 * alone, because `?compose=` clears itself in a second param write beside this
 * one, and the two have to agree about what is left.
 */
test('a seeded scene leaves the URL behind, and stays removed', async ({ page }) => {
  const base = new URL(page.url()).pathname;
  await page.goto(`${base}?scene=action-motion-freeze&attach=products&compose=1`);
  await line(page).waitFor();
  await expect(chips(page)).toHaveCount(1);
  await expect.poll(() => new URL(page.url()).searchParams.get('scene')).toBeNull();
  await expect.poll(() => new URL(page.url()).searchParams.get('compose')).toBeNull();

  await line(page).click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('Backspace');
  await expect(chips(page)).toHaveCount(0);

  await page.reload();
  await line(page).waitFor();
  await expect(chips(page)).toHaveCount(0);
});

test('clicking a chip puts the caret beside it, never inside it', async ({ page }) => {
  await page.keyboard.type('AAAA ');
  await plusMenu(page, /product/i);
  await pickCard(page);
  await page.keyboard.type('BBBB');

  const box = (await chips(page).first().boundingBox())!;
  // the middle of the chip: the caret belongs after it, not in its label
  await page.mouse.click(box.x + box.width * 0.55, box.y + box.height / 2);
  await page.keyboard.press('Escape'); // the chip's own picker opened too
  await expect(page.locator('.sc-swap')).toHaveCount(0);
  expect(
    await page.evaluate(() => {
      const n = getSelection()?.anchorNode as Node | null;
      return !!n?.parentElement?.closest('.sc-token');
    }),
  ).toBe(false);
  await page.keyboard.type('X');
  expect(await sentence(page)).toMatch(/can\s*XBBBB$/);

  // and the left few pixels reach the caret in front of it
  const box2 = (await chips(page).first().boundingBox())!;
  await page.mouse.click(box2.x + 2, box2.y + box2.height / 2);
  await page.keyboard.type('Z');
  expect(await sentence(page)).toMatch(/^AAAA Z/);
});

test('clicking in the gap after a chip lands after it, not in front of it', async ({ page }) => {
  await page.keyboard.type('test ');
  await plusMenu(page, /product/i);
  await pickCard(page);
  await page.keyboard.type('sdfsdf sdf sdf');
  await page.keyboard.press('Escape');

  // The few pixels between a chip and the text after it: Chromium resolves
  // this point to the position BEFORE the chip, tens of pixels the other way,
  // which threw the caret back in front of the chip on every click.
  for (const dx of [2, 6, 10]) {
    const pt = await page.evaluate((d) => {
      const cr = document.querySelector('.sc-token')!.getBoundingClientRect();
      return { x: cr.right + (d as number), y: cr.top + cr.height / 2 };
    }, dx);
    await page.mouse.click(pt.x, pt.y);
    const side = await page.evaluate(() => {
      const r = getSelection()!.getRangeAt(0);
      const chip = document.querySelector('.sc-token')!;
      // DOCUMENT_POSITION_FOLLOWING means the caret's node comes after the chip
      return (chip.compareDocumentPosition(r.startContainer) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    });
    expect(side, `click ${dx}px past the chip should land after it`).toBe(true);
  }

  // and back in the gap itself, typing lands immediately after the chip
  const gap = await page.evaluate(() => {
    const cr = document.querySelector('.sc-token')!.getBoundingClientRect();
    return { x: cr.right + 3, y: cr.top + cr.height / 2 };
  });
  await page.mouse.click(gap.x, gap.y);
  await page.keyboard.type('!');
  expect(await sentence(page)).toMatch(/can\s*!sdfsdf/);
});

test('every point in the card puts the caret where it was clicked', async ({ page }) => {
  await page.keyboard.type('test ');
  await plusMenu(page, /product/i);
  await pickCard(page);
  await page.keyboard.type('sdfsdf sdf sdf');
  await page.keyboard.press('Escape');

  /*
   * The whole card, not just the exact text row. Two things used to break here:
   * the line was a flex container, so the gaps between its items belonged to no
   * text node, and the card's padding was not part of the editable at all. A
   * click a few pixels off the text threw the caret to the front of the brief.
   */
  const points = await page.evaluate(() => {
    const card = document.querySelector('.sc-brief')!.getBoundingClientRect();
    const c = document.querySelector('.sc-token')!.getBoundingClientRect();
    const mid = c.top + c.height / 2;
    return {
      'gap after the chip': { x: c.right + 4, y: mid },
      'high in the row': { x: c.right + 4, y: c.top - 4 },
      'low in the row': { x: c.right + 4, y: c.bottom + 3 },
      'the padding above the text': { x: c.right + 4, y: card.top + 3 },
    };
  });

  for (const [label, pt] of Object.entries(points)) {
    await page.mouse.click(pt.x, pt.y);
    await page.keyboard.press('Escape');
    const after = await page.evaluate(() => {
      const r = getSelection()!.getRangeAt(0);
      const chip = document.querySelector('.sc-token')!;
      return (chip.compareDocumentPosition(r.startContainer) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    });
    expect(after, `${label} should land after the chip`).toBe(true);
  }

  // and the empty stretch after the sentence means the end of it
  const far = await page.evaluate(() => {
    const card = document.querySelector('.sc-brief')!.getBoundingClientRect();
    const c = document.querySelector('.sc-token')!.getBoundingClientRect();
    return { x: card.right - 30, y: c.top + c.height / 2 };
  });
  await page.mouse.click(far.x, far.y);
  await page.keyboard.type('!');
  expect(await sentence(page)).toMatch(/sdf!$/);
});

test('clicking the body of a chip opens its picker, not the caret menu', async ({ page }) => {
  await page.keyboard.type('with ');
  await plusMenu(page, /product/i);
  await pickCard(page);
  await page.keyboard.press('Escape');
  await openPicker(page);
  await expect(pick(page)).toHaveAttribute('data-kind', 'product');
  await expect(cards(page).first()).toBeVisible();
  // the two surfaces are exclusive: a chip is a catalog, not a command list
  await expect(page.locator('.sc-cmd')).toHaveCount(0);
});

/**
 * Asking a refinement for a different shape.
 *
 * An edit request carries no width or height, so a refinement cannot reshape a
 * picture. The aspect control used to vanish in refine mode because of that,
 * which left "I want this shot at 16:9" with no answer in the place it was
 * asked — the answer lived behind a differently-named button two blocks away.
 * The control stays now and means what it says: a new shape runs the same setup
 * again at that shape, as a new shot, and the composer says so before you send.
 */
test('a new shape while refining expands the shot rather than replacing it', async ({ page }) => {
  const brand = new URL(page.url()).pathname.split('/')[1];

  /*
   * Nothing here makes a picture.
   *
   * `reshaping` is a decision the composer makes on its own, by comparing the
   * shape you have chosen against the one recorded on the shot it is pointed
   * at — so the shot's recorded shape is the only input this needs, and the
   * workspace response is the honest place to put it. Generating a real one
   * instead left a just-finished shot behind, and three notification cases two
   * files away then failed on an unread badge that was not theirs: they clear
   * the stored record, the app re-derives it from the server, and my shot came
   * back as somebody else's unread news.
   */
  let shot = '';
  await page.route('**/workspace', async (route) => {
    const res = await route.fetch();
    const ws = await res.json();
    const done = (ws.nodes ?? []).find((n: any) => n.kind !== 'root' && n.status === 'done' && n.images?.length);
    if (done) {
      shot = done.id;
      done.brief = { ...(done.brief ?? { tokens: [] }), format: 'square' };
    }
    await route.fulfill({ response: res, json: ws });
  });

  await page.goto(`/${brand}/create`);
  await expect.poll(() => shot).not.toBe('');

  await page.goto(`/${brand}/create/shots/${shot}`);
  const composer = page.locator('.sc-ovl-edit');
  await expect(composer.locator('.sc-brief-line')).toBeVisible();

  // pointed at the shot, this is a refinement
  await expect(composer.locator('.sc-send')).toContainText('Refine');

  // the shape is offered here, and choosing a new one changes what send means
  await composer.locator('.sc-more').click();
  await page.locator('.sc-morepop .sc-seg-o').filter({ hasText: '16:9' }).first().click();
  await page.keyboard.press('Escape');

  // it stays a refinement: the shape is reached by growing this picture, not
  // by running the brief again and getting a different one. The op is
  // INFERRED from the geometry — no buttons, no tutorial copy — and the two
  // word state line makes the consequence predictable before Refine.
  await expect(composer.locator('.sc-send')).toContainText('Refine');
  await expect(composer.locator('.sc-reshape-hint')).toHaveText('Will extend to Landscape 16:9');
  await expect(composer.locator('.sc-reshape')).toHaveCount(0);

  // the send is caught and answered here rather than allowed to make a picture
  let posted: any = null;
  await page.route('**/api/nodes', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    posted = route.request().postDataJSON();
    await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'not today' }) });
  });
  await composer.locator('.sc-brief-line').click();
  await page.keyboard.type('same setup, wider frame');
  await composer.locator('.sc-send').click();

  await expect.poll(() => posted?.kind).toBe('edit');
  expect(posted.brief.format).toBe('landscape');
  // a child of the shot on screen, carrying the frame it was made from: the
  // server grows that picture rather than starting another one — and the op
  // rides on the wire by name, never inferred
  expect(posted.parentId).toBe(shot);
  expect(posted.sourceImage).toBeTruthy();
  expect(posted.reshape).toBe('extend');
});

test('a squarer shape while refining infers a crop, and sends it with no words at all', async ({ page }) => {
  const brand = new URL(page.url()).pathname.split('/')[1];

  // the same trick as the expand test: the shot's recorded shape is the only
  // input the composer needs, so the workspace response carries it
  let shot = '';
  await page.route('**/workspace', async (route) => {
    const res = await route.fetch();
    const ws = await res.json();
    const done = (ws.nodes ?? []).find((n: any) => n.kind !== 'root' && n.status === 'done' && n.images?.length);
    if (done) {
      shot = done.id;
      done.brief = { ...(done.brief ?? { tokens: [] }), format: 'landscape' };
    }
    await route.fulfill({ response: res, json: ws });
  });

  await page.goto(`/${brand}/create`);
  await expect.poll(() => shot).not.toBe('');
  await page.goto(`/${brand}/create/shots/${shot}`);
  const composer = page.locator('.sc-ovl-edit');
  await expect(composer.locator('.sc-brief-line')).toBeVisible();

  // 16:9 asked to be 1:1 infers the crop, and says so in two words
  await composer.locator('.sc-more').click();
  await page.locator('.sc-morepop .sc-seg-o').filter({ hasText: '1:1' }).first().click();
  await page.keyboard.press('Escape');
  await expect(composer.locator('.sc-reshape-hint')).toHaveText('Will crop to Square 1:1');

  // words and a crop cannot travel together, and the block says so out loud
  await composer.locator('.sc-brief-line').click();
  await page.keyboard.type('and make it warmer');
  await expect(composer.locator('.sc-send')).toHaveAttribute('aria-disabled', 'true');
  await expect(composer.locator('.sc-send')).toHaveAttribute('title', /a crop uses no words/);

  // the honest escape hatch: keep the current shape and the words send as a
  // plain refine again
  await composer.locator('.sc-more').click();
  await page.locator('.sc-morepop .sc-seg-o').filter({ hasText: '16:9' }).first().click();
  await page.keyboard.press('Escape');
  await expect(composer.locator('.sc-send')).not.toHaveAttribute('aria-disabled');

  // back to the crop, words cleared: sendable with the brief exactly as empty
  // as it stands
  await composer.locator('.sc-more').click();
  await page.locator('.sc-morepop .sc-seg-o').filter({ hasText: '1:1' }).first().click();
  await page.keyboard.press('Escape');
  await composer.locator('.sc-brief-line').click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.press('Backspace');
  await expect(composer.locator('.sc-send')).not.toHaveAttribute('aria-disabled');

  let posted: any = null;
  await page.route('**/api/nodes', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    posted = route.request().postDataJSON();
    await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'not today' }) });
  });
  await composer.locator('.sc-send').click();
  await expect.poll(() => posted?.kind).toBe('edit');
  expect(posted.reshape).toBe('crop');
  expect(posted.brief.format).toBe('square');
  expect(posted.parentId).toBe(shot);
});

test('an orientation flip is further than one extend can reach, and the hint says crop', async ({ page }) => {
  const brand = new URL(page.url()).pathname.split('/')[1];

  let shot = '';
  await page.route('**/workspace', async (route) => {
    const res = await route.fetch();
    const ws = await res.json();
    const done = (ws.nodes ?? []).find((n: any) => n.kind !== 'root' && n.status === 'done' && n.images?.length);
    if (done) {
      shot = done.id;
      done.brief = { ...(done.brief ?? { tokens: [] }), format: 'landscape' };
    }
    await route.fulfill({ response: res, json: ws });
  });

  await page.goto(`/${brand}/create`);
  await expect.poll(() => shot).not.toBe('');
  await page.goto(`/${brand}/create/shots/${shot}`);
  const composer = page.locator('.sc-ovl-edit');
  await expect(composer.locator('.sc-brief-line')).toBeVisible();

  // 16:9 asked to be 9:16 is a 3.16x growth, past what one extend can draw;
  // the classifier answers crop and the hint promises exactly what the
  // server will do, instead of an extend that could only come back as mush
  await composer.locator('.sc-more').click();
  await page.locator('.sc-morepop .sc-seg-o').filter({ hasText: '9:16' }).first().click();
  await page.keyboard.press('Escape');
  await expect(composer.locator('.sc-reshape-hint')).toHaveText('Will crop to Story 9:16');

  let posted: any = null;
  await page.route('**/api/nodes', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    posted = route.request().postDataJSON();
    await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'not today' }) });
  });
  await composer.locator('.sc-send').click();
  await expect.poll(() => posted?.kind).toBe('edit');
  expect(posted.reshape).toBe('crop');
  expect(posted.brief.format).toBe('story');
});

/**
 * A shape chosen while refining belongs to the shot it was chosen on.
 *
 * It used to belong to the machine: one localStorage pref, shared by the dock,
 * by this composer inside every open shot, and by every tab. So asking one shot
 * for 16:9 made 16:9 the shape the NEXT shot opened at — and because the
 * composer reads a shape that differs from the shot's own as a reshape, a
 * refinement nobody had asked to reframe went out as an extend of a 4:5 picture
 * into 16:9. The shape now comes from the shot in front of you.
 */
test('a shape chosen while refining one shot does not follow you to the next', async ({ page }) => {
  const brand = new URL(page.url()).pathname.split('/')[1];

  /*
   * Two shots of different shapes, from the one the harness seeded: the shape
   * the composer reads is the shape the workspace reports, so the second shot
   * is that answer with a new id and a different recorded format. Routed on the
   * CONTEXT rather than the page, so the second tab below is answered too.
   */
  let a = '';
  let b = '';
  await page.context().route('**/workspace', async (route) => {
    const res = await route.fetch();
    const ws = await res.json();
    const nodes = ws.nodes ?? [];
    const i = nodes.findIndex((n: any) => n.kind !== 'root' && n.status === 'done' && n.images?.length);
    if (i >= 0) {
      const shot = nodes[i];
      a = shot.id;
      b = `${shot.id}-b`;
      shot.brief = { ...(shot.brief ?? { tokens: [] }), format: 'square' };
      // a sibling, so the overlay's own Next version steps between the two
      // without a reload: the bug's worst case is one mounted composer walking
      // from shot to shot, which no amount of remounting would have caught
      nodes.splice(i + 1, 0, { ...shot, id: b, brief: { ...shot.brief, format: 'portrait' } });
    }
    await route.fulfill({ response: res, json: ws });
  });

  await page.goto(`/${brand}/create`);
  await expect.poll(() => a).not.toBe('');

  await page.goto(`/${brand}/create/shots/${a}`);
  const composer = page.locator('.sc-ovl-edit');
  await expect(composer.locator('.sc-brief-line')).toBeVisible();
  // it opens on the shape the shot already is, not on whatever was last picked
  await expect(composer.locator('.sc-more')).toHaveAttribute('aria-label', 'Shot settings. Aspect Square 1:1');
  await expect(composer.locator('.sc-reshape-hint')).toHaveCount(0);

  // ask THIS shot for a wider frame
  await composer.locator('.sc-more').click();
  await page.locator('.sc-morepop .sc-seg-o').filter({ hasText: '16:9' }).first().click();
  await page.keyboard.press('Escape');
  await expect(composer.locator('.sc-reshape-hint')).toHaveText('Will extend to Landscape 16:9');

  // step to the 4:5 shot, in the same mounted composer
  await page.locator('.sc-ovl-bar [aria-label="Next version"]').click();
  await expect(page).toHaveURL(new RegExp(`/shots/${b}$`));
  await expect(composer.locator('.sc-more')).toHaveAttribute('aria-label', 'Shot settings. Aspect Portrait 4:5');
  // and nothing is being reshaped, because nothing was asked of this one
  await expect(composer.locator('.sc-reshape-hint')).toHaveCount(0);

  // what it sends is its own shape, and no reshape op at all
  let posted: any = null;
  await page.route('**/api/nodes', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    posted = route.request().postDataJSON();
    await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'not today' }) });
  });
  await composer.locator('.sc-brief-line').click();
  await page.keyboard.type('warmer light');
  await composer.locator('.sc-send').click();
  await expect.poll(() => posted?.kind).toBe('edit');
  expect(posted.brief.format).toBe('portrait');
  expect(posted.reshape).toBeUndefined();
  expect(posted.parentId).toBe(b);

  // back to the first shot: its own 16:9 is still there, unmoved by the second
  await page.locator('.sc-ovl-bar [aria-label="Previous version"]').click();
  await expect(page).toHaveURL(new RegExp(`/shots/${a}$`));
  await expect(composer.locator('.sc-more')).toHaveAttribute('aria-label', 'Shot settings. Aspect Landscape 16:9');
  await expect(composer.locator('.sc-reshape-hint')).toHaveText('Will extend to Landscape 16:9');

  // the machine's own default is still the default, which is the whole cause:
  // a refine that writes the pref is a refine every later brief and every
  // later tab inherits. (The key exists because the dock's own composer wrote
  // the fallback on mount; what matters is that 16:9 never reached it.)
  expect(await page.evaluate(() => localStorage.getItem('scenri:format'))).toBe('"square"');

  // so a second tab, sharing that storage, opens the 4:5 shot at 4:5 while this
  // one still holds 16:9 on the first
  const tab2 = await page.context().newPage();
  await tab2.goto(`/${brand}/create/shots/${b}`);
  const composer2 = tab2.locator('.sc-ovl-edit');
  await expect(composer2.locator('.sc-brief-line')).toBeVisible();
  await expect(composer2.locator('.sc-more')).toHaveAttribute('aria-label', 'Shot settings. Aspect Portrait 4:5');
  await expect(composer.locator('.sc-more')).toHaveAttribute('aria-label', 'Shot settings. Aspect Landscape 16:9');
  await tab2.close();
});

/**
 * Changing an ingredient that is already in the brief.
 *
 * The chip used to open the caret menu in a "replace" mode that had no query
 * behind it: it drew "40 of 576. Keep typing to narrow." over a list that
 * ignored typing, and the letters went into the brief instead. These cases are
 * the shape of the thing that replaced it.
 */
test('a chip swaps in one click and the prose survives', async ({ page }) => {
  await page.keyboard.type('a shot of ');
  await plusMenu(page, /scenes/i);
  await pickCard(page, 0);
  await page.keyboard.press('Escape');
  await page.keyboard.type(' at dawn');
  const before = await chips(page).first().textContent();

  await openPicker(page);
  await expect(pick(page)).toHaveAttribute('data-kind', 'scene');
  // what is on sits above the line, and never also in the grid below it
  await expect(currentRow(page)).toHaveCount(1);
  await expect(currentRow(page).locator('b')).toHaveText((before ?? '').replace(/×/g, '').trim());

  await cards(page).nth(3).click();
  await expect(pick(page)).toHaveCount(0); // one click, then out of the way
  await expect(chips(page)).toHaveCount(1);
  expect(await chips(page).first().textContent()).not.toBe(before);
  expect(await sentence(page)).toMatch(/^a shot of /);
  expect(await sentence(page)).toMatch(/at dawn$/);
});

test('typing in the picker never reaches the brief', async ({ page }) => {
  await page.keyboard.type('keep me ');
  await plusMenu(page, /scenes/i);
  await pickCard(page, 0);
  await page.keyboard.press('Escape');
  const before = await sentence(page);

  await openPicker(page);
  await pickSearch(page).fill('zzzqqq');
  // the brief is untouched, and the panel says so rather than pretending
  expect(await sentence(page)).toBe(before);
  await expect(page.locator('.sc-swap-empty')).toBeVisible();
});

test('search finds a scene and one click takes it', async ({ page }) => {
  await plusMenu(page, /scenes/i);
  await pickCard(page, 0);
  await page.keyboard.press('Escape');

  await openPicker(page);
  const name = (await cards(page).nth(2).locator('b').textContent())!.trim();
  await pickSearch(page).fill(name);
  await expect(cards(page).first().locator('b')).toHaveText(name);
  await cards(page).first().click();
  await expect(pick(page)).toHaveCount(0);
  expect((await chips(page).first().textContent())?.includes(name)).toBe(true);
});

test('the caret comes back where it was, on whichever side it was', async ({ page }) => {
  await page.keyboard.type('AAAA ');
  await plusMenu(page, /product/i);
  await pickCard(page);
  await page.keyboard.type('BBBB');

  // The panel takes focus for its search field, so the line loses the caret
  // outright: coming back to the same character is the whole contract.
  await openPicker(page, 0, 0.55);
  await page.keyboard.press('Escape');
  await expect(pick(page)).toHaveCount(0);
  await page.keyboard.type('X');
  expect(await sentence(page)).toMatch(/XBBBB$/);

  // and the other side of the same chip comes back to the other side
  await openPicker(page, 0, 0.2);
  await page.keyboard.press('Escape');
  await expect(pick(page)).toHaveCount(0);
  await page.keyboard.type('Z');
  expect(await sentence(page)).toMatch(/^AAAA Z/);
});

test('remove from the footer empties the slot', async ({ page }) => {
  await page.keyboard.type('mood ');
  await plusMenu(page, /scenes/i);
  await pickCard(page, 0);
  await page.keyboard.press('Escape');

  await openPicker(page);
  await page.locator('.sc-swap-remove').click();
  await expect(pick(page)).toHaveCount(0);
  await expect(chips(page)).toHaveCount(0);
  expect(await sentence(page)).toMatch(/^mood/);
});

test('a scenri-library product finds its own siblings', async ({ page }) => {
  // The caret menu built Products from the brand library alone, so a chip
  // holding one of these had a checkmark that matched no row and no way to
  // reach the other forty-three.
  //
  // Scenri's products used to sit behind a "Library" tab of their own, as if
  // ownership were a second kind of object. They share the Products tab now,
  // ranked after the brand's, so this reaches one from there instead.
  const ids: string[] = await page.evaluate(async () => {
    const r = await fetch('/api/demo-products');
    const j = await r.json();
    return j.demoProducts.map((p: { id: string }) => p.id);
  });
  expect(ids.length).toBeGreaterThan(1);

  await plusMenu(page, /product/i);
  // The brand's own lead the tab, so the last card is reliably one of Scenri's.
  await pickCard(page, (await attachCards(page).count()) - 1);
  await page.keyboard.press('Escape');

  await openPicker(page);
  await expect(pick(page)).toHaveAttribute('data-kind', 'product');
  await expect(currentRow(page)).toHaveCount(1);
  // the other forty-three are reachable, which is the whole of this bug
  await expect(cards(page)).not.toHaveCount(0);
  const before = await chips(page).first().textContent();
  await cards(page).last().click();
  await expect(chips(page)).toHaveCount(1);
  expect(await chips(page).first().textContent()).not.toBe(before);
});

test('one list, with the brand’s own products before the ones Scenri ships', async ({ page }) => {
  await plusMenu(page, /product/i);
  await pickCard(page);
  await page.keyboard.press('Escape');

  await openPicker(page);
  // no shelves, no headings: order carries it, so there is one thing to read
  await expect(page.locator('.sc-swap-grid')).toHaveCount(1);
  const own: string[] = await page.evaluate(async () => {
    const brandId = location.pathname.split('/').filter(Boolean)[0];
    const brands = await (await fetch('/api/brands')).json();
    const b = brands.find((x: any) => x.slug === brandId || x.id === brandId);
    const r = await (await fetch(`/api/brands/${b.id}/products-library`)).json();
    return r.products.map((p: { name: string }) => p.name);
  });
  expect(own.length).toBeGreaterThan(0);
  const labels = await cards(page).locator('b').allTextContents();
  // every one of the brand's own appears before the first that is not theirs
  const firstForeign = labels.findIndex((l) => !own.includes(l.trim()));
  const lastOwn = labels.map((l) => own.includes(l.trim())).lastIndexOf(true);
  expect(firstForeign === -1 || lastOwn < firstForeign).toBe(true);
});

test('the row saying what is on is not a door', async ({ page }) => {
  await page.keyboard.type('same ');
  await plusMenu(page, /scenes/i);
  await pickCard(page, 0);
  await page.keyboard.press('Escape');
  const before = await sentence(page);

  await openPicker(page);
  // it is information. Clicking it does not close, does not deselect, does not
  // navigate — every one of those has its own labelled way to happen.
  await currentRow(page).click();
  await expect(pick(page)).toBeVisible();
  expect(await sentence(page)).toBe(before);
  await expect(chips(page)).toHaveCount(1);
  await expect(page.locator('.sc-toast')).toHaveCount(0);

  // and what is on is never also offered as a thing to switch to
  const names = await cards(page).locator('b').allTextContents();
  const current = (await currentRow(page).locator('b').textContent())!.trim();
  expect(names.map((n) => n.trim())).not.toContain(current);
});

test('a mouse gets the search field straight away', async ({ page }) => {
  await plusMenu(page, /scenes/i);
  await pickCard(page, 0);
  await page.keyboard.press('Escape');

  await openPicker(page);
  // the counterpart of the touch rule: on a pointer nothing is covered by the
  // keyboard, so typing is the fastest way into a catalog of this size
  await expect(pickSearch(page)).toBeFocused();
  await page.keyboard.type('sil');
  await expect(cards(page).first().locator('b')).toContainText(/sil/i);
});

test('the current row links out to the asset, and only from its own button', async ({ page }) => {
  await plusMenu(page, /scenes/i);
  await pickCard(page, 0);
  await page.keyboard.press('Escape');

  await openPicker(page);
  const open = currentRow(page).locator('.sc-swap-open');
  await expect(open).toHaveAttribute('target', '_blank');
  await expect(open).toHaveAttribute('href', /\/scenes\/[a-z0-9-]+$/);
  // the row itself carries no href: looking at a thing is a deliberate act
  expect(await currentRow(page).getAttribute('href')).toBeNull();
});

test('a scene swapped through the picker still toasts and still undoes', async ({ page }) => {
  await plusMenu(page, /scenes/i);
  await pickCard(page, 0);
  await page.keyboard.press('Escape');
  const first = await chips(page).first().textContent();

  await openPicker(page);
  await cards(page).nth(4).click();
  const toast = page.locator('.sc-toast', { hasText: /switched to/i });
  await expect(toast).toBeVisible();
  await toast.getByRole('button', { name: /undo/i }).click();
  await expect(chips(page)).toHaveCount(1);
  expect(await chips(page).first().textContent()).toBe(first);
});

test('the panel flips below the chip when there is no room above', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 380 });
  await plusMenu(page, /scenes/i);
  await pickCard(page, 0);
  await page.keyboard.press('Escape');

  await openPicker(page);
  const box = (await pick(page).boundingBox())!;
  const vp = page.viewportSize()!;
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(vp.height + 1);
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(vp.width + 1);
});

test('only one surface is ever open', async ({ page }) => {
  await page.keyboard.type('one ');
  await plusMenu(page, /scenes/i);
  await pickCard(page, 0);
  await page.keyboard.press('Escape');

  await openPicker(page);
  await expect(page.locator('.sc-cmd')).toHaveCount(0);
  await page.keyboard.press('Escape');

  // and the other way round: a caret menu gives way to a chip's picker
  await page.keyboard.type(' #');
  await page.locator('.sc-cmd-row').first().waitFor();
  await openPicker(page);
  await expect(page.locator('.sc-cmd')).toHaveCount(0);
});

test('a chip is reachable, openable and removable from the keyboard', async ({ page }) => {
  await page.keyboard.type('AAAA ');
  await plusMenu(page, /scenes/i);
  await pickCard(page, 0);
  await page.keyboard.press('Escape');

  await chips(page).first().focus();
  await expect(chips(page).first()).toHaveAttribute('aria-haspopup', 'dialog');
  await page.keyboard.press('Enter');
  await expect(pick(page)).toBeVisible();
  await expect(chips(page).first()).toHaveAttribute('aria-expanded', 'true');

  await page.keyboard.press('Escape');
  await expect(pick(page)).toHaveCount(0);
  await expect(chips(page).first()).toHaveAttribute('aria-expanded', 'false');

  await chips(page).first().focus();
  await page.keyboard.press('Backspace');
  await expect(chips(page)).toHaveCount(0);
  expect(await sentence(page)).toMatch(/^AAAA/);
});

test('an empty trigger is a shortlist, not a catalog dump', async ({ page }) => {
  await page.keyboard.type('#');
  await page.locator('.sc-cmd-row').first().waitFor();
  await expect(page.locator('.sc-cmd-capped')).toHaveCount(0);
  await expect(page.locator('.sc-cmd-foot')).toHaveCount(0);
  expect(await page.locator('.sc-cmd-row').count()).toBeLessThanOrEqual(40);
});

test('typing after a trigger narrows, and a miss stays open', async ({ page }) => {
  await page.keyboard.type('#');
  await page.locator('.sc-cmd-row').first().waitFor();
  const before = await page.locator('.sc-cmd-row').count();
  await page.keyboard.type('zzzzzz');
  await expect(page.locator('.sc-cmd')).toBeVisible();
  await expect(page.locator('.sc-cmd-empty')).toHaveText('No matching colours');
  expect(await sentence(page)).toContain('#zzzzzz');
  const menuBox = (await page.locator('.sc-cmd').boundingBox())!;
  const cardBox = (await page.locator('.sc-promptcard').first().boundingBox())!;
  expect(cardBox.y - (menuBox.y + menuBox.height)).toBeLessThanOrEqual(16);
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Backspace');
  await expect(page.locator('.sc-cmd-row').first()).toBeVisible();
  expect(await page.locator('.sc-cmd-row').count()).toBe(before);
});

test('Enter and Tab insert, Escape and an outside click leave the text', async ({ page }) => {
  await page.keyboard.type('in #');
  await page.locator('.sc-cmd-row').first().waitFor();
  await page.keyboard.press('Escape');
  await expect(page.locator('.sc-cmd')).toHaveCount(0);
  expect(await sentence(page)).toMatch(/in #$/);

  await page.keyboard.press('Backspace');
  await page.keyboard.type('#ink');
  await page.locator('.sc-cmd-row').first().waitFor();
  await page.mouse.click(8, 8);
  await expect(page.locator('.sc-cmd')).toHaveCount(0);
  expect(await sentence(page)).toContain('#ink');

  await page.keyboard.press('Backspace');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Backspace');
  await page.keyboard.type('#');
  await page.locator('.sc-cmd-row').first().waitFor();
  await page.keyboard.press('Enter');
  await expect(chips(page)).toHaveCount(1);
  expect(await chips(page).first().getAttribute('data-tok')).toMatch(/^c:/);
  expect(await sentence(page)).not.toContain('#');

  await page.keyboard.type(' and @');
  await page.locator('.sc-cmd-row').first().waitFor();
  await expect(page.locator('.sc-cmd-group')).toHaveText('Presenters');
  await page.keyboard.press('Tab');
  await expect(chips(page)).toHaveCount(2);
  expect(await chips(page).nth(1).getAttribute('data-tok')).toMatch(/^h:/);
  expect(await sentence(page)).not.toContain('@');
});

test('a colour chip opens the palette menu, not the insert menu', async ({ page }) => {
  await plusMenu(page, /colors/i);
  await pickCard(page);
  await page.keyboard.press('Escape');
  await openPicker(page);
  await expect(pick(page)).toHaveAttribute('data-kind', 'color');
  await expect(page.locator('.sc-swap-swatch').first()).toBeVisible();
  await expect(page.locator('.sc-cmd')).toHaveCount(0);
});

test('a colour chip swaps in one click and the prose survives', async ({ page }) => {
  await page.keyboard.type('wash in ');
  await plusMenu(page, /colors/i);
  await pickCard(page);
  await page.keyboard.press('Escape');
  await page.keyboard.type(' light');
  const before = await chips(page).first().textContent();

  await openPicker(page);
  await expect(pick(page)).toHaveAttribute('data-kind', 'color');
  const other = page.locator('.sc-swap-swatches .sc-swap-swatch:not([data-on])');
  await expect(other.first()).toBeVisible();
  const next = (await other.first().locator('b').textContent())?.trim();
  await other.first().click();
  await expect(pick(page)).toHaveCount(0);
  await expect(chips(page)).toHaveCount(1);
  expect(await chips(page).first().textContent()).not.toBe(before);
  if (next) expect((await chips(page).first().textContent()) ?? '').toContain(next);
  expect(await sentence(page)).toMatch(/^wash in /);
  expect(await sentence(page)).toMatch(/light$/);
});

test('paste of a sigil does not open the menu', async ({ page }) => {
  await line(page).click();
  await page.evaluate(() => {
    const el = document.querySelector('.sc-brief-line');
    const data = new DataTransfer();
    data.setData('text/plain', 'credit @marco in the corner');
    el?.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }));
  });
  await expect(page.locator('.sc-cmd')).toHaveCount(0);
  expect(await sentence(page)).toContain('@marco');
});

test('a multi-shot request lands as siblings reading in request order, wherever completion landed them', async ({
  page,
}) => {
  await page.goto('/');
  await page.waitForURL((u) => {
    const seg = u.pathname.split('/').filter(Boolean);
    return seg.length === 1 && seg[0] !== 'setup';
  });
  const slug = decodeURIComponent(new URL(page.url()).pathname.split('/')[1]);

  // A real four-shot demo request through the real API: four first-class
  // sibling nodes, one image each, sharing one batch identity.
  const made = await page.evaluate(async () => {
    const brands = await (await fetch('/api/brands')).json();
    const ws = await (await fetch(`/api/brands/${brands[0].id}/workspace`)).json();
    const r = await fetch('/api/nodes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectId: ws.project.id,
        kind: 'generation',
        engineId: 'demo',
        count: 4,
        prompt: 'four shots in order',
        width: 512,
        height: 512,
      }),
    });
    const body = await r.json();
    return (body.siblings as { id: string }[]).map((s) => s.id);
  });
  expect(made).toHaveLength(4);
  for (const id of made) {
    await expect
      .poll(() => page.evaluate(async (n) => (await (await fetch(`/api/nodes/${n}`)).json()).status, id))
      .toBe('done');
  }
  // four distinct pictures, not one picture four times
  const hashes = await page.evaluate(
    async (ids) => Promise.all(ids.map(async (n) => (await (await fetch(`/api/nodes/${n}`)).json()).images[0])),
    made,
  );
  expect(new Set(hashes).size).toBe(4);

  await page.goto(`/${slug}/create`);
  // Visual reading order — top row left to right, then the next row — must be
  // slot 1, 2, 3, 4, however the four resolved.
  const placed: { i: number; x: number; y: number }[] = [];
  for (let i = 0; i < 4; i++) {
    const box = await page.locator(`.sc-cell[data-fb-node="${made[i]}"]`).first().boundingBox();
    if (!box) throw new Error(`sibling ${i} has no tile`);
    placed.push({ i, x: box.x, y: box.y });
  }
  const reading = [...placed].sort((a, b) => a.y - b.y || a.x - b.x).map((p) => p.i);
  expect(reading).toEqual([0, 1, 2, 3]);
});

/* ---------------------------------------------------------------- reorder */

/** Prose plus one product chip at the end: the reorder fixture. */
async function seedReorder(page: Page) {
  await line(page).click();
  await page.keyboard.type('hero shot on marble ');
  await plusMenu(page, /products/i);
  await pickCard(page);
  await page.keyboard.press('Escape'); // close the attach panel
  await expect(chips(page)).toHaveCount(1);
}

test('a chip drags between words, and the drop is the same truth the compiler reads', async ({ page }) => {
  await seedReorder(page);
  const chipBox = (await chips(page).first().boundingBox())!;
  const lineBox = (await line(page).boundingBox())!;

  await page.mouse.move(chipBox.x + chipBox.width / 2, chipBox.y + chipBox.height / 2);
  await page.mouse.down();
  // cross the 5px threshold, then aim at the very start of the sentence
  await page.mouse.move(chipBox.x + chipBox.width / 2 + 12, chipBox.y + chipBox.height / 2, { steps: 3 });
  await page.mouse.move(lineBox.x + 3, lineBox.y + lineBox.height / 2, { steps: 6 });
  await expect(page.locator('.sc-drop-caret')).toBeVisible();
  await page.mouse.up();

  // the chip now leads the sentence, and the click after the drop opened nothing
  expect(await sentence(page)).toMatch(/^Cold brew can\s*hero shot on marble/);
  await expect(pick(page)).toHaveCount(0);
  // the move is a real edit: the draft round-trips it across a reload
  await page.reload();
  await line(page).waitFor();
  expect(await sentence(page)).toMatch(/^Cold brew can\s*hero shot on marble/);
});

test('a press without movement is still a click, and Escape abandons a drag', async ({ page }) => {
  await seedReorder(page);
  const before = await sentence(page);
  const box = (await chips(page).first().boundingBox())!;

  // sub-threshold press: the picker opens exactly as it always did
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.up();
  await expect(pick(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(pick(page)).toHaveCount(0);

  // a drag abandoned with Escape moves nothing and leaves no furniture
  const again = (await chips(page).first().boundingBox())!;
  await page.mouse.move(again.x + again.width / 2, again.y + again.height / 2);
  await page.mouse.down();
  await page.mouse.move(again.x + 60, again.y + again.height / 2, { steps: 4 });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(page.locator('.sc-chip-ghost')).toHaveCount(0);
  await expect(page.locator('.sc-drop-caret')).toHaveCount(0);
  expect(await sentence(page)).toBe(before);
});

test('Alt plus an arrow moves a focused chip, and the move is announced', async ({ page }) => {
  await seedReorder(page);
  await chips(page).first().focus();
  await page.keyboard.press('Alt+ArrowLeft');
  expect(await sentence(page)).toMatch(/^hero shot on\s*Cold brew can\s*marble/);
  // the same chip kept focus, so the next press keeps walking
  await expect(chips(page).first()).toBeFocused();
  await expect(page.locator('.sc-brief [role="status"]')).toContainText('Moved Cold brew can');
  await page.keyboard.press('Alt+ArrowRight');
  expect(await sentence(page)).toMatch(/^hero shot on marble\s*Cold brew can/);
});

test('a chip says how it is operated, and its x is chrome rather than a trap', async ({ page }) => {
  await seedReorder(page);
  const chip = chips(page).first();
  await expect(chip).toHaveAttribute('aria-keyshortcuts', 'Alt+ArrowLeft Alt+ArrowRight');
  const hintId = await chip.getAttribute('aria-describedby');
  expect(hintId).toBeTruthy();
  await expect(page.locator(`[id="${hintId}"]`)).toContainText('Alt plus arrow keys to move');
  await expect(chip.locator('[data-role="remove"]')).toHaveAttribute('aria-hidden', 'true');
});

test('a drag never grows the document or shifts the page', async ({ page }) => {
  await seedReorder(page);
  const before = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth,
    sh: document.documentElement.scrollHeight,
    bw: document.body.getBoundingClientRect().width,
    iw: window.innerWidth,
    ih: window.innerHeight,
  }));
  const topbar = (await page.locator('.sc-topbar').boundingBox())!;

  const box = (await chips(page).first().boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 14, box.y + box.height / 2, { steps: 3 });
  await page.mouse.move(page.viewportSize()!.width - 60, box.y, { steps: 5 });

  // mid-flight: the document is exactly the size it was, the ghost is a
  // fixed, in-viewport box, and the chrome has not moved a pixel
  const during = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth,
    sh: document.documentElement.scrollHeight,
    bw: document.body.getBoundingClientRect().width,
  }));
  expect(during.sw).toBe(before.sw);
  expect(during.sh).toBe(before.sh);
  expect(during.bw).toBe(before.bw);
  expect(during.sw).toBeLessThanOrEqual(before.iw);
  expect(during.sh).toBeLessThanOrEqual(before.ih);
  const ghost = page.locator('.sc-chip-ghost');
  await expect(ghost).toBeVisible();
  expect(await ghost.evaluate((el) => getComputedStyle(el).position)).toBe('fixed');
  const gbox = (await ghost.boundingBox())!;
  expect(gbox.x).toBeGreaterThanOrEqual(0);
  expect(gbox.y).toBeGreaterThanOrEqual(0);
  expect(gbox.x + gbox.width).toBeLessThanOrEqual(before.iw + 1);
  const topbarAfter = (await page.locator('.sc-topbar').boundingBox())!;
  expect(topbarAfter.x).toBe(topbar.x);
  expect(topbarAfter.width).toBe(topbar.width);

  // a release outside the line is a clean cancel: order intact, nothing opens
  const sentenceBefore = await sentence(page);
  await page.mouse.up();
  await expect(page.locator('.sc-chip-ghost')).toHaveCount(0);
  await expect(page.locator('.sc-drop-caret')).toHaveCount(0);
  expect(await sentence(page)).toBe(sentenceBefore);
  await expect(pick(page)).toHaveCount(0);
});

/* ---------------------------------------------------------------- removal */

/** Prose with three chips of different kinds: the removal fixture. */
async function seedRemovable(page: Page) {
  await line(page).click();
  await page.keyboard.type('shoot ');
  await page.keyboard.type('$');
  await page.locator('.sc-cmd-row').first().waitFor();
  await page.keyboard.press('Enter');
  await page.keyboard.type(' with ');
  await page.keyboard.type('@');
  await page.locator('.sc-cmd-row').first().waitFor();
  await page.keyboard.press('Enter');
  await page.keyboard.type(' in #f5c518 light');
  await expect(chips(page)).toHaveCount(3);
}

const removeX = (p: Page, index: number) => chips(p).nth(index).locator('[data-role="remove"]').click();

test('every chip removes independently by its x: middle, then first, then last', async ({ page }) => {
  await seedRemovable(page);
  await removeX(page, 1);
  await expect(chips(page)).toHaveCount(2);
  await removeX(page, 0);
  await expect(chips(page)).toHaveCount(1);
  await removeX(page, 0);
  await expect(chips(page)).toHaveCount(0);
  // the words are the user's, and so are the spaces that met when a chip left
  const text = await sentence(page);
  expect(text).toMatch(/shoot\s+with\s+in\s+light/);
  // the x removed; it never opened a picker or menu
  await expect(pick(page)).toHaveCount(0);
  await expect(page.locator('.sc-cmd')).toHaveCount(0);
});

test('rapid x clicks remove every chip without a miss', async ({ page }) => {
  await seedRemovable(page);
  await removeX(page, 0);
  await removeX(page, 0);
  await removeX(page, 0);
  await expect(chips(page)).toHaveCount(0);
});

test('the x keeps working under a pointer that never moves', async ({ page }) => {
  // two typed hex chips have identical labels, so after the first removal the
  // second chip's x lands exactly under the unmoved pointer — the reflow that
  // used to strand :hover and make the second click fall through to the chip
  await line(page).click();
  await page.keyboard.type('a #f5c518 #f5c518 c');
  await expect(chips(page)).toHaveCount(2);
  const b0 = (await chips(page).nth(0).boundingBox())!;
  const b1 = (await chips(page).nth(1).boundingBox())!;
  expect(Math.abs(b0.width - b1.width)).toBeLessThan(2);
  await page.mouse.move(b0.x + b0.width - 9, b0.y + b0.height / 2);
  await page.mouse.down();
  await page.mouse.up();
  await expect(chips(page)).toHaveCount(1);
  await page.mouse.down();
  await page.mouse.up();
  await expect(chips(page)).toHaveCount(0);
  await expect(pick(page)).toHaveCount(0);
});

test('a chip removes cleanly right after a drag reorder', async ({ page }) => {
  await seedReorder(page);
  const chipBox = (await chips(page).first().boundingBox())!;
  const lineBox = (await line(page).boundingBox())!;
  await page.mouse.move(chipBox.x + chipBox.width / 2, chipBox.y + chipBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(chipBox.x + chipBox.width / 2 + 12, chipBox.y + chipBox.height / 2, { steps: 3 });
  await page.mouse.move(lineBox.x + 3, lineBox.y + lineBox.height / 2, { steps: 6 });
  await page.mouse.up();
  expect(await sentence(page)).toMatch(/^Cold brew can/);
  // the very next gesture is the x — the post-drag click suppressor must let it through
  await removeX(page, 0);
  await expect(chips(page)).toHaveCount(0);
  expect(await sentence(page)).toMatch(/hero shot on marble/);
});

test('pressing the x never starts a drag, and drift inside it still removes', async ({ page }) => {
  await seedReorder(page);
  const box = (await chips(page).first().boundingBox())!;
  const x = box.x + box.width - 9;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  // past the 5px drag threshold, still inside the x band
  await page.mouse.move(x - 8, y, { steps: 2 });
  await expect(page.locator('.sc-chip-ghost')).toHaveCount(0);
  await page.mouse.up();
  await expect(chips(page)).toHaveCount(0);
  await expect(page.locator('.sc-drop-caret')).toHaveCount(0);
});

test('removing another chip while a picker is open closes the picker first', async ({ page }) => {
  await seedRemovable(page);
  await openPicker(page, 0);
  await removeX(page, 1);
  await expect(chips(page)).toHaveCount(2);
  await expect(pick(page)).toHaveCount(0);
  await expect(page.locator('.sc-token[data-open]')).toHaveCount(0);
});

test('backspace among three chips removes only the nearest', async ({ page }) => {
  await seedRemovable(page);
  await page.keyboard.press('End');
  for (let i = 0; i < ' light'.length; i++) await page.keyboard.press('Backspace');
  // an atomic chip takes two presses: Chromium selects it first, then deletes
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Backspace');
  await expect(chips(page)).toHaveCount(2);
  expect(await chips(page).nth(0).getAttribute('data-tok')).toMatch(/^p:/);
  expect(await chips(page).nth(1).getAttribute('data-tok')).toMatch(/^h:/);
  expect(await sentence(page)).not.toMatch(/ {2}/);
});

test('the newest work is always the top-left tile', async ({ page }) => {
  await page.goto('/');
  await page.waitForURL((u) => {
    const seg = u.pathname.split('/').filter(Boolean);
    return seg.length === 1 && seg[0] !== 'setup';
  });
  const slug = decodeURIComponent(new URL(page.url()).pathname.split('/')[1]);

  // three finished shots so the grid has history to push against
  await page.evaluate(async () => {
    const brands = await (await fetch('/api/brands')).json();
    const ws = await (await fetch(`/api/brands/${brands[0].id}/workspace`)).json();
    for (let i = 0; i < 3; i++) {
      const r = await fetch('/api/nodes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          projectId: ws.project.id,
          kind: 'generation',
          engineId: 'demo',
          count: 1,
          prompt: `history shot ${i}`,
          width: 512,
          height: 512,
        }),
      });
      const { id } = await r.json();
      for (let t = 0; t < 60; t++) {
        const n = await (await fetch(`/api/nodes/${id}`)).json();
        if (n.status !== 'running') break;
        await new Promise((res) => setTimeout(res, 100));
      }
    }
  });

  await page.goto(`/${slug}/create`);
  await expect(page.locator('.sc-cell').first()).toBeVisible();

  // One evaluate, one consistent layout: sampling each cell's box in its own
  // round trip let the demo run finish mid-walk, so the running attribute was
  // gone by the time the winner was asked about it.
  const topLeftMost = (selector: string) =>
    page.evaluate((sel) => {
      const boxes = [...document.querySelectorAll('.sc-cell')].map((c) => ({ c, b: c.getBoundingClientRect() }));
      boxes.sort((a, z) => a.b.y - z.b.y || a.b.x - z.b.x);
      return !!boxes[0]?.c.matches(sel);
    }, selector);

  // send a new one from the composer: the running tile must appear top left
  await line(page).click();
  await page.keyboard.type('the newest shot');
  await dock(page).locator('.sc-send').click();
  // a default send is a two-shot batch now, so two running tiles are the norm
  await expect(page.locator('.sc-cell[data-running]').first()).toBeVisible();
  // the demo engine can land between any two round trips, taking the running
  // attribute with it — in that case the done-shot assertion below is the
  // whole invariant, checked against the same top-left spot
  const during = await page.evaluate(() => {
    const boxes = [...document.querySelectorAll('.sc-cell')].map((c) => ({ c, b: c.getBoundingClientRect() }));
    boxes.sort((a, z) => a.b.y - z.b.y || a.b.x - z.b.x);
    return {
      running: document.querySelectorAll('.sc-cell[data-running]').length,
      topLeftIsRunning: !!boxes[0]?.c.matches('[data-running]'),
    };
  });
  if (during.running > 0) expect(during.topLeftIsRunning).toBe(true);

  // and when it lands, the finished shot holds that same top-left spot
  await expect(page.locator('.sc-cell[data-running]')).toHaveCount(0, { timeout: 30_000 });
  const newest = await page.evaluate(async () => {
    const brands = await (await fetch('/api/brands')).json();
    const ws = await (await fetch(`/api/brands/${brands[0].id}/workspace`)).json();
    const nodes = ws.nodes.filter((n: any) => n.kind !== 'root' && n.status === 'done');
    nodes.sort((a: any, b: any) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
    return nodes[0].id;
  });
  expect(await topLeftMost(`[data-fb-node="${newest}"]`)).toBe(true);
});

test('a refinement records what it carried, and the shot detail says it', async ({ page }) => {
  await page.goto('/');
  await page.waitForURL((u) => {
    const seg = u.pathname.split('/').filter(Boolean);
    return seg.length === 1 && seg[0] !== 'setup';
  });
  const slug = decodeURIComponent(new URL(page.url()).pathname.split('/')[1]);

  // a parent shot briefed with a brand mark and a custom reference, then a
  // bare-text refinement of it, all through the real API on the demo engine
  const made = await page.evaluate(async () => {
    const png = Uint8Array.from(
      atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='),
      (c) => c.charCodeAt(0),
    );
    const brands = await (await fetch('/api/brands')).json();
    const brand = brands[0];
    const fd = new FormData();
    fd.append('file', new Blob([png], { type: 'image/png' }), 'logo.png');
    const withLogo = await (await fetch(`/api/brands/${brand.id}/logos`, { method: 'POST', body: fd })).json();
    const logoHash = String(withLogo.json.logos[0].file).slice(6);

    const rd = new FormData();
    rd.append('file', new Blob([png], { type: 'image/png' }), 'ref.png');
    const refHash = (await (await fetch('/api/images', { method: 'POST', body: rd })).json()).hash;

    const ws = await (await fetch(`/api/brands/${brand.id}/workspace`)).json();
    const scenes = ((await (await fetch('/api/scenes')).json()).scenes ?? []) as { id: string; name: string }[];
    const wait = async (id: string) => {
      for (let t = 0; t < 80; t++) {
        const n = await (await fetch(`/api/nodes/${id}`)).json();
        if (n.status !== 'running') return n;
        await new Promise((r) => setTimeout(r, 100));
      }
      throw new Error('never finished');
    };
    const gen = await (
      await fetch('/api/nodes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          projectId: ws.project.id,
          kind: 'generation',
          engineId: 'demo',
          count: 1,
          brief: {
            tokens: [
              { t: 'format', id: 'square', w: 512, h: 512 },
              { t: 'text', v: 'a mug on a table' },
              { t: 'template', id: scenes[0].id },
              { t: 'mark', imageHash: logoHash },
              { t: 'ref', imageHash: refHash },
            ],
          },
        }),
      })
    ).json();
    const genNode = await wait(gen.id);
    const edit = await (
      await fetch('/api/nodes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          projectId: ws.project.id,
          parentId: genNode.id,
          kind: 'edit',
          engineId: 'demo',
          sourceImage: genNode.images[0],
          brief: { tokens: [{ t: 'text', v: 'warmer light' }] },
        }),
      })
    ).json();
    await wait(edit.id);
    return { editId: edit.id as string, sceneName: scenes[0].name as string };
  });

  // the refined shot's detail names what it carried, quieter than its own ask
  await page.goto(`/${slug}/create/shots/${made.editId}`);
  const inherited = page.locator('.sc-ingredient[data-inherited]');
  await expect(inherited).toHaveCount(2);
  await expect(page.locator('.sc-ingredient[data-inherited][data-kind="mark"]')).toBeVisible();
  await expect(page.locator('.sc-ingredient[data-inherited][data-kind="ref"]')).toBeVisible();
  // and the BRIEF reads as the sentence that was typed
  await expect(page.locator('.sc-brief-record')).toContainText('warmer light');
  // context is stated once, at the top of the record: the composer's old
  // carried strip is gone, and the record itself names the world the thread
  // was shot in — a scene never rides a refine as a reference, the photo
  // carries it
  await expect(page.locator('.sc-ovl-edit .sc-carried')).toHaveCount(0);
  // the header's source cards name the world the thread was shot in; the
  // record repeats nothing the header already says
  await expect(page.locator('.sc-source-chip', { hasText: made.sceneName })).toBeVisible();
  await expect(page.locator('.sc-ingredient[data-world]')).toHaveCount(0);
});

test("spaces typed after a chip are the user's, every one of them", async ({ page }) => {
  await line(page).click();
  await page.keyboard.type('hero shot of ');
  await plusMenu(page, /products/i);
  await pickCard(page);
  await page.keyboard.press('Escape');
  await expect(chips(page)).toHaveCount(1);
  // the caret sits flush after the chip; the line adds nothing on its behalf
  await page.keyboard.press('Space');
  await page.keyboard.press('Space');
  await page.keyboard.type('on marble');
  const after = await line(page).evaluate((el) => {
    const chip = el.querySelector('.sc-token')!;
    return (chip.nextSibling as Text).textContent;
  });
  expect(after).toBe('  on marble');
});

/**
 * The gap two chips are left with after the one between them is deleted.
 *
 * A chip owns one space on each side. Delete it with the caret in the line and
 * Chromium takes the element out and leaves those two spaces behind as SEPARATE
 * text nodes, so every pass that measured one node at a time read a single space
 * on each side and found nothing to close. The line renders spaces literally
 * (`white-space: pre-wrap`), so the survivors sat at twice the gap of every
 * other pair until the next structural edit happened to restate the invariant.
 */
test('deleting the chip between two chips leaves them one gap apart', async ({ page }) => {
  await line(page).click();
  await plusMenu(page, /products/i);
  await pickCard(page, 0);
  await pickCard(page, 1);
  await pickCard(page, 2);
  await page.keyboard.press('Escape');
  await expect(chips(page)).toHaveCount(3);

  // the gap any adjacent pair reads at: the two margins meeting
  const gapOf = (a: number, b: number) =>
    line(page).evaluate(
      (root, [i, j]) => {
        const els = root.querySelectorAll('.sc-token');
        return Math.round(els[j].getBoundingClientRect().left - els[i].getBoundingClientRect().right);
      },
      [a, b] as const,
    );
  const control = await gapOf(0, 1);
  expect(control).toBe(4);

  // the caret on the line right after the middle chip: the one position where
  // the browser will not delete an atom on its own, and the rule does it
  await line(page).evaluate((el) => {
    const chip = el.querySelectorAll('.sc-token')[1];
    const r = document.createRange();
    r.setStart(el, [...el.childNodes].indexOf(chip) + 1);
    r.collapse(true);
    const sel = getSelection()!;
    sel.removeAllRanges();
    sel.addRange(r);
  });
  await page.keyboard.press('Backspace');
  await expect(chips(page)).toHaveCount(2);

  // nothing between the survivors but their margins
  const between = await line(page).evaluate((el) => {
    const first = el.querySelector('.sc-token')!;
    return (first.nextSibling as HTMLElement | null)?.classList?.contains('sc-token') ?? false;
  });
  expect(between).toBe(true);
  expect(await gapOf(0, 1)).toBe(control);
});

/**
 * The same rule, in the refine composer.
 *
 * The composer in the shot's sidebar is the same component as the hub's, at a
 * smaller type scale, so the boundary rule cannot hold in one and not the other.
 * Pinned here anyway: it is the surface the doubled gap was reported on, and a
 * shared component is only shared until somebody forks it.
 */
test('the refine composer closes the same seam, at its own type scale', async ({ page }) => {
  await expect(page.locator('.sc-cell').first()).toBeVisible();
  await page.locator('.sc-cell').first().click();
  await page.waitForURL(/\/shots\//);
  const editor = page.locator('.sc-ovl-edit');
  const editLine = editor.locator('.sc-brief-line');
  await expect(editLine).toBeVisible();

  // start from an empty sentence: a refine composer opens carrying context
  await editLine.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('Backspace');

  await editor.locator('.sc-attach-toggle').click();
  await page.locator('.sc-ap-tabs button', { hasText: /products/i }).click();
  await attachCards(page).first().waitFor();
  for (const i of [0, 1, 2]) await attachCards(page).nth(i).click();
  await page.keyboard.press('Escape');
  await expect(editor.locator('.sc-token')).toHaveCount(3);

  await editLine.evaluate((el) => {
    const chip = el.querySelectorAll('.sc-token')[1];
    const r = document.createRange();
    r.setStart(el, [...el.childNodes].indexOf(chip) + 1);
    r.collapse(true);
    const sel = getSelection()!;
    sel.removeAllRanges();
    sel.addRange(r);
  });
  await page.keyboard.press('Backspace');
  await expect(editor.locator('.sc-token')).toHaveCount(2);

  const between = await editLine.evaluate((el) => {
    const next = el.querySelector('.sc-token')!.nextSibling as HTMLElement | null;
    return next?.classList?.contains('sc-token') ?? false;
  });
  expect(between).toBe(true);
});

/**
 * A chip and the space after it are one thing to the keyboard.
 *
 * The space between two chips is a real character, and the browser stepped and
 * deleted it as one: crossing a chip took two presses, removing one took two,
 * and after the first of those the chips sat touching. One press now does each.
 */
test('one press crosses a chip and one press removes it', async ({ page }) => {
  await line(page).click();
  await plusMenu(page, /products/i);
  await pickCard(page, 0);
  await pickCard(page, 1);
  await pickCard(page, 2);
  await page.keyboard.press('Escape');
  await expect(chips(page)).toHaveCount(3);

  const caret = () =>
    line(page).evaluate((el) => {
      const r = getSelection()!.getRangeAt(0);
      if (r.startContainer === el) return `line@${r.startOffset}`;
      const i = [...el.childNodes].indexOf(r.startContainer as ChildNode);
      return `${i}@${r.startOffset}`;
    });
  // three chips, nothing else: the caret rests on the line after the last
  await expect.poll(caret).toBe('line@3');

  // one Backspace takes the chip
  await page.keyboard.press('Backspace');
  await expect(chips(page)).toHaveCount(2);
  expect(await caret()).toBe('line@2');

  // one press per chip either way, stopping between them
  await page.keyboard.press('ArrowLeft');
  expect(await caret()).toBe('line@1');
  await page.keyboard.press('ArrowLeft');
  expect(await caret()).toBe('line@0');
  await page.keyboard.press('ArrowRight');
  expect(await caret()).toBe('line@1');
  await page.keyboard.press('ArrowRight');
  expect(await caret()).toBe('line@2');

  // Delete from between the two takes the one after
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Delete');
  await expect(chips(page)).toHaveCount(1);
  const shape = await line(page).evaluate((el) =>
    [...el.childNodes].map((n) => (n.nodeType === Node.TEXT_NODE ? JSON.stringify(n.textContent) : '<chip>')),
  );
  expect(shape).toEqual(['<chip>']);
});

test('prose typed against a chip stays as typed, and the margin is the gap', async ({ page }) => {
  await line(page).click();
  await page.keyboard.type('hero ');
  await plusMenu(page, /products/i);
  await pickCard(page, 0);
  await page.keyboard.press('Escape');
  // one press left from the end crosses the chip: the caret is flush before it
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.type('x');
  const before = await line(page).evaluate((el) => {
    const chip = el.querySelector('.sc-token')!;
    const t = chip.previousSibling as Text;
    const r = getSelection()!.getRangeAt(0);
    const probe = document.createRange();
    probe.setStart(t, t.length - 1);
    probe.setEnd(t, t.length);
    return {
      text: t.textContent,
      caret: r.startContainer === t ? r.startOffset : -1,
      air: Math.round(chip.getBoundingClientRect().left - probe.getBoundingClientRect().right),
    };
  });
  expect(before.text).toBe('hero x');
  expect(before.caret).toBe(6);
  expect(before.air).toBeGreaterThanOrEqual(2);
});

test("the caret between two chips is drawn in the middle of the gap, at the pill's height", async ({ page }) => {
  await line(page).click();
  await plusMenu(page, /products/i);
  await pickCard(page, 0);
  await pickCard(page, 1);
  await page.keyboard.press('Escape');
  await expect(chips(page)).toHaveCount(2);
  await page.keyboard.press('ArrowLeft'); // between the two
  const bar = page.locator('.sc-gap-caret');
  await expect(bar).toBeVisible();
  const geo = await page.evaluate(() => {
    const [a, b] = [...document.querySelectorAll('.sc-brief-line .sc-token')].map((c) => c.getBoundingClientRect());
    const g = document.querySelector<HTMLElement>('.sc-gap-caret')!.getBoundingClientRect();
    return {
      mid: (a.right + b.left) / 2,
      x: g.left + g.width / 2,
      top: a.top,
      bottom: a.bottom,
      gTop: g.top,
      gBottom: g.bottom,
      native: getComputedStyle(document.querySelector('.sc-brief-line')!).caretColor,
    };
  });
  expect(Math.abs(geo.x - geo.mid)).toBeLessThan(1);
  expect(Math.abs(geo.gTop - geo.top)).toBeLessThan(1);
  expect(Math.abs(geo.gBottom - geo.bottom)).toBeLessThan(1);
  expect(geo.native).toBe('rgba(0, 0, 0, 0)');
  // into prose: the browser's caret is the caret again
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.type('x');
  await expect(bar).toBeHidden();
});

test('a Backspace before the first chip, and a Delete after the last, take nothing', async ({ page }) => {
  await line(page).click();
  await plusMenu(page, /products/i);
  await pickCard(page, 0);
  await pickCard(page, 1);
  await pickCard(page, 2);
  await page.keyboard.press('Escape');
  await expect(chips(page)).toHaveCount(3);
  const caret = () =>
    line(page).evaluate((el) => {
      const r = getSelection()!.getRangeAt(0);
      return r.startContainer === el ? `line@${r.startOffset}` : 'elsewhere';
    });
  expect(await caret()).toBe('line@3');
  await page.keyboard.press('Delete'); // on the line after the last chip: nothing to take
  await expect(chips(page)).toHaveCount(3);
  // one press left per chip lands before the first; Home would stop after it
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowLeft');
  expect(await caret()).toBe('line@0');
  await page.keyboard.press('Backspace'); // before the first: nothing to take
  await expect(chips(page)).toHaveCount(3);
  await expect(line(page)).not.toHaveAttribute('data-empty', '');
});

test('a chip fits inside the line box and shares the sentence baseline', async ({ page }) => {
  // prose alone: the line's height at exactly one row of its own strut
  await line(page).click();
  await page.keyboard.type('hero shot on marble ');
  const bare = (await line(page).boundingBox())!.height;

  // insert the chip: the row grows by exactly the chip's vertical margins and
  // nothing else. The Figma frames pitch chip rows at 28 (a 24px chip with 2px
  // above and below) over a 24px prose strut, and the margins are the whole
  // of that difference: the chip's box itself fits INSIDE the strut. Before
  // the metric fix the chip's synthesized baseline was its bottom edge (no
  // flex item participated in baseline alignment), so every chip rode above
  // the text baseline and stretched its row on top of the margins.
  await plusMenu(page, /products/i);
  await pickCard(page);
  await page.keyboard.press('Escape');
  await expect(chips(page)).toHaveCount(1);
  const withChip = (await line(page).boundingBox())!.height;
  const margins = await chips(page)
    .first()
    .evaluate((el) => {
      const cs = getComputedStyle(el);
      return parseFloat(cs.marginTop) + parseFloat(cs.marginBottom);
    });
  expect(margins).toBeGreaterThan(0);
  expect(
    Math.abs(withChip - bare - margins),
    `bare ${bare} withChip ${withChip} margins ${margins}`,
  ).toBeLessThanOrEqual(0.6);

  // chip label and neighbouring prose share a midline on the same row
  const mid = await line(page).evaluate((el) => {
    const chip = el.querySelector('.sc-token') as HTMLElement;
    const label = chip.querySelector('.sc-token-label') as HTMLElement;
    const lr = document.createRange();
    lr.selectNodeContents(label);
    const labelRect = lr.getBoundingClientRect();
    const prose = Array.from(el.childNodes).find(
      (n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim().length > 3,
    ) as Text;
    const pr = document.createRange();
    pr.setStart(prose, 1);
    pr.setEnd(prose, Math.min(6, (prose.textContent ?? '').length));
    const proseRect = pr.getBoundingClientRect();
    return { label: labelRect.top + labelRect.height / 2, prose: proseRect.top + proseRect.height / 2 };
  });
  expect(Math.abs(mid.label - mid.prose)).toBeLessThanOrEqual(2);

  // wrapped: more prose pushes to a second row of exactly one more strut
  await line(page).click();
  await page.keyboard.press('End');
  await page.keyboard.type(' in the golden hour with a long clean shadow across the marble slab');
  const wrapped = (await line(page).boundingBox())!.height;
  // the line's own computed strut, not a hard-coded ratio: prose rows pitch
  // at the 24px strut, chip rows at 28 through the chips' own margins
  const strut = await line(page).evaluate((el) => parseFloat(getComputedStyle(el).lineHeight));
  // measured from the chip row, so the one new row is prose alone
  const grown = wrapped - withChip;
  expect(grown).toBeGreaterThan(0);
  expect(Math.abs(grown % strut)).toBeLessThanOrEqual(1);
});

test('the drag ghost rides the grab point like a platform drag image', async ({ page }) => {
  await seedReorder(page);
  const chip = chips(page).first();
  const before = (await chip.boundingBox())!;

  // grab at the chip's center, drag left into the prose
  const grabX = before.x + before.width / 2;
  const grabY = before.y + before.height / 2;
  await page.mouse.move(grabX, grabY);
  await page.mouse.down();
  const endX = grabX - 90;
  await page.mouse.move(endX, grabY, { steps: 8 });

  const ghost = page.locator('.sc-chip-ghost');
  await expect(ghost).toBeVisible();
  await expect(ghost).toBeVisible();
  const gbox = (await ghost.boundingBox())!;
  // preserved size: no scale jump
  expect(Math.abs(gbox.width - before.width)).toBeLessThanOrEqual(1.5);
  expect(Math.abs(gbox.height - before.height)).toBeLessThanOrEqual(1.5);
  // anchored 1:1 at the grab point: the pointer sits exactly where it
  // gripped the chip — no trailing offset, no easing lag
  expect(Math.abs(gbox.x + before.width / 2 - endX)).toBeLessThanOrEqual(1.5);
  expect(Math.abs(gbox.y + before.height / 2 - grabY)).toBeLessThanOrEqual(1.5);
  const style = await ghost.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { transform: cs.transform, opacity: cs.opacity, fontSize: cs.fontSize };
  });
  // translate-only: matrix(1, 0, 0, 1, x, y)
  expect(style.transform).toMatch(/^matrix\(1, 0, 0, 1, /);
  // translucent, so the insertion caret reads through it
  expect(Number(style.opacity)).toBeCloseTo(0.8, 1);
  // the em metrics survived the move to <body>
  expect(style.fontSize).toBe(await chip.evaluate((el) => getComputedStyle(el).fontSize));

  // the caret marks the drop, and the source chip holds its exact box as a
  // dashed slot: zero reflow anywhere
  await expect(page.locator('.sc-drop-caret')).toBeVisible();
  const during = (await chip.boundingBox())!;
  expect(during.x).toBe(before.x);
  expect(during.width).toBe(before.width);

  await page.keyboard.press('Escape');
  await expect(ghost).toHaveCount(0);
});

test('a Hebrew brief with an English chip survives to the wire unreversed', async ({ page }) => {
  await line(page).click();
  await page.keyboard.type('צלם תמונה של ');
  await plusMenu(page, /products/i);
  await pickCard(page);
  await page.keyboard.press('Escape');
  await expect(chips(page)).toHaveCount(1);
  await line(page).click();
  await page.keyboard.press('End');
  await page.keyboard.type(' על חימר סדוק באור חם');

  // the chip itself is a left-to-right object (thumb left, X right); its
  // label is the bidi-isolated run with its own direction
  expect(await chips(page).first().getAttribute('dir')).toBe('ltr');
  expect(await chips(page).first().locator('.sc-token-label').getAttribute('dir')).toBe('auto');

  // the wire carries the LOGICAL order: Hebrew before the chip, Hebrew after,
  // nothing reversed, nothing corrupted
  let posted: any = null;
  await page.route('**/api/nodes', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    posted = route.request().postDataJSON();
    await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'not today' }) });
  });
  await dock(page).locator('.sc-send').click();
  await expect.poll(() => posted?.kind).toBeTruthy();
  const texts = posted.brief.tokens.filter((t: any) => t.t === 'text').map((t: any) => t.v);
  expect(texts.join(' ')).toContain('צלם תמונה של');
  expect(texts.join(' ')).toContain('על חימר סדוק באור חם');
  const kinds = posted.brief.tokens.map((t: any) => t.t);
  expect(kinds.indexOf('product')).toBeGreaterThan(kinds.indexOf('text'));
});

/**
 * Selecting text with the mouse.
 *
 * A drag that selects text ends in a click on the same element, and the line
 * resolves every click itself — so it placed a caret at the release point and
 * collapsed the selection the drag had just made. From the outside the text
 * highlighted and then let go on its own, in every brief, every time.
 */
test('a drag selects text and the selection survives the mouse coming up', async ({ page }) => {
  await line(page).click();
  await page.keyboard.type('the quick brown fox jumps over the lazy dog');

  const box = (await line(page).boundingBox())!;
  const x0 = Math.round(box.x);
  // Integer coordinates, and a walk rather than a jump: Chromium grows no
  // selection at all from fractional points or from one long move, which would
  // make this report "nothing selected" for a line that is behaving.
  const y = Math.round(box.y + box.height / 2);
  await page.mouse.move(x0 + 20, y);
  await page.mouse.down();
  for (let x = 50; x <= 250; x += 40) {
    await page.mouse.move(x0 + x, y);
    await page.waitForTimeout(40);
  }
  const during = await selectedText(page);
  await page.mouse.up();

  expect(during.length).toBeGreaterThan(0);
  // the release must not take it away, now or a beat later
  expect(await selectedText(page)).toBe(during);
  await page.waitForTimeout(300);
  expect(await selectedText(page)).toBe(during);
});

test('a double click keeps the word it took, and a plain click still places the caret', async ({ page }) => {
  await line(page).click();
  await page.keyboard.type('the quick brown fox');

  const at = await charPoint(page, 6);
  await page.mouse.dblclick(at.x, at.y);
  expect(await selectedText(page)).toBe('quick');

  // A click that selects nothing is still asking for a caret, which is what
  // the guard must not break: type, and the letter lands where it was clicked.
  const end = await charPoint(page, 3);
  await page.mouse.click(end.x, end.y);
  expect(await selectedText(page)).toBe('');
  await page.keyboard.type('X');
  expect(await sentence(page)).toContain('theX quick');
});

/**
 * Selecting text around chips.
 *
 * The reported break: "[CHIP] some normal text" and the text would not
 * highlight. A chip is a contenteditable=false, user-select:none atom and the
 * drag sensor arms on chip-origin pointerdowns, so the text beside it is
 * exactly where native selection is easiest to lose. Every gesture here is a
 * stepped integer walk, per the Chromium constraint the tests above document.
 */
test('text after a leading chip drag-selects and survives', async ({ page }) => {
  await line(page).click();
  await plusMenu(page, /product/i);
  await pickCard(page);
  await page.keyboard.type('make this look realistic');

  // the typed text is the line's first non-empty text node; the chip is an element
  const from = await charPointAt(page, 0, 1);
  const to = await charPointAt(page, 0, 18);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let x = from.x + 30; x <= to.x; x += 30) {
    await page.mouse.move(x, from.y);
    await page.waitForTimeout(40);
  }
  const during = await selectedText(page);
  await page.mouse.up();

  expect(during.length).toBeGreaterThan(3);
  expect(during).toContain('ake this');
  await page.waitForTimeout(300);
  expect(await selectedText(page)).toBe(during);
});

test('a drag that crosses a chip keeps everything it took', async ({ page }) => {
  await line(page).click();
  await page.keyboard.type('hello ');
  await plusMenu(page, /product/i);
  await pickCard(page);
  await page.keyboard.type(' world');

  // text nodes: [0] "hello " and [1] " world"; the chip sits between them
  const from = await charPointAt(page, 0, 1);
  const to = await charPointAt(page, 1, 4);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let x = from.x + 30; x <= to.x + 30; x += 30) {
    await page.mouse.move(x, from.y);
    await page.waitForTimeout(40);
  }
  const during = await selectedText(page);
  await page.mouse.up();

  // The selection spans the chip: text from both sides is in it. The exact
  // endpoints depend on where the stepped walk's characters land, so this
  // asserts the crossing rather than the precise characters taken.
  expect(during).toContain('llo');
  expect(during).toContain('w');
  await page.waitForTimeout(300);
  expect(await selectedText(page)).toBe(during);
});

test('a double click takes the word right after a chip, and keeps it', async ({ page }) => {
  await line(page).click();
  await plusMenu(page, /product/i);
  await pickCard(page);
  await page.keyboard.type('quick brown fox');

  const at = await charPointAt(page, 0, 2);
  await page.mouse.dblclick(at.x, at.y);
  expect(await selectedText(page)).toBe('quick');
  await page.waitForTimeout(300);
  expect(await selectedText(page)).toBe('quick');
});

test('shift-arrow grows a selection across a chip boundary', async ({ page }) => {
  await line(page).click();
  await page.keyboard.type('hi ');
  await plusMenu(page, /product/i);
  await pickCard(page);
  await page.keyboard.type(' there');

  // Put the caret at the very start, then grow the selection right, across
  // the chip. The keyboard path is native; this locks that nothing intercepts
  // it. (Home is not reliable in a contenteditable, so the caret is placed
  // with the selection API the editor itself answers to.)
  await page.evaluate(() => {
    const el = document.querySelector('.sc-brief-line')!;
    const t = Array.from(el.childNodes).find((n) => n.nodeType === Node.TEXT_NODE);
    const r = document.createRange();
    r.setStart(t!, 0);
    r.collapse(true);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(r);
  });
  for (let i = 0; i < 6; i++) await page.keyboard.press('Shift+ArrowRight');
  const took = await selectedText(page);
  expect(took).toContain('hi');
  // and the selection kept growing past the chip into the trailing text
  for (let i = 0; i < 3; i++) await page.keyboard.press('Shift+ArrowRight');
  expect((await selectedText(page)).length).toBeGreaterThanOrEqual(took.length);
});

test('a chip click with text selected still opens the picker', async ({ page }) => {
  await line(page).click();
  await page.keyboard.type('hello there ');
  await plusMenu(page, /product/i);
  await pickCard(page);

  // take a word first, the state the caret guard exists for
  const at = await charPointAt(page, 0, 2);
  await page.mouse.dblclick(at.x, at.y);
  expect(await selectedText(page)).toBe('hello');

  // a chip-body click is an interaction, not a caret ask: it runs whatever is
  // selected and opens the picker, instead of being swallowed by the guard
  await openPicker(page, 0);
  await expect(pick(page)).toBeVisible();
});

/**
 * The viewport point of one character in the line's first text node.
 *
 * Rounded, and that is not cosmetic: Chromium does not grow a selection from
 * fractional coordinates, so a test driven with them reports "nothing was
 * selected" for a line that behaves perfectly by hand.
 */
async function charPoint(p: Page, offset: number): Promise<{ x: number; y: number }> {
  return charPointAt(p, 0, offset);
}

/**
 * The same point, in the line's Nth non-empty TEXT node — text beside chips.
 * Indexed over text nodes rather than raw childNodes, because the line engine
 * owns its DOM and a chip is not necessarily one node wide.
 */
async function charPointAt(p: Page, textIndex: number, offset: number): Promise<{ x: number; y: number }> {
  return p.evaluate(
    ([ti, off]) => {
      const el = document.querySelector('.sc-brief-line')!;
      const texts = Array.from(el.childNodes).filter(
        (n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim().length > 0,
      );
      const node = texts[ti];
      if (!node) throw new Error(`no text node ${ti} in the line`);
      const len = (node.textContent ?? '').length;
      const r = document.createRange();
      r.setStart(node, Math.max(0, Math.min(off, len - 1)));
      r.setEnd(node, Math.min(off + 1, len));
      const b = r.getBoundingClientRect();
      return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) };
    },
    [textIndex, offset],
  );
}

const selectedText = (p: Page) => p.evaluate(() => window.getSelection()?.toString() ?? '');

/* ------------------------------------------------------- reference preview */

/**
 * A reference chip shows a 15px circle of a photograph, which is enough to
 * remember that you attached something and not enough to remember what.
 *
 * Two answers, the way the showcase wall already answers the same question
 * about its credits: hovering peeks at the picture, and opening shows it at a
 * size you can actually read. These cases are the seam between those and the
 * three things a chip could already do — drag, remove, and hold its place in
 * the sentence.
 *
 * Seeded through the composer's own file input rather than a raw fetch: the
 * upload path from a picked file to a `ref` chip had never been walked by a
 * spec at all.
 */

/** Two 1x1 PNGs that differ, so the content-addressed store keeps them apart. */
const REF_A = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const REF_B = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);
const upload = (name: string, buffer: Buffer) => ({ name, mimeType: 'image/png', buffer });

/** The hover card. */
const peek = (p: Page) => p.locator('.sc-chip-preview');
const peekSrc = (p: Page) => peek(p).locator('img').getAttribute('src');
/** The picture at full size, on the app's own dialog shell. */
const lightbox = (p: Page) => p.locator('.sc-lightbox');
const lightboxSrc = (p: Page) => lightbox(p).locator('img').getAttribute('src');
/** What a chip actually holds, read off its token rather than off its position. */
const chipHash = async (p: Page, i: number) =>
  ((await chips(p).nth(i).getAttribute('data-tok')) ?? '').slice(2).split('|')[0];
const tokens = (p: Page) => chips(p).evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.tok));

/** Prose plus n reference images, attached the way a person attaches them. */
async function seedRefs(page: Page, n: number) {
  await line(page).click();
  await page.keyboard.type('make this more editorial ');
  await page
    .locator('.sc-composer input[type="file"]')
    .first()
    .setInputFiles([upload('one.png', REF_A), upload('two.png', REF_B)].slice(0, n));
  await expect(chips(page)).toHaveCount(n);
}

test('hovering a reference chip peeks at the picture that chip is holding', async ({ page }) => {
  await seedRefs(page, 1);
  const hash = await chipHash(page, 0);
  await chips(page).first().hover();
  await expect(peek(page)).toBeVisible();
  // the token's own hash, which is the one the compiler attaches
  expect(await peekSrc(page)).toBe(`/api/images/${hash}`);
});

test('a warned chip keeps its box across a keystroke and the preview that follows', async ({ page }) => {
  // on the demo engine a reference cannot ride, so its chip wears the mark;
  // the mark must cost no layout, and must not blink off while the
  // debounced preview is in flight, or the chip moves under the pointer
  await seedRefs(page, 1);
  const chip = chips(page).first();
  await expect(chip).toHaveAttribute('data-warn', '1');
  const before = (await chip.boundingBox())!;
  await line(page).click();
  await page.keyboard.press('End');
  await page.keyboard.type(' x');
  await expect(chip).toHaveAttribute('data-warn', '1');
  await page.waitForTimeout(700);
  await expect(chip).toHaveAttribute('data-warn', '1');
  const after = (await chip.boundingBox())!;
  expect(Math.abs(after.width - before.width)).toBeLessThanOrEqual(0.5);
});

test('the peek goes when the pointer leaves, and on Escape', async ({ page }) => {
  await seedRefs(page, 1);
  await chips(page).first().hover();
  await expect(peek(page)).toBeVisible();
  await page.locator('.sc-composer').hover({ position: { x: 4, y: 4 } });
  await expect(peek(page)).toHaveCount(0);

  await chips(page).first().hover();
  await expect(peek(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(peek(page)).toHaveCount(0);
});

test('hovering a second reference switches the peek to itself, and only one is up', async ({ page }) => {
  await seedRefs(page, 2);
  const [first, second] = [await chipHash(page, 0), await chipHash(page, 1)];
  expect(first).not.toBe(second);

  await chips(page).nth(0).hover();
  await expect(peek(page)).toBeVisible();
  expect(await peekSrc(page)).toBe(`/api/images/${first}`);
  await chips(page).nth(1).hover();
  await expect(peek(page)).toHaveCount(1);
  await expect.poll(() => peekSrc(page)).toBe(`/api/images/${second}`);
});

test('a chip body opens its picture, and its caret gutter still takes the caret', async ({ page }) => {
  await seedRefs(page, 2);
  const second = await chipHash(page, 1);

  // the body: the same gesture that opens every other chip's surface
  await chips(page).nth(1).click();
  await expect(lightbox(page)).toBeVisible();
  expect(await lightboxSrc(page)).toBe(`/api/images/${second}`);
  await page.keyboard.press('Escape');
  await expect(lightbox(page)).toHaveCount(0);

  // and the outer EDGE pixels are still prose: aiming at the seam beside a
  // chip has to reach the caret, or writing around a reference stops working
  const box = (await chips(page).nth(1).boundingBox())!;
  await page.mouse.click(Math.round(box.x + 2), Math.round(box.y + box.height / 2));
  await expect(lightbox(page)).toHaveCount(0);
  await page.keyboard.type('X');
  expect(await sentence(page)).toContain('X');
});

test('closing the picture puts the caret back, so the next key is not a removal', async ({ page }) => {
  await seedRefs(page, 2);
  await chips(page).nth(1).click();
  await expect(lightbox(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(lightbox(page)).toHaveCount(0);

  // A dialog hands focus back to what opened it, and what opened this was a
  // chip, where a letter goes nowhere. The caret has to come home to the line:
  // typing lands in the sentence, and both chips are still there.
  await page.keyboard.type('ok');
  expect(await sentence(page)).toContain('ok');
  await expect(chips(page)).toHaveCount(2);
});

test('clicking the peek opens that picture full size, and Escape closes it', async ({ page }) => {
  await seedRefs(page, 1);
  const hash = await chipHash(page, 0);
  await chips(page).first().hover();
  await expect(peek(page)).toBeVisible();
  await peek(page).click();
  await expect(lightbox(page)).toBeVisible();
  expect(await lightboxSrc(page)).toBe(`/api/images/${hash}`);
  // the card does not stay floating over the dialog it just opened
  await expect(peek(page)).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(lightbox(page)).toHaveCount(0);
});

test('a reordered brief still peeks at each reference by identity, never by position', async ({ page }) => {
  await seedRefs(page, 2);
  const [first, second] = [await chipHash(page, 0), await chipHash(page, 1)];

  // walk the second chip in front of the first, the keyboard way
  await chips(page).nth(1).focus();
  await page.keyboard.press('Alt+ArrowLeft');
  await expect.poll(() => chipHash(page, 0)).toBe(second);

  await chips(page).nth(0).hover();
  await expect.poll(() => peekSrc(page)).toBe(`/api/images/${second}`);
  await chips(page).nth(1).hover();
  await expect.poll(() => peekSrc(page)).toBe(`/api/images/${first}`);
});

test('the x removes a reference and never opens a picture', async ({ page }) => {
  await seedRefs(page, 2);
  await chips(page).nth(0).locator('[data-role="remove"]').click();
  await expect(chips(page)).toHaveCount(1);
  await expect(lightbox(page)).toHaveCount(0);
  await chips(page).nth(0).locator('[data-role="remove"]').click();
  await expect(chips(page)).toHaveCount(0);
  await expect(lightbox(page)).toHaveCount(0);
  await expect(peek(page)).toHaveCount(0);
});

test('removing the reference being peeked at takes its card with it', async ({ page }) => {
  await seedRefs(page, 2);
  await chips(page).nth(1).hover();
  await expect(peek(page)).toBeVisible();
  // the x is hover-revealed and pointer-only: settle on it before pressing,
  // the way a hand does, or a click issued in the same frame the card
  // mounts can land before the x is live (it did, once in three runs)
  const x = chips(page).nth(1).locator('[data-role="remove"]');
  await x.hover();
  await x.click();
  await expect(chips(page)).toHaveCount(1);
  // no orphan card left pointing at a chip that stopped existing
  await expect(peek(page)).toHaveCount(0);
});

test('dragging a reference reorders it and does not open a picture on the drop', async ({ page }) => {
  await seedRefs(page, 2);
  const moved = await chipHash(page, 1);
  const chipBox = (await chips(page).nth(1).boundingBox())!;
  const lineBox = (await line(page).boundingBox())!;

  await page.mouse.move(Math.round(chipBox.x + chipBox.width / 2), Math.round(chipBox.y + chipBox.height / 2));
  await page.mouse.down();
  await page.mouse.move(Math.round(chipBox.x + chipBox.width / 2 + 12), Math.round(chipBox.y + chipBox.height / 2), {
    steps: 3,
  });
  await page.mouse.move(Math.round(lineBox.x + 3), Math.round(lineBox.y + lineBox.height / 2), { steps: 6 });
  await expect(page.locator('.sc-drop-caret')).toBeVisible();
  await page.mouse.up();

  await expect.poll(() => chipHash(page, 0)).toBe(moved);
  // the click that ends every drag is eaten, so nothing opened behind it
  await expect(lightbox(page)).toHaveCount(0);
});

test('the keyboard takes the same two steps: focus shows the card, Enter opens it', async ({ page }) => {
  await seedRefs(page, 1);
  const hash = await chipHash(page, 0);
  await chips(page).first().focus();
  await page.keyboard.press('Enter');
  await expect(lightbox(page)).toBeVisible();
  expect(await lightboxSrc(page)).toBe(`/api/images/${hash}`);
  await page.keyboard.press('Escape');
  await expect(lightbox(page)).toHaveCount(0);
});

test('peeking and opening change nothing the compiler reads, and leave prose selectable', async ({ page }) => {
  await seedRefs(page, 2);
  await page.keyboard.type(' hello world');
  const before = await tokens(page);

  await chips(page).nth(0).hover();
  await expect(peek(page)).toBeVisible();
  await peek(page).click();
  await expect(lightbox(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(lightbox(page)).toHaveCount(0);

  // same tokens, same order: looking at one is not an edit
  expect(await tokens(page)).toEqual(before);

  // and the words around the chips still select the way they did
  await page
    .locator('.sc-brief-line')
    .first()
    .click({ position: { x: 6, y: 6 } });
  await page.keyboard.press('ControlOrMeta+a');
  const picked = await page.evaluate(() => window.getSelection()?.toString() ?? '');
  expect(picked).toContain('hello world');
});

test('the shot record reads each ingredient once, and names the world it keeps', async ({ page }) => {
  await page.goto('/');
  await page.waitForURL((u) => {
    const seg = u.pathname.split('/').filter(Boolean);
    return seg.length === 1 && seg[0] !== 'setup';
  });
  const slug = decodeURIComponent(new URL(page.url()).pathname.split('/')[1]);

  // a generation asking for a product at a named angle inside a scene, then a
  // refinement that re-attaches the SAME product with no angle: the two token
  // shapes differ, so the server records it both asked-for and carried
  const made = await page.evaluate(async () => {
    const brands = await (await fetch('/api/brands')).json();
    const ws = await (await fetch(`/api/brands/${brands[0].id}/workspace`)).json();
    const scenes = ((await (await fetch('/api/scenes')).json()).scenes ?? []) as { id: string; name: string }[];
    const wait = async (id: string) => {
      for (let t = 0; t < 80; t++) {
        const n = await (await fetch(`/api/nodes/${id}`)).json();
        if (n.status !== 'running') return n;
        await new Promise((r) => setTimeout(r, 100));
      }
      throw new Error('never finished');
    };
    const gen = await (
      await fetch('/api/nodes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          projectId: ws.project.id,
          kind: 'generation',
          engineId: 'demo',
          count: 1,
          brief: {
            tokens: [
              { t: 'format', id: 'square', w: 512, h: 512 },
              { t: 'text', v: 'on a stone ledge' },
              { t: 'product', id: 'cold-brew-can', angle: 'detail' },
              { t: 'template', id: scenes[0].id },
            ],
          },
        }),
      })
    ).json();
    const genNode = await wait(gen.id);
    const edit = await (
      await fetch('/api/nodes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          projectId: ws.project.id,
          parentId: genNode.id,
          kind: 'edit',
          engineId: 'demo',
          sourceImage: genNode.images[0],
          brief: {
            tokens: [
              { t: 'text', v: 'warmer light' },
              { t: 'product', id: 'cold-brew-can' },
            ],
          },
        }),
      })
    ).json();
    const editNode = await wait(edit.id);
    return {
      editId: edit.id as string,
      sceneName: scenes[0].name as string,
      inherited: (editNode.brief?.inherited ?? []) as { t: string }[],
    };
  });

  await page.goto(`/${slug}/create/shots/${made.editId}`);
  // one product chip, however many token shapes recorded it: the asked-for
  // copy wins, the carried angle twin collapses into it
  await expect(page.locator('.sc-ingredient[data-kind="product"]')).toHaveCount(1);
  await expect(page.locator('.sc-ingredient[data-kind="product"]')).not.toHaveAttribute('data-inherited', /.*/);
  // The header's source cards name the world the thread was shot in: the
  // refine never re-sends the scene, the photograph carries it, and the
  // record repeats nothing the header already says.
  await expect(page.locator('.sc-source-chip', { hasText: made.sceneName })).toBeVisible();
  await expect(page.locator('.sc-ingredient[data-world]')).toHaveCount(0);
});
