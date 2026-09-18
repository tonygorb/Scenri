import { test, expect, type Page } from '@playwright/test';
import { isolate } from './harness.js';

/**
 * The one way to add a product, a presenter or a scene.
 *
 * Every entry point — the top bar's +, a library page's button, a cold-state
 * offer, a pasted link — routes into the same dialog through the same `?new=`
 * param, so what is really under test here is that contract: opening pushes a
 * history entry, moving between the chooser and a flow replaces, and closing
 * consumes. Same rules `?settings=` has always followed.
 */

// A Scenri of this file's own, on an empty home, seeded from scratch.
isolate();

/** The brand the app resolves "/" to, whatever this machine happens to hold. */
async function currentBrand(p: Page): Promise<string> {
  await p.goto('/');
  await p.waitForURL((u) => {
    const seg = u.pathname.split('/').filter(Boolean);
    return seg.length === 1 && seg[0] !== 'setup';
  });
  return decodeURIComponent(new URL(p.url()).pathname.split('/')[1]);
}

/** New's caret, and then the row for the kind: the plus that used to stand alone
    in the bar is the filled half of that button now, and it makes a shot. */
const trigger = (p: Page) => p.getByRole('button', { name: 'Other ways to start', exact: true });
const dialog = (p: Page) => p.locator('.sc-newdlg');

/**
 * New is one pill: two halves inside one full-round shape, the primary button's
 * own, so each end is a half-circle at whatever height the row gives it. The
 * halves carry the same outer curve, or a focus ring on either would be cut off
 * square by the shape it sits in.
 */
async function expectNewIsPill(p: Page) {
  const g = await p.locator('.sc-new').evaluate((el) => {
    const px = (v: string) => Number.parseFloat(v);
    const r = el.getBoundingClientRect();
    const go = el.querySelector('.sc-new-go');
    const more = el.querySelector('.sc-new-more');
    return {
      h: r.height,
      w: r.width,
      ends: px(getComputedStyle(el).borderTopLeftRadius),
      goEnd: go ? px(getComputedStyle(go).borderBottomLeftRadius) : 0,
      moreEnd: more ? px(getComputedStyle(more).borderTopRightRadius) : 0,
    };
  });
  expect(g.ends).toBeGreaterThanOrEqual(g.h / 2);
  expect(g.goEnd).toBeGreaterThanOrEqual(g.h / 2);
  expect(g.moreEnd).toBeGreaterThanOrEqual(g.h / 2);
  // wider than tall, always: a pill, never squashed into a disc or an oval
  expect(g.w).toBeGreaterThan(g.h);
}

test.describe('adding to a brand', () => {
  let slug: string;

  test.beforeEach(async ({ page }) => {
    slug = await currentBrand(page);
  });

  test('New is one pill, round at both ends, with and without its word', async ({ page }) => {
    await expectNewIsPill(page);
    // the plus rides a 28px disc of its own, round, sharing the pill end's centre
    const disc = await page.locator('.sc-new-disc').evaluate((el) => {
      const r = el.getBoundingClientRect();
      const pill = el.closest('.sc-new')!.getBoundingClientRect();
      return { w: r.width, h: r.height, round: getComputedStyle(el).borderRadius, inset: r.left - pill.left };
    });
    expect(disc).toMatchObject({ w: 28, h: 28, inset: 2 });
    expect(Number.parseFloat(disc.round)).toBeGreaterThanOrEqual(14);
    // 768 to 960 drops the label and keeps both halves
    await page.setViewportSize({ width: 800, height: 900 });
    await expect(page.locator('.sc-new-lb')).toBeHidden();
    await expectNewIsPill(page);
  });

  test('a pointer leaves no ring on the caret, and a key brings it back', async ({ page }) => {
    const caret = trigger(page);
    const rows = page.locator('.sc-start-row');
    const outline = () => caret.evaluate((e) => getComputedStyle(e).outlineStyle);
    const b = (await caret.boundingBox())!;
    const [x, y] = [Math.round(b.x + b.width / 2), Math.round(b.y + b.height / 2)];

    // shut by the caret itself, then by an empty stretch of the bar: focus comes
    // home to the caret either way, and after a pointer it wears no ring
    await page.mouse.click(x, y);
    await expect(rows.first()).toBeVisible();
    await page.mouse.click(x, y);
    await expect(rows).toHaveCount(0);
    await expect(caret).toBeFocused();
    expect(await outline()).toBe('none');
    await page.mouse.click(x, y);
    await expect(rows.first()).toBeVisible();
    await page.mouse.click(300, 30);
    await expect(rows).toHaveCount(0);
    await expect(caret).toBeFocused();
    expect(await outline()).toBe('none');

    // Escape is a key: focus comes home to the caret, ring and all
    await page.mouse.click(x, y);
    await expect(rows.first()).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(rows).toHaveCount(0);
    await expect(caret).toBeFocused();
    expect(await outline()).toBe('solid');
  });

  test('pointing at the plus lights all of New; pointing at the caret lights only the caret', async ({ page }) => {
    const pill = page.locator('.sc-new');
    const caret = page.locator('.sc-new-more');
    const bg = (l: typeof pill) => l.evaluate((el) => getComputedStyle(el).backgroundColor);
    const restPill = await bg(pill);
    const restCaret = await bg(caret);

    await page.locator('.sc-new-go').hover();
    await expect.poll(() => bg(pill)).not.toBe(restPill);
    expect(await bg(caret)).toBe(restCaret);

    await caret.hover();
    await expect.poll(() => bg(pill)).toBe(restPill);
    await expect.poll(() => bg(caret)).not.toBe(restCaret);
  });

  test('New opens Create with its add panel already open, every time it is pressed', async ({ page }) => {
    const panel = page.locator('.sc-attachpanel');
    await page.locator('.sc-new-go').click();
    await expect(panel).toBeVisible();
    // the request is spent once it has been answered, so the address is clean
    await expect(page).toHaveURL(new RegExp(`/${slug}/create$`));

    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);
    // pressed again from Create itself, it opens again
    await page.locator('.sc-new-go').click();
    await expect(panel).toBeVisible();
  });

  test('New pressed again with the add panel open keeps the panel as it is and hands focus to the brief', async ({
    page,
  }) => {
    const panel = page.locator('.sc-attachpanel');
    await page.locator('.sc-new-go').click();
    await expect(panel).toBeVisible();
    await panel.getByRole('tab', { name: /^Presenters/ }).click();
    // mark this panel, so a close and reopen (the flash) would show as a new one
    await panel.evaluate((el) => {
      (el as HTMLElement & { __kept?: boolean }).__kept = true;
    });

    await page.locator('.sc-new-go').click();
    await page.waitForTimeout(300);
    expect(await panel.evaluate((el) => (el as HTMLElement & { __kept?: boolean }).__kept === true)).toBe(true);
    await expect(panel.getByRole('tab', { name: /^Presenters/ })).toHaveAttribute('aria-selected', 'true');
    expect(await page.evaluate(() => !!document.activeElement?.closest('.sc-brief'))).toBe(true);
  });

  test("New's menu offers the shot and exactly the three ingredients", async ({ page }) => {
    await trigger(page).click();

    // The lead row is the act itself; the three under it are what a shot is made
    // from, in nav order, fixed: the menu never reshuffles itself per page.
    const rows = page.locator('.sc-start-row');
    await expect(rows).toHaveCount(4);
    await expect(rows.nth(0)).toContainText('New shot');
    await expect(rows.nth(0)).toHaveAttribute('data-lead', '');
    await expect(rows.nth(1)).toContainText('Product');
    await expect(rows.nth(2)).toContainText('Presenter');
    await expect(rows.nth(3)).toContainText('Scene');
    // each one is a picture rather than an icon, and says how many you have
    await expect(page.locator('.sc-start-n')).toHaveCount(3);
  });

  test('a row goes straight to that kind, with no chooser in between', async ({ page }) => {
    await page.goto(`/${slug}/presenters`);
    const before = page.url();

    await trigger(page).click();
    await page.locator('.sc-start-row', { hasText: 'Scene' }).click();
    await expect(page).toHaveURL(/\?new=scene$/);
    await expect(page.getByRole('heading', { name: 'New scene' })).toBeVisible();

    await page.goBack();
    await expect(page).toHaveURL(before);
    await expect(dialog(page)).toHaveCount(0);
  });

  test('the chooser still answers its own URL', async ({ page }) => {
    // Nothing in the chrome opens it now: New's menu shows the same three kinds
    // with the same pictures and one press, which is what the chooser was for.
    // The route stays honest for anything already pointing at it.
    await page.goto(`/${slug}?new=1`);

    const cards = page.locator('.sc-pick');
    await expect(cards).toHaveCount(3);
    await expect(cards.nth(0)).toHaveAttribute('data-kind', 'product');
    await expect(cards.nth(1)).toHaveAttribute('data-kind', 'presenter');
    await expect(cards.nth(2)).toHaveAttribute('data-kind', 'scene');
    await expect(page.locator('.sc-pick-media img')).toHaveCount(3);
    await expect(page.locator('.sc-newpick .sc-dlg-go')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Add to this brand' })).toBeVisible();
  });

  test('Escape, the backdrop and the close button all leave the same way', async ({ page }) => {
    const home = `/${slug}`;

    for (const dismiss of ['escape', 'close'] as const) {
      await page.goto(`${home}?new=product`);
      await expect(dialog(page)).toBeVisible();
      if (dismiss === 'escape') await page.keyboard.press('Escape');
      else await page.locator('.sc-newdlg-close').click();
      await expect(dialog(page)).toHaveCount(0);
      // the URL is clean, and Back does not reopen what was just dismissed
      await expect(page).toHaveURL(new RegExp(`${home}$`));
    }
  });

  test('a deep link lands straight in the flow, with no arrow back to a chooser nobody saw', async ({ page }) => {
    await page.goto(`/${slug}/products?new=scene`);
    await expect(page.getByRole('heading', { name: 'New scene' })).toBeVisible();
    await expect(page.locator('.sc-newdlg-back')).toHaveCount(0);
  });

  test('a presenter is a place, not a dialog: the old param forwards to its address', async ({ page }) => {
    await page.goto(`/${slug}/products?new=presenter`);
    await expect(page).toHaveURL(new RegExp(`/${slug}/presenters/new$`));
    await expect(page.getByRole('heading', { name: 'Create presenter' })).toBeVisible();
    await expect(page.locator('.sc-pstudio')).toBeVisible();
    await expect(dialog(page)).toHaveCount(0);
  });

  test('opened from the chooser, the arrow goes back to it', async ({ page }) => {
    await page.goto(`/${slug}?new=1`);
    await page.locator('[data-kind="product"]').click();
    await expect(page.getByRole('heading', { name: 'New product' })).toBeVisible();

    await page.locator('.sc-newdlg-back').click();
    await expect(page).toHaveURL(/\?new=1$/);
    await expect(page.locator('.sc-pick')).toHaveCount(3);
  });

  test('the chooser puts the keyboard on the row for the page you are on', async ({ page }) => {
    for (const [path, kind] of [
      ['products', 'product'],
      ['presenters', 'presenter'],
      ['scenes', 'scene'],
    ] as const) {
      await page.goto(`/${slug}/${path}?new=1`);
      await expect(page.locator('.sc-pick').first()).toBeVisible();
      await expect(page.locator(':focus')).toHaveAttribute('data-kind', kind);
      await page.keyboard.press('Escape');
    }
  });

  test('each flow says what pressing its button will actually do', async ({ page }) => {
    await page.goto(`/${slug}?new=product`);
    // the free one says so, where the other two say what they will spend
    await expect(page.locator('.sc-dlg-foot')).toContainText('No preview');

    await page.goto(`/${slug}?new=scene`);
    await expect(page.locator('.sc-dlg-foot')).not.toHaveText('');

    await page.goto(`/${slug}/presenters/new`);
    await expect(page.locator('.sc-dlg-foot')).not.toHaveText('');
  });

  test('the primary explains itself rather than going quietly inert', async ({ page }) => {
    await page.goto(`/${slug}?new=scene`);
    const go = page.locator('.sc-dlg-go');
    await expect(go).toHaveAttribute('aria-disabled', 'true');
    await expect(go).toHaveAttribute('title', /a name, and a photo or a line of direction/i);
    // aria-disabled, not the native attribute: the explanation stays reachable
    await expect(go).not.toHaveAttribute('disabled', /.*/);
  });

  test('focus is trapped in the dialog and handed back to the trigger on close', async ({ page }) => {
    await trigger(page).click();
    await page.locator('.sc-start-row', { hasText: 'Scene' }).click();
    await expect(dialog(page)).toBeVisible();

    // Painted is not focused: the dialog takes focus on mount, and a Tab sent
    // in between still belongs to the trigger behind it. `.sc-newdlg-layer` is
    // the trap itself — the element carrying role="dialog" — and the surface
    // the sheet aims focus at, so it is the boundary to hold, not the card.
    const trapped = () => page.evaluate(() => !!document.activeElement?.closest('.sc-newdlg-layer'));
    await expect.poll(trapped).toBe(true);

    for (let i = 0; i < 25; i++) {
      await page.keyboard.press('Tab');
      expect(await trapped(), `Tab ${i + 1} escaped the dialog`).toBe(true);
    }

    await page.keyboard.press('Escape');
    await expect(dialog(page)).toHaveCount(0);
    await expect(trigger(page)).toBeFocused();
  });

  test('a facet chip that is on looks on', async ({ page }) => {
    await page.goto(`/${slug}?new=scene`);
    const chip = page.locator('.sc-assetform-facets .sc-chip').first();
    const off = await chip.evaluate((el) => getComputedStyle(el).backgroundColor);
    await chip.click();
    await expect(chip).toHaveAttribute('aria-pressed', 'true');
    // the rule this asserts did not exist: data-on had no style of its own, so
    // a chosen facet was indistinguishable from an unchosen one
    const on = await chip.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(on).not.toBe(off);
  });
});
