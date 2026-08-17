import { test, expect, type Page } from '@playwright/test';
import { isolate } from './harness.js';

/**
 * The composer at hand width.
 *
 * The row used to hold six controls at any width, so on a phone the engine chip
 * and the aspect pill drew on top of each other. These cases are the floor: the
 * row never overflows its card, a finger always has something to hit, and the
 * three shot settings are reachable from wherever they ended up.
 *
 * Real devices rather than a resized desktop, because the touch rules hang off
 * `pointer: coarse` and a narrow desktop window does not report it.
 */

// A scenri of this file's own, on an empty home, seeded from scratch.
isolate();

const line = (p: Page) => p.locator('.sc-brief-line').first();
const row = (p: Page) => p.locator('.sc-prompt-row').first();
const chip = (p: Page) => p.locator('.sc-shotset');
const pills = (p: Page) => p.locator('.sc-prompt-right > .sc-var:not(.sc-shotset)');

const isPhone = (p: Page) => (p.viewportSize()?.width ?? 0) < 768;

/** What the row spills, if anything. 1px of rounding is not a spill. */
async function overflow(p: Page): Promise<number> {
  return p.evaluate(() => {
    const el = document.querySelector('.sc-prompt-row') as HTMLElement;
    return el.scrollWidth - el.clientWidth;
  });
}

test.beforeEach(async ({ page }) => {
  // Straight to the hub, and never through Home.
  //
  // Home was only ever a way to learn the brand's slug, and it costs a wall of
  // showcase imagery to render: around forty-five thumbnails, still in flight
  // when the next `goto` navigated away from them. Chromium drops those and
  // moves on. WebKit holds their connections, and on the iPad project the
  // bundles the hub needed then starved behind them — the document arrived in
  // 61ms and `index.js` never arrived at all, so the app never booted and this
  // hook timed out waiting for a brief that could not exist. Asking the API for
  // the slug costs one request and loads no pictures.
  const [brand] = (await (await page.request.get('/api/brands')).json()) as { slug: string }[];
  await page.goto(`/${brand.slug}/create`);
  await line(page).waitFor();
});

test('the control row never spills its card', async ({ page }) => {
  const sizes = isPhone(page)
    ? [
        { width: 320, height: 720 },
        { width: 390, height: 844 },
      ]
    : [
        { width: 768, height: 1024 },
        { width: 1024, height: 768 },
      ];

  for (const size of sizes) {
    await page.setViewportSize(size);
    await expect.poll(() => overflow(page), { message: `row overflows at ${size.width}px` }).toBeLessThanOrEqual(1);
  }
});

test('every control in the row is big enough for a finger', async ({ page }) => {
  const controls = row(page).locator('button:visible');
  const count = await controls.count();
  expect(count).toBeGreaterThan(2);
  for (let i = 0; i < count; i++) {
    const box = await controls.nth(i).boundingBox();
    if (!box) continue;
    // 40px is the graphic; coarse pointers get to 44 through an invisible box
    expect(box.height, `control ${i} is ${box.height}px tall`).toBeGreaterThanOrEqual(30);
    const reach = await controls.nth(i).evaluate((el) => {
      const after = getComputedStyle(el, '::after');
      return Math.max(el.getBoundingClientRect().height, Number.parseFloat(after.height) || 0);
    });
    expect(reach, `control ${i} reaches only ${reach}px`).toBeGreaterThanOrEqual(40);
  }
});

test('a phone opens the same settings as a sheet, not as a popover', async ({ page }) => {
  test.skip(!isPhone(page), 'the popover has the room above 768px');

  // One trigger on screen at a time: the sheet chip here, More on a desktop.
  await expect(chip(page)).toBeVisible();
  await expect(page.locator('.sc-prompt-right .sc-more')).toBeHidden();

  await chip(page).click();
  const sheet = page.locator('.sc-shotsheet');
  await expect(sheet).toBeVisible();

  // two settings in one visit, because nothing here closes the sheet
  await sheet.locator('.sc-seg-o', { hasText: /^High$/ }).click();
  await sheet.locator('.sc-seg-o', { hasText: /^9:16$/ }).click();
  await expect(sheet).toBeVisible();
  await expect(sheet.locator('.sc-seg-o[data-on]', { hasText: /^High$/ })).toHaveCount(1);

  // the sheet is the state, not a copy of it
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  expect(await page.evaluate(() => localStorage.getItem('scenri:quality'))).toBe('"high"');
  expect(await page.evaluate(() => localStorage.getItem('scenri:format'))).toBe('"story"');
});

/**
 * Where the grip has come to rest.
 *
 * A sheet slides up when it opens, so a box read the moment it mounts names a
 * place the grip is about to leave. Pressing there put the pointer on the
 * scrim below the risen sheet, Radix read that as a click outside, and the
 * drag case failed having never touched the thing it meant to drag.
 */
async function settledBox(p: Page, sel: string) {
  let last = (await p.locator(sel).boundingBox())!;
  for (let i = 0; i < 20; i++) {
    await p.waitForTimeout(50);
    const now = (await p.locator(sel).boundingBox())!;
    if (Math.abs(now.y - last.y) < 0.5) return now;
    last = now;
  }
  return last;
}

/**
 * Drag a sheet down by its grip, as a hand would.
 *
 * The sheet leaves on distance *or* on speed — `moved > 96 || speed > 0.45`
 * px/ms in IngredientPicker.tsx and ShotSettings.tsx — and playwright
 * dispatches the whole move in one go, so a gentle 24px pull arrives at
 * ~5px/ms and reads as a flick. The hold before releasing is what makes the
 * gesture mean what it says: without it, on a fast machine, "a nudge"
 * dismissed the sheet the nudge exists to prove it survives.
 */
async function dragSheet(p: Page, grip: string, dy: number) {
  const box = await settledBox(p, grip);
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await p.mouse.move(x, y);
  await p.mouse.down();
  await p.mouse.move(x, y + dy, { steps: 10 });
  await p.waitForTimeout(200);
  await p.mouse.up();
}

test('the sheet is dragged away, and springs back from a nudge', async ({ page }) => {
  test.skip(!isPhone(page), 'the sheet only exists below 768px');

  const sheet = page.locator('.sc-shotsheet');
  const pull = (dy: number) => dragSheet(page, '.sc-shotsheet-grip', dy);

  // a nudge is not an intention: the sheet stays, and stays put
  await chip(page).click();
  await expect(sheet).toBeVisible();
  await pull(24);
  await expect(sheet).toBeVisible();
  await expect.poll(() => sheet.evaluate((el) => el.style.transform)).toBe('');

  // a real pull sends it away
  await pull(200);
  await expect(sheet).toBeHidden();
});

test('a tablet keeps the full row', async ({ page }) => {
  test.skip(isPhone(page), 'a phone has no room for it');

  await expect(chip(page)).toBeHidden();
  await expect(pills(page)).not.toHaveCount(0);
  for (const pill of await pills(page).all()) await expect(pill).toBeVisible();
});

test('focusing the brief cannot zoom the page', async ({ page }) => {
  // iOS zooms whenever it focuses a control computing under 16px
  const size = await line(page).evaluate((el) => Number.parseFloat(getComputedStyle(el).fontSize));
  expect(size).toBeGreaterThanOrEqual(16);
});

/**
 * The feed's controls are one row on a phone, not two.
 *
 * Wrapping gave the lenses their own line and the place, search and view a
 * second, and the pair cost 114px of a 664px screen to filter a feed that had
 * 324px left to show pictures in. The rail scrolls, so it is the part that
 * gives.
 */
test('the feed controls share one row on a phone', async ({ page }) => {
  test.skip(!isPhone(page), 'the two-row wrap only ever happened under 768px');

  const toolbar = page.locator('.sc-toolbar');
  await expect(toolbar).toBeVisible();

  const rows = await page.evaluate(() => {
    const bar = document.querySelector('.sc-toolbar') as HTMLElement;
    // the groups are centred against each other, so equal tops would be the
    // wrong test: what makes it one row is that every band overlaps the same
    // horizontal slice
    const boxes = [...bar.children].map((el) => el.getBoundingClientRect());
    const top = Math.max(...boxes.map((b) => b.top));
    const bottom = Math.min(...boxes.map((b) => b.bottom));
    return {
      groups: boxes.length,
      sharedBand: Math.round(bottom - top),
      height: Math.round(bar.getBoundingClientRect().height),
      overflows: Math.round(bar.getBoundingClientRect().right) > document.documentElement.clientWidth,
    };
  });

  // scope and actions each cross one shared band, and the bar stays under the
  // height two stacked rows of controls would need
  expect(rows.groups).toBe(2);
  expect(rows.sharedBand).toBeGreaterThan(20);
  expect(rows.height).toBeLessThan(80);
  expect(rows.overflows).toBe(false);

  // the rail reaches every lens by scrolling rather than by wrapping — and
  // when three lenses do fit, it says so by not claiming an edge it has not got
  const rail = page.locator('.sc-toolbar .sc-verticals');
  const scrolls = await rail.evaluate((el) => el.scrollWidth > el.clientWidth + 1);
  const shell = page.locator('.sc-toolbar .sc-verticals-shell');
  if (scrolls) await expect(shell).toHaveAttribute('data-overflow-right', '');
  else await expect(shell).not.toHaveAttribute('data-overflow-right', '');
});

/**
 * Search takes the row rather than floating over the tabs, the same move the
 * library filterbar makes when it runs out of width. One search behaviour, not
 * a second one to learn — and the row stays one row while it happens.
 */
test('search takes the feed row on a phone rather than covering it', async ({ page }) => {
  test.skip(!isPhone(page), 'the row takeover is the phone answer only');

  const toolbar = page.locator('.sc-toolbar');
  await expect(toolbar).toBeVisible();
  const before = await toolbar.evaluate((el) => Math.round(el.getBoundingClientRect().height));

  await page.locator('.sc-toolbar .sc-libsearch-toggle').click();
  const field = page.locator('.sc-toolbar .sc-libsearch input');
  await expect(field).toBeFocused();

  // the scope group steps aside, the field takes the width it left, and the
  // row is exactly as tall as it was
  await expect(page.locator('.sc-toolbar-scope')).toBeHidden();
  const after = await toolbar.evaluate((el) => Math.round(el.getBoundingClientRect().height));
  expect(after).toBe(before);

  const wide = await page
    .locator('.sc-toolbar .sc-libsearch-field')
    .evaluate((el) => el.getBoundingClientRect().width > 200);
  expect(wide).toBe(true);

  // escape gives the row back
  await page.keyboard.press('Escape');
  await expect(page.locator('.sc-toolbar-scope')).toBeVisible();
});

/**
 * A scene section leads with scenes. The per-collection index listed every
 * scene by name above the grid that showed those same scenes with pictures, so
 * one collection put seventeen 15px-tall links above the fold and pushed every
 * photograph below it.
 */
test('a scene collection shows pictures, not a list of its own names', async ({ page }) => {
  test.skip(!isPhone(page), 'the index still serves as a quick jump on a wide screen');

  const brand = new URL(page.url()).pathname.split('/')[1];
  await page.goto(`/${brand}/scenes`);
  await expect(page.locator('.sc-coll').first()).toBeVisible();

  await expect(page.locator('.sc-coll-names').first()).toBeHidden();

  // the first scene card is on screen without scrolling
  const card = page.locator('.sc-coll .sc-lookcard, .sc-coll [class*="lookcard"]').first();
  await expect(card).toBeVisible();
  const top = await card.evaluate((el) => el.getBoundingClientRect().top);
  const vh = page.viewportSize()?.height ?? 0;
  expect(top).toBeLessThan(vh * 0.6);
});

/**
 * The overlay's top actions are one header, not two bars sharing a line.
 *
 * They used to be a fixed bar (close, versions) and a separate tools row that
 * was the stage's own first child, neither aware of the other. On a phone they
 * overlapped — 67px at 320 and 32px at 390, with "Next version" sitting
 * entirely under the cost chip. One flex row cannot do that at any width.
 */
test('the shot header never overlaps itself, and collapses to one overflow on a phone', async ({ page }) => {
  const brand = new URL(page.url()).pathname.split('/')[1];

  // a finished shot to open
  const shot = await page.evaluate(async (slug) => {
    const brands = await (await fetch('/api/brands')).json();
    const b = brands.find((x: any) => x.slug === slug);
    const ws = await (await fetch(`/api/brands/${b.id}/workspace`)).json();
    const done = (ws.nodes ?? []).find((n: any) => n.kind !== 'root' && n.status === 'done' && n.images.length);
    if (done) return done.id;
    const root = (ws.nodes ?? []).find((n: any) => n.kind === 'root');
    const made = await (
      await fetch('/api/nodes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          projectId: ws.project.id,
          parentId: root?.id ?? null,
          kind: 'generation',
          prompt: 'header spec shot',
          engineId: 'demo',
          count: 1,
        }),
      })
    ).json();
    for (let i = 0; i < 40; i++) {
      const t = await (await fetch(`/api/brands/${b.id}/workspace`)).json();
      const n = (t.nodes ?? []).find((x: any) => x.id === made.id);
      if (n?.status === 'done') return n.id;
      await new Promise((r) => setTimeout(r, 300));
    }
    throw new Error('demo generation never finished');
  }, brand);

  await page.goto(`/${brand}/create/shots/${shot}`);
  await expect(page.locator('.sc-ovl-bar')).toBeVisible();

  // nothing in the header sits on anything else, and nothing leaves the screen
  const geom = await page.evaluate(() => {
    const bar = document.querySelector('.sc-ovl-bar') as HTMLElement;
    const vis = (el: Element) => getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().width > 0;
    const boxes = [...bar.querySelectorAll('button')].filter(vis).map((el) => el.getBoundingClientRect());
    let worst = 0;
    for (let i = 0; i < boxes.length; i++)
      for (let k = i + 1; k < boxes.length; k++) {
        const ix = Math.min(boxes[i].right, boxes[k].right) - Math.max(boxes[i].left, boxes[k].left);
        const iy = Math.min(boxes[i].bottom, boxes[k].bottom) - Math.max(boxes[i].top, boxes[k].top);
        if (ix > 0 && iy > 0) worst = Math.max(worst, Math.round(ix));
      }
    return {
      worstOverlap: worst,
      offScreen: boxes.some((b) => b.right > innerWidth + 1 || b.left < -1),
      count: boxes.length,
    };
  });
  expect(geom.worstOverlap).toBe(0);
  expect(geom.offScreen).toBe(false);

  if (isPhone(page)) {
    // the picture's actions live behind one control, and the price is not an
    // action so it is not in the action row at all
    await expect(page.locator('.sc-ovl-acts')).toBeHidden();
    await expect(page.locator('.sc-ovl-bar .sc-ovl-cost')).toBeHidden();
    const overflow = page.locator('.sc-ovl-overflow');
    await expect(overflow).toBeVisible();

    await overflow.tap();
    await expect(page.getByRole('menuitem', { name: 'Export' })).toBeVisible();
    // and the menu opens fully on screen rather than half off the right edge
    const fits = await page.evaluate(() => {
      const m = document.querySelector('[data-radix-popper-content-wrapper]');
      if (!m) return false;
      const r = m.getBoundingClientRect();
      return r.left >= 0 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1;
    });
    expect(fits).toBe(true);
  } else {
    // a tablet has the room, so the actions stay visible as buttons
    await expect(page.locator('.sc-ovl-acts')).toBeVisible();
    await expect(page.locator('.sc-ovl-overflow')).toBeHidden();
  }
});

/**
 * The shot, its takes and the header do not touch.
 *
 * The phone rule set the stage to `display: block`, which threw away the base
 * grid's `gap`, and gave it `padding-top: 0`. Measured, the picture began at
 * the exact pixel the header ended and the row of takes began at the exact
 * pixel the picture ended: three things stacked with no air between any of them.
 */
test('the shot has room around it on a phone', async ({ page }) => {
  test.skip(!isPhone(page), 'the phone rule is the one that dropped the gaps');

  const brand = new URL(page.url()).pathname.split('/')[1];
  const shot = await page.evaluate(async (slug) => {
    const brands = await (await fetch('/api/brands')).json();
    const b = brands.find((x: any) => x.slug === slug);
    const ws = await (await fetch(`/api/brands/${b.id}/workspace`)).json();
    const many = (ws.nodes ?? []).find((n: any) => n.status === 'done' && (n.images?.length ?? 0) > 1);
    if (many) return many.id;
    const root = (ws.nodes ?? []).find((n: any) => n.kind === 'root');
    const made = await (
      await fetch('/api/nodes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          projectId: ws.project.id,
          parentId: root?.id ?? null,
          kind: 'generation',
          prompt: 'stage rhythm shot',
          engineId: 'demo',
          count: 2,
        }),
      })
    ).json();
    for (let i = 0; i < 40; i++) {
      const t = await (await fetch(`/api/brands/${b.id}/workspace`)).json();
      const n = (t.nodes ?? []).find((x: any) => x.id === made.id);
      if (n?.status === 'done') return n.id;
      await new Promise((r) => setTimeout(r, 300));
    }
    throw new Error('demo generation never finished');
  }, brand);

  await page.goto(`/${brand}/create/shots/${shot}`);
  await expect(page.locator('.sc-ovl-stage img').first()).toBeVisible();

  const gaps = await page.evaluate(() => {
    const stage = document.querySelector('.sc-ovl-stage') as HTMLElement;
    const bar = document.querySelector('.sc-ovl-bar')!.getBoundingClientRect();
    const img = stage.querySelector('img')!.getBoundingClientRect();
    const kids = [...stage.children];
    const takes = kids.length > 1 ? kids[kids.length - 1].getBoundingClientRect() : null;
    return {
      headerToShot: Math.round(img.top - bar.bottom),
      shotToTakes: takes ? Math.round(takes.top - img.bottom) : null,
    };
  });

  expect(gaps.headerToShot).toBeGreaterThanOrEqual(8);
  if (gaps.shotToTakes !== null) expect(gaps.shotToTakes).toBeGreaterThanOrEqual(8);
});

/**
 * A short viewport must not cost the picture its width. The cap is a height and
 * the picture keeps its shape, so capping the height shrank it in both
 * directions: a square shot rendered 45% of the column on a 400px-tall window
 * and 93% on a real 844px phone, which is why a device emulator with the panel
 * docked looked broken while the phone looked right.
 */
test('a short window does not shrink the shot into the middle of the stage', async ({ page }) => {
  test.skip(!isPhone(page), 'measured against the phone stage cap');

  const brand = new URL(page.url()).pathname.split('/')[1];
  await page.setViewportSize({ width: 390, height: 420 });
  await page.goto(`/${brand}/create`);
  const tile = page.locator('.sc-cell-open').first();
  await tile.waitFor();
  await tile.click();
  await expect(page.locator('.sc-ovl-stage img').first()).toBeVisible();

  const share = await page.evaluate(() => {
    const stage = document.querySelector('.sc-ovl-stage')!.getBoundingClientRect();
    const img = document.querySelector('.sc-ovl-stage img')!.getBoundingClientRect();
    const cs = getComputedStyle(document.querySelector('.sc-ovl-stage')!);
    const column = stage.width - Number.parseFloat(cs.paddingLeft) - Number.parseFloat(cs.paddingRight);
    return img.width / column;
  });
  expect(share).toBeGreaterThan(0.6);
});

/**
 * A tile says what its picture is in one row, in one corner, in one grammar.
 *
 * It used to be three: provenance as a full-radius sans pill at the top left
 * (nudged right to dodge a selection box that is always on under a finger, so
 * it floated mid-air), the variant count as a small-radius mono chip at the
 * bottom left, and the version count the same chip stacked 26px above it. The
 * Refine pill claimed the same bottom line from the other side, which is why
 * both carried a max-width of half the tile — a truncation whose only job was
 * to make a collision less likely.
 */
test('a feed tile states its facts in one row without truncating them', async ({ page }) => {
  const bars = page.locator('.sc-cell-bar');
  await expect(bars.first()).toBeAttached();

  const report = await page.evaluate(() => {
    const out: { truncated: string[]; overlap: number; outside: boolean }[] = [];
    for (const bar of document.querySelectorAll('.sc-cell-bar')) {
      const cell = bar.closest('.sc-cell')!.getBoundingClientRect();
      const items = [...bar.querySelectorAll('.sc-fact, .sc-cell-branch')].filter(
        (el) => getComputedStyle(el).display !== 'none',
      );
      if (!items.length) continue;
      const boxes = items.map((el) => el.getBoundingClientRect());
      let overlap = 0;
      for (let i = 0; i < boxes.length; i++)
        for (let k = i + 1; k < boxes.length; k++) {
          const ix = Math.min(boxes[i].right, boxes[k].right) - Math.max(boxes[i].left, boxes[k].left);
          const iy = Math.min(boxes[i].bottom, boxes[k].bottom) - Math.max(boxes[i].top, boxes[k].top);
          if (ix > 0 && iy > 0) overlap = Math.max(overlap, Math.round(ix));
        }
      out.push({
        truncated: [...bar.querySelectorAll('.sc-fact')]
          .filter((el) => el.scrollWidth > el.clientWidth + 1)
          .map((el) => el.textContent!.trim()),
        overlap,
        outside: boxes.some((b) => b.left < cell.left - 1 || b.right > cell.right + 1),
      });
    }
    return out;
  });

  expect(report.length).toBeGreaterThan(0);
  for (const r of report) {
    expect(r.truncated, 'a fact was cut off to make room').toEqual([]);
    expect(r.overlap, 'two things on the tile bar overlap').toBe(0);
    expect(r.outside, 'something on the tile bar left the tile').toBe(false);
  }
});

/**
 * Changing an ingredient with a thumb.
 *
 * The chip's old menu had no mobile rules at all: a fixed 256px box, always
 * drawn above its anchor, positioned against `window.innerHeight` while the
 * anchor rect is in visual-viewport coordinates. With the keyboard up it landed
 * off the screen. A phone gets a sheet instead, and the tap that opens it is
 * the one that must not raise the keyboard in the first place.
 */

const briefChips = (p: Page) => p.locator('.sc-brief-line .sc-token');
const sheet = (p: Page) => p.locator('.sc-swapsheet');

/** Put one scene chip in the brief, whatever width we are at. */
async function seedScene(p: Page) {
  await p.locator('.sc-canvas-dock .sc-attach-toggle').click();
  await p.locator('.sc-ap-tabs button', { hasText: /scenes/i }).click();
  await p.locator('.sc-ap-card:not(.sc-ap-add)').first().click();
  await expect(briefChips(p)).not.toHaveCount(0);
  await p.keyboard.press('Escape');
}

async function tapChip(p: Page) {
  const box = (await briefChips(p).first().boundingBox())!;
  await p.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
}

test('a phone gets a sheet, a tablet gets the anchored panel', async ({ page }) => {
  await seedScene(page);
  await tapChip(page);

  if (isPhone(page)) {
    await expect(sheet(page)).toBeVisible();
    await expect(page.locator('.sc-swap')).toHaveCount(0);
  } else {
    // proves the shell is chosen by the 768 breakpoint and not by pointer:coarse
    await expect(page.locator('.sc-swap')).toBeVisible();
    await expect(sheet(page)).toHaveCount(0);
  }
});

test('opening the picker by touch raises no keyboard, from either end', async ({ page }) => {
  await seedScene(page);
  await tapChip(page);
  await expect(page.locator('.sc-swapsheet, .sc-swap')).toBeVisible();
  const focused = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    return { cls: el?.className ?? '', tag: el?.tagName ?? '' };
  });
  // the brief is what the tap would have focused natively...
  expect(focused.cls).not.toContain('sc-brief-line');
  // ...and the search field is what the shell would have focused for us. Both
  // of them summon the software keyboard over the pictures.
  expect(focused.tag).not.toBe('INPUT');
});

test('the search still takes the keyboard when it is tapped', async ({ page }) => {
  await seedScene(page);
  await tapChip(page);
  const input = page.locator('.sc-swap-search input');
  await input.tap();
  await expect(input).toBeFocused();
});

test('the picker sheet is dragged away, and can be opened again straight after', async ({ page }) => {
  test.skip(!isPhone(page), 'the sheet only exists below 768px');
  await seedScene(page);
  await tapChip(page);
  await expect(sheet(page)).toBeVisible();

  const pull = (dy: number) => dragSheet(page, '.sc-swapsheet .sc-shotsheet-grip', dy);

  await pull(24);
  await expect(sheet(page)).toBeVisible();

  await pull(200);
  // Wait for the scrim to be gone, not merely for the sheet to be invisible:
  // Radix keeps both mounted for the 140ms exit, and while the scrim is there
  // it is what a tap lands on. That is the sheet shell's own timing, shared
  // with the shot settings, and the animation is the feedback that says so.
  await expect(sheet(page)).toHaveCount(0);
  await expect(page.locator('.sc-shotsheet-scrim')).toHaveCount(0);

  // the chip is live again: a dismissal is not a dead end
  await tapChip(page);
  await expect(sheet(page)).toBeVisible();
});

test('one tap swaps the ingredient and the sheet gets out of the way', async ({ page }) => {
  await seedScene(page);
  const before = await briefChips(page).first().textContent();
  await tapChip(page);

  const cards = page.locator('.sc-swap-grid .sc-swap-card');
  await cards.first().waitFor();
  await cards.nth(3).click();
  await expect(page.locator('.sc-swapsheet, .sc-swap')).toHaveCount(0);
  await expect(briefChips(page)).toHaveCount(1);
  expect(await briefChips(page).first().textContent()).not.toBe(before);
});

test('the picker search cannot zoom the page', async ({ page }) => {
  await seedScene(page);
  await tapChip(page);
  const size = await page
    .locator('.sc-swap-search input')
    .evaluate((el) => Number.parseFloat(getComputedStyle(el).fontSize));
  expect(size).toBeGreaterThanOrEqual(16);
});

test('every picker card is big enough for a thumb', async ({ page }) => {
  await seedScene(page);
  await tapChip(page);
  const cards = page.locator('.sc-swap-grid .sc-swap-card');
  await cards.first().waitFor();
  const n = Math.min(await cards.count(), 8);
  for (let i = 0; i < n; i++) {
    const box = (await cards.nth(i).boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
});

test('a phone docks the insert menu to the composer, not the caret', async ({ page }) => {
  test.skip(!isPhone(page), 'phone shell only');
  await line(page).click();
  await page.keyboard.type('#');
  const menu = page.locator('.sc-cmd');
  await menu.waitFor();
  await expect(menu).toHaveAttribute('data-shell', 'dock');
  const menuBox = (await menu.boundingBox())!;
  const card = (await page.locator('.sc-promptcard').first().boundingBox())!;
  expect(menuBox.y + menuBox.height).toBeLessThanOrEqual(card.y + 2);
  expect(Math.abs(menuBox.x - card.x)).toBeLessThanOrEqual(2);
  expect(Math.abs(menuBox.width - card.width)).toBeLessThanOrEqual(2);
  const row = (await page.locator('.sc-cmd-row').first().boundingBox())!;
  expect(row.height).toBeGreaterThanOrEqual(40);
});
