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

// A Scenri of this file's own, on an empty home, seeded from scratch.
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

  // The grid follows the collection's own heading with nothing in between.
  // Measured against the collection rather than the fold: on a cold brand the
  // catalog sits under the 200px "Build your own scene" offer, so a viewport
  // fraction reads that legitimate first-run copy as the bug this test exists
  // to catch. The index it does catch was seventeen 15px links; a heading and
  // its gap are under 80.
  const card = page.locator('.sc-coll .sc-lookcard, .sc-coll [class*="lookcard"]').first();
  await expect(card).toBeVisible();
  const lede = await page
    .locator('.sc-coll')
    .first()
    .evaluate((section) => {
      const first = section.querySelector('.sc-lookcard, [class*="lookcard"]') as HTMLElement;
      return first.getBoundingClientRect().top - section.getBoundingClientRect().top;
    });
  expect(lede).toBeLessThan(80);
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
    const feed = await (await fetch(`/api/brands/${b.id}/feed?limit=200`)).json();
    const done = (feed.items ?? []).find((n: any) => n.kind !== 'root' && n.status === 'done' && n.images.length);
    if (done) return done.id;
    const root = ws.root ? { id: ws.root as string } : null;
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
      const n = await (await fetch(`/api/nodes/${made.id}`)).json();
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
    // the picture's actions live behind one control
    await expect(page.locator('.sc-ovl-acts')).toBeHidden();
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
    const feed = await (await fetch(`/api/brands/${b.id}/feed?limit=200`)).json();
    const done = (feed.items ?? []).find((n: any) => n.status === 'done' && (n.images?.length ?? 0) > 0);
    if (done) return done.id;
    const root = ws.root ? { id: ws.root as string } : null;
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
          count: 1,
        }),
      })
    ).json();
    for (let i = 0; i < 40; i++) {
      const n = await (await fetch(`/api/nodes/${made.id}`)).json();
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
 * Under a finger, a tile's chrome fits the tile and reaches the thumb.
 *
 * This used to guard a row of fact chips against truncating each other:
 * provenance, a variant count, a version count and a set count all crowded the
 * bottom line beside Refine, and on a 175px tile one of them always lost. The
 * facts are in the shot's own record now and the tile carries controls only,
 * so what is worth guarding changed: every control is inside its tile, no two
 * of them overlap, and each is big enough to hit.
 *
 * 32px rather than the 44px an enhanced target asks for, deliberately: a 44px
 * box centred on a control 8px from the edge of a 176px tile reaches across
 * the 8px gutter and takes taps meant for the tile beside it. 32 clears the
 * 24px minimum with room and stays inside its own tile.
 */
test('a feed tile keeps its controls inside itself and thumb-sized', async ({ page }) => {
  const bars = page.locator('.sc-cell-bar');
  await expect(bars.first()).toBeAttached();

  const report = await page.evaluate(() => {
    const out: { overlap: number; outside: boolean; small: string[] }[] = [];
    for (const cell of document.querySelectorAll('.sc-cell')) {
      const box = cell.getBoundingClientRect();
      const items = [...cell.querySelectorAll('.sc-cell-ctl')].filter(
        (el) => getComputedStyle(el).display !== 'none' && getComputedStyle(el).opacity !== '0',
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
        overlap,
        outside: boxes.some((b) => b.left < box.left - 1 || b.right > box.right + 1),
        small: items
          .map((el, i) => ({ el, box: boxes[i] }))
          .filter(({ box }) => box.width < 32 || box.height < 32)
          .map(({ el }) => el.getAttribute('aria-label') ?? el.className),
      });
    }
    return out;
  });

  expect(report.length).toBeGreaterThan(0);
  for (const r of report) {
    expect(r.overlap, 'two controls on the tile overlap').toBe(0);
    expect(r.outside, 'a control left its tile').toBe(false);
    expect(r.small, 'a control is under the thumb-sized floor').toEqual([]);
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

/**
 * Close the attach picker and wait for it to be gone.
 *
 * On a phone it is a modal sheet: Radix keeps the sheet and its scrim mounted
 * for the 140ms exit, and while the scrim is there it is what a tap lands on
 * and where a trapped focus goes back to. A tablet gets the anchored panel,
 * which has no scrim, so the wait costs nothing there.
 */
async function closeAttach(p: Page) {
  await p.keyboard.press('Escape');
  await expect(p.locator('.sc-attachsheet, .sc-attachpanel')).toHaveCount(0);
  await expect(p.locator('.sc-shotsheet-scrim')).toHaveCount(0);
}

/** Put one scene chip in the brief, whatever width we are at. */
async function seedScene(p: Page) {
  await p.locator('.sc-canvas-dock .sc-attach-toggle').click();
  await p.locator('.sc-ap-tabs button', { hasText: /scenes/i }).click();
  await p.locator('.sc-ap-card:not(.sc-ap-add)').first().click();
  await expect(briefChips(p)).not.toHaveCount(0);
  await closeAttach(p);
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

/** Prose plus one product chip: something for a move to walk through. */
async function seedMovable(p: Page) {
  await line(p).click();
  await p.keyboard.type('marble hall wide ');
  await p.locator('.sc-canvas-dock .sc-attach-toggle').click();
  await p.locator('.sc-ap-tabs button', { hasText: /products/i }).click();
  await p.locator('.sc-ap-card:not(.sc-ap-add)').first().click();
  await expect(briefChips(p)).not.toHaveCount(0);
  await closeAttach(p);
}

test('the sheet is the touch reorder path, and it stays open between steps', async ({ page }) => {
  test.skip(!isPhone(page), 'the Move pair rides only in the phone sheet');
  await seedMovable(page);
  const before = (await line(page).textContent()) ?? '';
  await tapChip(page);
  await expect(sheet(page)).toBeVisible();

  await sheet(page).getByRole('button', { name: 'Move earlier' }).click();
  // the sheet holds its ground so the next step is one more tap
  await expect(sheet(page)).toBeVisible();
  await expect.poll(async () => ((await line(page).textContent()) ?? '') !== before).toBe(true);

  // and the move can walk back
  const mid = (await line(page).textContent()) ?? '';
  await sheet(page).getByRole('button', { name: 'Move later' }).click();
  await expect.poll(async () => ((await line(page).textContent()) ?? '') !== mid).toBe(true);

  /*
   * The caret goes with the chip.
   *
   * The sheet holds focus while it is open, so the line's caret is a stored
   * POSITION the sheet hands back when it closes — and once the chip has
   * moved past that position the same number means somewhere else entirely.
   * The line used to come back with its caret at the end of the sentence
   * rather than beside the chip the finger had just moved.
   */
  const where = await page.evaluate(() => {
    const root = document.querySelector('.sc-brief-line') as HTMLElement;
    const chip = root.querySelector('.sc-token') as HTMLElement;
    const sel = window.getSelection();
    const box = chip.getBoundingClientRect();
    const r = sel?.rangeCount ? sel.getRangeAt(0) : null;
    return {
      caretX: r && root.contains(r.startContainer) ? r.getBoundingClientRect().left : null,
      chipRight: box.right,
      row: box.top,
      caretY: r && root.contains(r.startContainer) ? r.getBoundingClientRect().top : null,
    };
  });
  expect(where.caretX, 'the line still has a caret in it').not.toBeNull();
  // beside the chip, on the chip's own row
  expect(Math.abs((where.caretX ?? 0) - where.chipRight)).toBeLessThan(12);
  expect(Math.abs((where.caretY ?? 0) - where.row)).toBeLessThan(24);
});

/** One done shot attached as a reference chip, with prose to move through. */
async function seedRefChip(p: Page) {
  await line(p).click();
  await p.keyboard.type('marble hall wide ');
  await p.locator('.sc-canvas-dock .sc-attach-toggle').click();
  await p.locator('.sc-ap-tabs button', { hasText: /shots/i }).click();
  await p.locator('.sc-ap-card:not(.sc-ap-add)').first().click();
  await expect(briefChips(p)).not.toHaveCount(0);
  await closeAttach(p);
}

test('a reference chip gets its own touch sheet: move and remove, no keyboard', async ({ page }) => {
  test.skip(!isPhone(page), 'the move sheet is the phone path');
  await seedRefChip(page);
  const before = (await line(page).textContent()) ?? '';

  await tapChip(page);
  await expect(page.locator('.sc-swapsheet[data-kind="ref"]')).toBeVisible();
  // the tap must not have raised the keyboard by focusing the line
  const active = await page.evaluate(() => (document.activeElement as HTMLElement | null)?.className ?? '');
  expect(active).not.toContain('sc-brief-line');

  await page.locator('.sc-swapsheet').getByRole('button', { name: 'Move earlier' }).click();
  await expect(page.locator('.sc-swapsheet[data-kind="ref"]')).toBeVisible();
  await expect.poll(async () => ((await line(page).textContent()) ?? '') !== before).toBe(true);

  await page.locator('.sc-swapsheet').getByRole('button', { name: 'Remove reference' }).click();
  await expect(briefChips(page)).toHaveCount(0);
});

/**
 * A tap in prose leaves the caret where the platform put it.
 *
 * A touch caret snaps to the end of the tapped word, the way every field on
 * the phone does. The line used to re-place it at the finger's exact x for any
 * tap that missed the row's centre line by a pixel, which is every tap, so the
 * caret landed mid-word wherever the finger happened to be. The correction is
 * for the padding, where the browser's answer really is wrong.
 */
test('a tap in a word keeps the caret in that word, and a tap in the padding lands under the finger', async ({
  page,
  browserName,
}) => {
  await line(page).tap();
  await page.keyboard.type('hero shot of marble ');
  const geo = await line(page).evaluate((el) => {
    const t = el.firstChild as Text;
    const r = document.createRange();
    r.setStart(t, 13);
    r.setEnd(t, 19); // "marble"
    const w = r.getBoundingClientRect();
    const box = el.getBoundingClientRect();
    return { x: (w.left + w.right) / 2, y: (w.top + w.bottom) / 2 + 3, below: box.bottom - 3 };
  });
  const caret = () =>
    line(page).evaluate((el) => {
      const r = getSelection()!.getRangeAt(0);
      return r.startContainer === el.firstChild ? r.startOffset : -1;
    });
  await page.touchscreen.tap(Math.round(geo.x), Math.round(geo.y));
  const inWord = await caret();
  // WebKit snaps a touch caret to the end of the word, as iOS does; re-placing
  // it at the finger's x put it at 16. Chromium places by character, so there
  // the word is the most that can be said.
  if (browserName === 'webkit') expect(inWord).toBe(19);
  expect(inWord).toBeGreaterThanOrEqual(13);
  expect(inWord).toBeLessThanOrEqual(19);

  // the padding under the row resolves to the row, under the finger, not to
  // the start of the sentence
  await page.touchscreen.tap(Math.round(geo.x), Math.round(geo.below));
  const fromPadding = await caret();
  expect(fromPadding).toBeGreaterThanOrEqual(13);
  expect(fromPadding).toBeLessThanOrEqual(19);
});

/**
 * One Backspace takes a chip on a phone too.
 *
 * A phone's keyboard reports Backspace as a composition key, so a rule on
 * keydown never saw it and the press took the chip's space instead, with a
 * second press for the chip. The rule lives on `beforeinput`, which names the
 * deletion itself on every keyboard; this runs it on WebKit and Chromium alike.
 */
test('one Backspace removes a chip', async ({ page }) => {
  await line(page).tap();
  await page.locator('.sc-canvas-dock .sc-attach-toggle').first().tap();
  await page.locator('.sc-ap-tabs button', { hasText: 'Products' }).tap();
  const cards = page.locator('.sc-ap-card:not(.sc-ap-add)');
  await cards.nth(0).tap();
  await cards.nth(1).tap();
  const chips = page.locator('.sc-brief-line .sc-token');
  await expect(chips).toHaveCount(2);
  // the picker is a modal sheet on a phone: it has to go before the line can take focus
  await closeAttach(page);
  // the caret at the end, past the last chip's space, without a pointer
  await line(page).evaluate((el) => {
    el.focus();
    const tail = el.lastChild as Text;
    const r = document.createRange();
    r.setStart(tail, tail.length);
    r.collapse(true);
    const sel = getSelection()!;
    sel.removeAllRanges();
    sel.addRange(r);
  });
  await page.keyboard.press('Backspace');
  await expect(chips).toHaveCount(1);
});

test('a tap on the right edge of a chip opens the sheet, never removes', async ({ page }) => {
  test.skip(!isPhone(page), 'the sheet is the phone path');
  // the x band is inert to touch (hover: none), so the tap reaches the chip
  await seedMovable(page);
  const box = (await briefChips(page).first().boundingBox())!;
  await page.touchscreen.tap(box.x + box.width - 9, box.y + box.height / 2);
  await expect(sheet(page)).toBeVisible();
  await expect(briefChips(page)).toHaveCount(1);
});

/**
 * The "+" picker on a phone: a sheet under the thumb, the same shell the shot
 * settings and the chip picker use. It used to be the desktop panel squeezed
 * to 347 by 293, with four of its seven tabs clipped behind the search field
 * and 28px upload and close buttons.
 */
test.describe('the attach sheet', () => {
  const attachSheet = (p: Page) => p.locator('.sc-attachsheet');
  const openAttach = async (p: Page) => {
    await p.locator('.sc-canvas-dock .sc-attach-toggle').tap();
    await expect(p.locator('.sc-attachsheet, .sc-attachpanel')).toBeVisible();
  };

  test('a phone gets the sheet, a tablet keeps the anchored panel', async ({ page }) => {
    await openAttach(page);
    if (isPhone(page)) {
      await expect(attachSheet(page)).toBeVisible();
      await expect(page.locator('.sc-attachpanel')).toHaveCount(0);
    } else {
      await expect(page.locator('.sc-attachpanel')).toBeVisible();
      await expect(attachSheet(page)).toHaveCount(0);
    }
  });

  test('search, upload, every tab and close are reachable, and nothing spills', async ({ page }) => {
    test.skip(!isPhone(page), 'the sheet only exists below 768px');
    await openAttach(page);
    const box = async (sel: string) => (await page.locator(sel).first().boundingBox())!;
    for (const sel of ['.sc-ap-search', '.sc-ap-upload', '.sc-ap-close']) {
      const b = await box(sel);
      expect(b.height, sel).toBeGreaterThanOrEqual(44);
      expect(b.width, sel).toBeGreaterThanOrEqual(44);
    }
    await expect(attachSheet(page).getByRole('button', { name: 'Upload image' })).toBeVisible();
    // seven tabs in a rail that scrolls sideways rather than clipping their names
    await expect(page.locator('.sc-ap-tabs [role="tab"]')).toHaveCount(7);
    const last = page.locator('.sc-ap-tabs [role="tab"]').last();
    await last.scrollIntoViewIfNeeded();
    await expect(last).toBeInViewport();
    // opening took no keyboard: neither the brief nor the search has focus
    const active = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      return { cls: el?.className ?? '', tag: el?.tagName ?? '' };
    });
    expect(active.cls).not.toContain('sc-brief-line');
    expect(active.tag).not.toBe('INPUT');
    // and the page itself grew no sideways scroll
    const spill = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(spill).toBeLessThanOrEqual(1);
    // the search still takes the keyboard when it is tapped, at a size Safari will not zoom
    const input = attachSheet(page).getByRole('textbox', { name: 'Search' });
    await input.tap();
    await expect(input).toBeFocused();
    expect(await input.evaluate((el) => Number.parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16);
  });

  test('every attach tile is big enough for a thumb', async ({ page }) => {
    await openAttach(page);
    await page.locator('.sc-ap-tabs button', { hasText: 'Presenters' }).tap();
    const cards = page.locator('.sc-ap-card:not(.sc-ap-add)');
    await cards.first().waitFor();
    const n = Math.min(await cards.count(), 8);
    for (let i = 0; i < n; i++) {
      const b = (await cards.nth(i).boundingBox())!;
      expect(b.width).toBeGreaterThanOrEqual(44);
      expect(b.height).toBeGreaterThanOrEqual(44);
    }
  });

  test('a pick stays open for the next one, and a dismissal leaves the shot as it was', async ({ page }) => {
    test.skip(!isPhone(page), 'the sheet only exists below 768px');
    await openAttach(page);
    await page.locator('.sc-ap-tabs button', { hasText: 'Products' }).tap();
    const cards = page.locator('.sc-ap-card:not(.sc-ap-add)');
    await cards.first().tap();
    await expect(briefChips(page)).toHaveCount(1);
    // still open: the second pick is one tap away
    await expect(attachSheet(page)).toBeVisible();
    await expect(page.locator('.sc-ap-card[data-on]')).toHaveCount(1);
    await page.locator('.sc-ap-tabs button', { hasText: 'Presenters' }).tap();
    await cards.first().tap();
    await expect(briefChips(page)).toHaveCount(2);
    // dragged away: the chips stay, and no keyboard came up for the brief
    await dragSheet(page, '.sc-attachsheet .sc-shotsheet-grip', 200);
    await expect(attachSheet(page)).toHaveCount(0);
    await expect(page.locator('.sc-shotsheet-scrim')).toHaveCount(0);
    await expect(briefChips(page)).toHaveCount(2);
    const active = await page.evaluate(() => (document.activeElement as HTMLElement | null)?.className ?? '');
    expect(active).not.toContain('sc-brief-line');
    // and it opens again straight after
    await openAttach(page);
    await expect(attachSheet(page)).toBeVisible();
  });

  test('inside the shot overlay, the sheet closes on its own and leaves the shot open', async ({ page }) => {
    test.skip(!isPhone(page), 'the sheet only exists below 768px');
    await page.locator('.sc-cell').first().tap();
    await page.waitForURL(/\/shots\//);
    const editor = page.locator('.sc-ovl-edit');
    await expect(editor.locator('.sc-brief-line')).toBeVisible();
    const url = page.url();
    await editor.locator('.sc-attach-toggle').tap();
    await expect(attachSheet(page)).toBeVisible();
    await page.locator('.sc-ap-tabs button', { hasText: 'Products' }).tap();
    await page.locator('.sc-ap-card:not(.sc-ap-add)').first().tap();
    await expect(editor.locator('.sc-token')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(attachSheet(page)).toHaveCount(0);
    await expect(page.locator('.sc-ovl')).toBeVisible();
    expect(page.url()).toBe(url);
  });
});
