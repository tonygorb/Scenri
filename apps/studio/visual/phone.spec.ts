import { test } from '@playwright/test';
import { isolate } from '../e2e/harness.js';
import { discover, prep, shot, type Discovered } from './shared.js';

/**
 * The phone shell (390×844, coarse pointer): tab bar instead of the rail,
 * bottom-docked sheets instead of centred dialogs.
 */

isolate({ scene: true });

let d: Discovered;
test.beforeAll(async ({ request }) => {
  d = await discover(request);
});

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

test('scenes library', async ({ page }) => {
  await prep(page);
  await page.goto(`/${d.slug}/scenes`);
  await shot(page, 'scenes');
});

test("what's new sheet", async ({ page }) => {
  await prep(page);
  await page.goto(`/${d.slug}?whatsnew=1`);
  await shot(page, 'whatsnew');
});

test('create-asset sheet', async ({ page }) => {
  await prep(page);
  await page.goto(`/${d.slug}/products?new=1`);
  await shot(page, 'create-asset');
});

test('settings sheet', async ({ page }) => {
  await prep(page);
  await page.goto(`/${d.slug}?settings=brand`);
  await shot(page, 'settings-brand');
});
