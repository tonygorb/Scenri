import { test, expect, type Page } from '@playwright/test';

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
