import { test, expect, type Page } from '@playwright/test';

/**
 * The caret and focus behaviour of the brief.
 *
 * These cases cannot be written in jsdom: only trusted events move focus, and
 * Chromium's editing caret is a (node, offset) anchor that behaves differently
 * from what the Selection API reports. Every regression in this area this far
 * has been invisible to unit tests and obvious within seconds of real clicking,
 * so this spec clicks and types for real.
 */

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
  // Start from a clean brief whatever the last run left behind — including a
  // refine target, which now survives in the saved draft on purpose and would
  // otherwise arrive as a chip nobody in this test asked for.
  const chipX = page.locator('.sc-target-x');
  if (await chipX.isVisible().catch(() => false)) await chipX.click();
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
  await dock(page).locator('.sc-prompt-pills [aria-label="2 variants"]').click();
  await page.getByRole('menuitem', { name: '3 variants' }).click();
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
  await page.keyboard.type('#');
  await page.locator('.sc-cmd-row').first().waitFor();
  await page.locator('.sc-cmd-row').first().click();

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

  await page.route('**/api/brands/*/workspace', async (route) => {
    const res = await route.fetch();
    const ws = await res.json();
    const donor = (ws.nodes ?? []).find((n: any) => n.kind !== 'root' && n.status === 'done' && n.images.length);
    existingImage = donor?.images?.[0] ?? null;
    if (donor && !(ws.nodes ?? []).some((n: any) => n.id === REFINED)) {
      ws.nodes.push({ ...donor, id: REFINED, parentId: donor.id, kind: 'edit', prompt: 'made it tighter' });
    }
    await route.fulfill({ response: res, json: ws });
  });
  await page.route('**/api/nodes', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
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

  await expect(page.locator('.sc-target-note')).toHaveText('Still rendering. This can be refined the moment it lands.');
  await expect(dock(page).locator('.sc-send')).toHaveAttribute('aria-disabled', 'true');
});

test('typing after a chip added from the plus menu', async ({ page }) => {
  await page.keyboard.type('change the background color of this ');
  await plusMenu(page, /shots/i);
  await pickCard(page);
  await page.keyboard.type('to warm beige');
  expect(await sentence(page)).toMatch(/reference\s*to warm beige$/);
});

test('a chip lands at the caret, not at the end', async ({ page }) => {
  await page.keyboard.type('shoot it in golden light');
  // put the caret after "shoot it"
  for (let i = 0; i < ' in golden light'.length; i++) await page.keyboard.press('ArrowLeft');
  await plusMenu(page, /product/i);
  await pickCard(page);
  await page.keyboard.type('X');
  const text = await sentence(page);
  expect(text.startsWith('shoot it ')).toBe(true);
  expect(text).toMatch(/X\s*in golden light$/); // typing carried on after the chip
});

test('@ reaches for an ingredient and typing carries on', async ({ page }) => {
  await page.keyboard.type('put the ');
  await page.keyboard.type('@');
  await page.locator('.sc-cmd-row').first().waitFor();
  await page.locator('.sc-cmd-row').first().click();
  await page.keyboard.type('on ice');
  const text = await sentence(page);
  expect(text).not.toContain('@');
  expect(text).toMatch(/on ice$/);
});

test('# reaches for a scene, and offers only scenes', async ({ page }) => {
  await page.keyboard.type('a shot ');
  await page.keyboard.type('#');
  await page.locator('.sc-cmd-row').first().waitFor();
  // the sigil is the filter: a scene menu never lists products or colors
  const groups = await page.locator('.sc-cmd-group').allInnerTexts();
  expect(groups.every((g) => /scenes/i.test(g))).toBe(true);
  await page.locator('.sc-cmd-row').first().click();
  await page.keyboard.type('at dawn');
  const text = await sentence(page);
  expect(text).not.toContain('#');
  expect(text).toMatch(/at dawn$/);
});

test('a hex colour is text, not a scene query', async ({ page }) => {
  await page.keyboard.type('keep the cap #F5C518 exactly');
  // the menu must not be open, and nothing may have been eaten
  await expect(page.locator('.sc-cmd')).toHaveCount(0);
  expect(await sentence(page)).toContain('#F5C518');
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

  await clickAtChar(page, 2, 9); // inside "charlie delta"
  await page.keyboard.type('@');
  expect(await sentence(page)).toMatch(/charlie @delta/);
});

test('backspace over a chip removes it and leaves one space', async ({ page }) => {
  await page.keyboard.type('one ');
  await plusMenu(page, /product/i);
  await pickCard(page);
  await page.keyboard.type('two');
  await expect(chips(page)).toHaveCount(1);

  // walk back over "two" and the space, then delete the chip itself
  for (let i = 0; i < 'two '.length; i++) await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Backspace');
  await expect(chips(page)).toHaveCount(0);
  expect(await sentence(page)).not.toMatch(/ {2}/);
});

test('changing aspect and quality does not disturb the sentence', async ({ page }) => {
  // A desktop composer has the room to state all three settings, so they are
  // pills in the row. What is under test either way is the caret: changing a
  // setting must not repaint the sentence or steal the place you were typing.
  await page.keyboard.type('a careful sentence');
  const pills = () => dock(page).locator('.sc-prompt-pills');

  await pills().locator('[aria-label^="Aspect"]').click();
  await page.getByRole('menuitem', { name: /9:16/ }).click();
  // the menu hands the caret back as it closes, so typing before it has gone
  // puts the next keystroke somewhere nobody asked for
  await expect(page.locator('[role="menuitem"]')).toHaveCount(0);
  await page.keyboard.type(' more');

  await pills().locator('[aria-label^="Quality"]').click();
  await page.getByRole('menuitem', { name: /^High/ }).click();
  await expect(page.locator('[role="menuitem"]')).toHaveCount(0);
  await page.keyboard.type(' still');

  // the sentence never repainted, and the caret came back both times
  expect(await sentence(page)).toBe('a careful sentence more still');
  expect(await page.evaluate(() => localStorage.getItem('scenri:format'))).toBe('"story"');
  expect(await page.evaluate(() => localStorage.getItem('scenri:quality'))).toBe('"high"');
});

test('copy and paste rebuilds the chips', async ({ page }) => {
  await page.keyboard.type('hero of ');
  await plusMenu(page, /product/i);
  await pickCard(page);
  await page.keyboard.type('at dusk');
  const original = await sentence(page);

  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('ControlOrMeta+c');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ControlOrMeta+v');

  await expect(chips(page)).toHaveCount(2);
  expect(await sentence(page)).toContain(original.trim());
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
test('a new shape while refining runs the setup again rather than editing', async ({ page }) => {
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

  await expect(composer.locator('.sc-send')).toContainText('Generate');
  await expect(composer).toContainText('A new shape starts a new shot from this setup.');

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

  await expect.poll(() => posted?.kind).toBe('generation');
  expect(posted.brief.format).toBe('landscape');
  // and a fresh shot rather than a child of the one on screen
  expect(posted.parentId).not.toBe(shot);
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
  await expect(page.locator('.sc-swap-capped')).toHaveCount(0);
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
  const ids: string[] = await page.evaluate(async () => {
    const r = await fetch('/api/demo-products');
    const j = await r.json();
    return j.demoProducts.map((p: { id: string }) => p.id);
  });
  expect(ids.length).toBeGreaterThan(1);

  await plusMenu(page, /library/i);
  await pickCard(page, 0);
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

test('one list, with the brand’s own products before the ones scenri ships', async ({ page }) => {
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
