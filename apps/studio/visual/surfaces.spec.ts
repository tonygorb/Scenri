import { test } from '@playwright/test';
import { isolate } from '../e2e/harness.js';
import { discover, prep, shot, type Discovered } from './shared.js';

/**
 * The desktop surface matrix, warm fixture (owned scene seeded).
 * Golden baselines are captured from the pre-restructure CSS and never
 * regenerated mid-migration.
 */

isolate({ scene: true });

let d: Discovered;
test.beforeAll(async ({ request }) => {
  d = await discover(request);
});

// ---- routes, dark (the product default) ------------------------------------

test('home', async ({ page }) => {
  await prep(page);
  await page.goto(`/${d.slug}`);
  await shot(page, 'home');
});

test('create', async ({ page }) => {
  await prep(page);
  await page.goto(`/${d.slug}/create`);
  await shot(page, 'create');
});

test('create composing', async ({ page }) => {
  await prep(page);
  await page.goto(`/${d.slug}/create?compose=1`);
  await shot(page, 'create-composer');
});

test('shot detail overlay', async ({ page }) => {
  test.skip(!d.shotId, 'no finished shot on the fixture');
  await prep(page);
  await page.goto(`/${d.slug}/create/shots/${d.shotId}`);
  await shot(page, 'detail');
});

test('products library', async ({ page }) => {
  await prep(page);
  await page.goto(`/${d.slug}/products`);
  await shot(page, 'products');
});

test('one product', async ({ page }) => {
  test.skip(!d.productId, 'no product on the fixture');
  await prep(page);
  await page.goto(`/${d.slug}/products/${d.productId}`);
  await shot(page, 'product');
});

test('presenters library', async ({ page }) => {
  await prep(page);
  await page.goto(`/${d.slug}/presenters`);
  await shot(page, 'presenters');
});

test('one presenter', async ({ page }) => {
  test.skip(!d.presenterId, 'no presenter on the fixture');
  await prep(page);
  await page.goto(`/${d.slug}/presenters/${d.presenterId}`);
  await shot(page, 'presenter');
});

test('scenes library', async ({ page }) => {
  await prep(page);
  await page.goto(`/${d.slug}/scenes`);
  await shot(page, 'scenes');
});

test('one scene', async ({ page }) => {
  test.skip(!d.sceneId, 'no scene on the fixture');
  await prep(page);
  await page.goto(`/${d.slug}/scenes/${d.sceneId}`);
  await shot(page, 'scene');
});

test('settings: brand kit', async ({ page }) => {
  await prep(page);
  await page.goto(`/${d.slug}?settings=brand`);
  await shot(page, 'settings-brand');
});

test('settings: engines', async ({ page }) => {
  await prep(page);
  await page.goto(`/${d.slug}?settings=engines`);
  await shot(page, 'settings-engines');
});

test("what's new", async ({ page }) => {
  await prep(page);
  await page.goto(`/${d.slug}?whatsnew=1`);
  await shot(page, 'whatsnew');
});

test('create an asset dialog', async ({ page }) => {
  await prep(page);
  await page.goto(`/${d.slug}/products?new=1`);
  await shot(page, 'create-asset');
});

test('first-run setup', async ({ page }) => {
  await prep(page);
  await page.goto('/setup');
  await shot(page, 'setup');
});

// ---- opened interaction states ---------------------------------------------

test('composer insert menu', async ({ page }) => {
  await prep(page);
  await page.goto(`/${d.slug}/create?compose=1`);
  const line = page.locator('.sc-brief-line');
  await line.click();
  await page.keyboard.type('/');
  await page.locator('.sc-cmd').waitFor();
  await shot(page, 'composer-insert-menu');
});

test('composer attach panel', async ({ page }) => {
  await prep(page);
  await page.goto(`/${d.slug}/create?compose=1`);
  await page.locator('.sc-attach-toggle').first().click();
  await page.locator('.sc-attachpanel').waitFor();
  await shot(page, 'composer-attach');
});

test('composer shot settings', async ({ page }) => {
  await prep(page);
  await page.goto(`/${d.slug}/create?compose=1`);
  await page.locator('.sc-prompt-pills .sc-var').first().click();
  await page.locator('.sc-setpop').waitFor();
  await shot(page, 'composer-shot-settings');
});

test('notifications popover', async ({ page }) => {
  await prep(page);
  await page.goto(`/${d.slug}/create`);
  await page.locator('.sc-topbar .sc-notif-btn').click();
  await page.locator('.sc-notif-pop').waitFor();
  await shot(page, 'notifications');
});

test('brand menu', async ({ page }) => {
  await prep(page);
  await page.goto(`/${d.slug}`);
  await page.locator('.sc-org-btn').click();
  await page.locator('.sc-menu-item').first().waitFor();
  await shot(page, 'brand-menu');
});

test('focus ring on keyboard travel', async ({ page }) => {
  await prep(page);
  await page.goto(`/${d.slug}/create?compose=1`);
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await shot(page, 'focus-ring');
});

test('card hover', async ({ page }) => {
  await prep(page);
  await page.goto(`/${d.slug}`);
  await page.locator('[data-wall] .sc-lookcard').first().hover();
  await shot(page, 'card-hover');
});

/**
 * A control while it is held.
 *
 * The press had no pixel coverage at all until the geometry pass of 0.4.3, which
 * is part of why a `transform: translateY(1px)` sat in the shared button rule
 * for as long as it did. The mouse goes down and is never released, so the shot
 * captures `:active`; the page is thrown away straight after.
 */
test('button pressed', async ({ page }) => {
  await prep(page);
  await page.goto(`/${d.slug}?settings=brand`);
  const btn = page.locator('.sc-btn:visible').first();
  await btn.scrollIntoViewIfNeeded();
  const box = await btn.boundingBox();
  if (!box) throw new Error('no button to press on the brand pane');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await shot(page, 'button-pressed');
  // Release somewhere else. Letting go on the control would be a click, and
  // the first button on this pane is "Add colour": the palette would gain a
  // swatch and every later shot in this file would be taken against it.
  await page.mouse.move(2, 2);
  await page.mouse.up();
});

// ---- light theme, representative subset ------------------------------------

test('light: home', async ({ page }) => {
  await prep(page, 'light');
  await page.goto(`/${d.slug}`);
  await shot(page, 'light-home');
});

test('light: create composing', async ({ page }) => {
  await prep(page, 'light');
  await page.goto(`/${d.slug}/create?compose=1`);
  await shot(page, 'light-create-composer');
});

test('light: products', async ({ page }) => {
  await prep(page, 'light');
  await page.goto(`/${d.slug}/products`);
  await shot(page, 'light-products');
});

test('light: one product', async ({ page }) => {
  test.skip(!d.productId, 'no product on the fixture');
  await prep(page, 'light');
  await page.goto(`/${d.slug}/products/${d.productId}`);
  await shot(page, 'light-product');
});

test('light: settings brand kit', async ({ page }) => {
  await prep(page, 'light');
  await page.goto(`/${d.slug}?settings=brand`);
  await shot(page, 'light-settings-brand');
});

test("light: what's new", async ({ page }) => {
  await prep(page, 'light');
  await page.goto(`/${d.slug}?whatsnew=1`);
  await shot(page, 'light-whatsnew');
});
