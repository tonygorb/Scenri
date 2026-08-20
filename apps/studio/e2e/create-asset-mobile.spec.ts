import { test, expect, type Page } from '@playwright/test';
import { isolate } from './harness.js';

/**
 * Adding to a brand on a hand's width, and on a tablet.
 *
 * Two things are really under test. The first is the top bar: the page-primary
 * hoist that used to portal "Create presenter" up there is gone, because that
 * pill plus the new + plus the bell plus the brand avatar did not fit 360px.
 * The overflow assertion below is the guard on that, and it is the single most
 * valuable case in this file.
 *
 * The second is the sheet. Above 768px this is a centred dialog; below it, the
 * same markup docks to the bottom edge. The tablet leg exists to prove the
 * dialog did not move.
 *
 * Runs on the mobile (Pixel 5) and tablet (iPad Mini landscape) projects.
 */

// A Scenri of this file's own, on an empty home, seeded from scratch.
isolate();

const isPhone = (p: Page) => (p.viewportSize()?.width ?? 0) < 768;
const dialog = (p: Page) => p.locator('.sc-newdlg');

async function brandSlug(p: Page): Promise<string> {
  await p.goto('/');
  await p.waitForURL((u) => {
    const seg = u.pathname.split('/').filter(Boolean);
    return seg.length === 1 && seg[0] !== 'setup';
  });
  return decodeURIComponent(new URL(p.url()).pathname.split('/')[1]);
}

test('the top bar fits, on every library page', async ({ page }) => {
  const slug = await brandSlug(page);

  for (const path of ['products', 'presenters', 'scenes']) {
    await page.goto(`/${slug}/${path}`);
    await page.locator('.sc-topbar').waitFor();
    const fit = await page.locator('.sc-topbar').evaluate((el) => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
    }));
    // one pixel of slack for sub-pixel layout, and not one more
    expect(fit.scrollWidth, `${path} overflows the top bar`).toBeLessThanOrEqual(fit.clientWidth + 1);
  }
});

test('the hoisted page action is gone, and the + took its job', async ({ page }) => {
  const slug = await brandSlug(page);
  await page.goto(`/${slug}/presenters`);

  await expect(page.locator('#sc-page-action')).toHaveCount(0);
  const trigger = page.getByRole('button', { name: 'Add to this brand', exact: true });
  await expect(trigger).toBeVisible();

  if (isPhone(page)) {
    // under 1280px the filterbar keeps no button of its own — one control, not two
    await expect(page.locator('.sc-filterbar-cta')).toBeHidden();
  }
});

test('the dialog is a sheet on a phone and a centred dialog on a tablet', async ({ page }) => {
  const slug = await brandSlug(page);
  await page.goto(`/${slug}/scenes?new=scene`);
  await expect(dialog(page)).toBeVisible();
  // the sheet rises from below the fold; a box read on the first paint is
  // still travelling and is not the dock the assertions name
  await settledBox(page, '.sc-newdlg');

  const geometry = await dialog(page).evaluate((el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      bottom: r.bottom,
      height: r.height,
      width: r.width,
      viewportH: window.innerHeight,
      viewportW: window.innerWidth,
      topLeftRadius: Number.parseFloat(cs.borderTopLeftRadius),
      bottomLeftRadius: Number.parseFloat(cs.borderBottomLeftRadius),
    };
  });

  if (isPhone(page)) {
    // docked: bottom edge on the viewport's bottom edge, full width, and the
    // bottom corners squared off because there is nothing under them
    expect(Math.abs(geometry.bottom - geometry.viewportH)).toBeLessThanOrEqual(1);
    expect(Math.abs(geometry.width - geometry.viewportW)).toBeLessThanOrEqual(1);
    expect(geometry.height).toBeLessThanOrEqual(geometry.viewportH * 0.93);
    expect(geometry.topLeftRadius).toBeGreaterThan(8);
    expect(geometry.bottomLeftRadius).toBeLessThanOrEqual(1);
  } else {
    // unchanged above the breakpoint: floating, narrower than the viewport,
    // and rounded on all four corners
    expect(geometry.viewportH - geometry.bottom).toBeGreaterThan(8);
    expect(geometry.width).toBeLessThan(geometry.viewportW - 16);
    expect(geometry.bottomLeftRadius).toBeGreaterThan(1);
  }
});

test('the primary stays reachable with the keyboard up', async ({ page }) => {
  test.skip(!isPhone(page), 'no software keyboard to clear above the breakpoint');
  const slug = await brandSlug(page);
  await page.goto(`/${slug}/scenes?new=scene`);

  await dialog(page).locator('input[type="text"], .rt-TextFieldInput').first().tap();
  const go = page.locator('.sc-dlg-go');
  await expect(go).toBeVisible();
  const box = await go.boundingBox();
  const viewportH = page.viewportSize()!.height;
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewportH);
});

test('the chooser is usable by touch', async ({ page }) => {
  const slug = await brandSlug(page);
  await page.goto(`/${slug}`);
  await page.getByRole('button', { name: 'Add to this brand', exact: true }).tap();
  await expect(page.locator('.sc-pick')).toHaveCount(3);

  // every card clears the 44px touch floor the rest of the app holds to
  const heights = await page.locator('.sc-pick').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
  for (const h of heights) expect(h).toBeGreaterThanOrEqual(44);

  const lefts = await page
    .locator('.sc-pick')
    .evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().left)));
  if (isPhone(page)) {
    // one column on a phone: three 4:5 cards side by side are three stamps
    expect(new Set(lefts).size, 'the cards should stack, not sit in a row').toBe(1);
  } else {
    // a tablet keeps the desktop grid — three pictures, side by side
    expect(new Set(lefts).size, 'the cards should stay in a row').toBe(3);
  }

  await page.locator('[data-kind="scene"]').tap();
  await expect(page.getByRole('heading', { name: 'New scene' })).toBeVisible();
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
 * px/ms — and playwright dispatches the whole move in one go, so a gentle
 * 24px pull arrives at ~5px/ms and reads as a flick. The hold before
 * releasing is what makes the gesture mean what it says.
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
  const slug = await brandSlug(page);
  await page.goto(`/${slug}/scenes?new=scene`);

  const sheet = dialog(page);
  const pull = (dy: number) => dragSheet(page, '.sc-newdlg > .sc-shotsheet-grip', dy);

  await expect(sheet).toBeVisible();
  await pull(24);
  await expect(sheet).toBeVisible();
  await expect.poll(() => sheet.evaluate((el) => el.style.transform)).toBe('');

  await pull(200);
  await expect(sheet).toHaveCount(0);
});
