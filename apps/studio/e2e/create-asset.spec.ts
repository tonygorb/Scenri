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

// A scenri of this file's own, on an empty home, seeded from scratch.
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

const trigger = (p: Page) => p.getByRole('button', { name: 'Add to this brand', exact: true });
const dialog = (p: Page) => p.locator('.sc-newdlg');

test.describe('adding to a brand', () => {
  let slug: string;

  test.beforeEach(async ({ page }) => {
    slug = await currentBrand(page);
  });

  test('the top bar trigger opens a chooser of exactly the three ingredients', async ({ page }) => {
    await trigger(page).click();
    await expect(page).toHaveURL(/\?new=1$/);

    const cards = page.locator('.sc-pick');
    await expect(cards).toHaveCount(3);
    // nav order, fixed — the launcher never reshuffles itself per page
    await expect(cards.nth(0)).toHaveAttribute('data-kind', 'product');
    await expect(cards.nth(1)).toHaveAttribute('data-kind', 'presenter');
    await expect(cards.nth(2)).toHaveAttribute('data-kind', 'scene');
    // every card is a picture, not an icon: this is a visual choice
    await expect(page.locator('.sc-pick-media img')).toHaveCount(3);
    // and one press does it — there is no confirm step to get past
    await expect(page.locator('.sc-newpick .sc-dlg-go')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Add to this brand' })).toBeVisible();
  });

  test('picking a row replaces, so one Back press leaves rather than two', async ({ page }) => {
    await page.goto(`/${slug}/presenters`);
    const before = page.url();

    await trigger(page).click();
    await page.locator('[data-kind="scene"]').click();
    await expect(page).toHaveURL(/\?new=scene$/);
    await expect(page.getByRole('heading', { name: 'New scene' })).toBeVisible();

    await page.goBack();
    // not back to the chooser: the row switch was a move inside one overlay
    await expect(page).toHaveURL(before);
    await expect(dialog(page)).toHaveCount(0);
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
    await page.goto(`/${slug}/products?new=presenter`);
    await expect(page.getByRole('heading', { name: 'New presenter' })).toBeVisible();
    await expect(page.locator('.sc-newdlg-back')).toHaveCount(0);
  });

  test('opened from the chooser, the arrow goes back to it', async ({ page }) => {
    await trigger(page).click();
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
      await page.goto(`/${slug}/${path}`);
      await trigger(page).click();
      await expect(page.locator('.sc-pick').first()).toBeVisible();
      await expect(page.locator(':focus')).toHaveAttribute('data-kind', kind);
      await page.keyboard.press('Escape');
    }
  });

  test('each flow says what pressing its button will actually do', async ({ page }) => {
    await page.goto(`/${slug}?new=product`);
    // the free one says so, where the other two say what they will spend
    await expect(page.locator('.sc-dlg-foot')).toContainText('No preview');

    await page.goto(`/${slug}?new=presenter`);
    await expect(page.locator('.sc-dlg-foot')).not.toHaveText('');

    await page.goto(`/${slug}?new=scene`);
    await expect(page.locator('.sc-dlg-foot')).not.toHaveText('');
  });

  test('the primary explains itself rather than going quietly inert', async ({ page }) => {
    await page.goto(`/${slug}?new=presenter`);
    const go = page.locator('.sc-dlg-go');
    await expect(go).toHaveAttribute('aria-disabled', 'true');
    await expect(go).toHaveAttribute('title', /name and at least one photo/i);
    // aria-disabled, not the native attribute: the explanation stays reachable
    await expect(go).not.toHaveAttribute('disabled', /.*/);
  });

  test('focus is trapped in the dialog and handed back to the trigger on close', async ({ page }) => {
    await trigger(page).click();
    await page.locator('[data-kind="scene"]').click();
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
