import { test, expect, type Page } from '@playwright/test';
import { isolate } from './harness.js';
import { expectNoTour } from './firstUse.js';

/**
 * The help button on an install that was not new (the harness's default): no
 * welcome and no tour of its own accord, the button in the corner clear of the
 * assets rail, and each item opening what it names.
 */
isolate();

async function slug(p: Page): Promise<string> {
  return ((await (await p.request.get('/api/brands')).json()) as { slug: string }[])[0].slug;
}
const float = (p: Page) => p.locator('.sc-help-float button');

test('no welcome and no tour; the ? sits in the corner and gathers the help', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const s = await slug(page);
  await page.goto(`/${s}/presenters`);
  await expect(float(page)).toBeVisible();
  await expectNoTour(page);
  await expect(page.locator('.sc-welcome')).toHaveCount(0);

  const box = await float(page).boundingBox();
  expect(Math.round((box?.x ?? 0) + (box?.width ?? 0))).toBe(1440 - 16);
  expect(Math.round((box?.y ?? 0) + (box?.height ?? 0))).toBe(900 - 16);

  await float(page).click();
  const items = page.locator('.sc-help-menu [role="menuitem"]');
  await expect(items).toHaveText([
    'Tour this page',
    'Start the tours over',
    "What's new",
    'About Scenri',
    'Scenri on GitHub',
  ]);
  const github = page.getByRole('menuitem', { name: 'Scenri on GitHub' });
  await expect(github).toHaveAttribute('href', 'https://github.com/tonygorb/scenri');
  await expect(github).toHaveAttribute('target', '_blank');

  await page.getByRole('menuitem', { name: 'Tour this page' }).click();
  await expect(page.locator('.sc-tour .sc-tour-title')).toHaveText('Cast the faces of this brand');
  await page.getByRole('button', { name: 'Close tour' }).click();
  await expect(page.locator('.sc-tour')).toHaveCount(0);
  await expect(page.locator('.sc-help-menu')).toHaveCount(0);

  await float(page).click();
  await page.getByRole('menuitem', { name: 'About Scenri' }).click();
  await expect(page).toHaveURL(/settings=about/);
});

test('on Create the ? steps left of the open rail and offers the shortcuts', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const s = await slug(page);
  await page.goto(`/${s}/create`);
  await expect(page.locator('.sc-work[data-assets="true"]')).toBeVisible();
  const box = await float(page).boundingBox();
  expect(Math.round((box?.x ?? 0) + (box?.width ?? 0))).toBe(1440 - 320 - 16);

  await float(page).click();
  await page.getByRole('menuitem', { name: 'Keyboard shortcuts' }).click();
  await expect(page.getByRole('dialog', { name: 'Shortcuts' })).toBeVisible();
});

test('between 1024 and 1279 the ? steps left of the locked assets column, clear of Generate', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 800 });
  const s = await slug(page);
  await page.goto(`/${s}/create`);
  await expect(page.locator('.sc-work[data-assets="true"]')).toBeVisible();
  const box = await float(page).boundingBox();
  expect(Math.round((box?.x ?? 0) + (box?.width ?? 0))).toBe(1100 - 320 - 16);
  const send = await page.locator('.sc-canvas-dock .sc-send').boundingBox();
  const clear =
    (box?.x ?? 0) >= (send?.x ?? 0) + (send?.width ?? 0) || (box?.y ?? 0) >= (send?.y ?? 0) + (send?.height ?? 0);
  expect(clear).toBe(true);
});

test('below 1024px the ? moves into the top bar', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 800 });
  const s = await slug(page);
  await page.goto(`/${s}`);
  await expect(page.locator('.sc-topbar [aria-label="Help"]')).toBeVisible();
  await expect(page.locator('.sc-help-float')).toHaveCount(0);
});

test('Start the tours over reopens the welcome; declining changes nothing, taking it tours every page again', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const s = await slug(page);
  await page.goto(`/${s}/presenters`);
  const welcome = page.locator('.sc-welcome');

  await float(page).click();
  await page.getByRole('menuitem', { name: 'Start the tours over' }).click();
  await expect(welcome).toBeVisible();
  await welcome.locator('.sc-welcome-foot').getByRole('button', { name: 'Not now' }).click();
  await expect(welcome).toHaveCount(0);
  await expect(page.locator('.sc-help-menu')).toHaveCount(0);
  await expectNoTour(page);
  expect(((await (await page.request.get('/api/guide')).json()) as { eligible: boolean }).eligible).toBe(false);

  await float(page).click();
  await page.getByRole('menuitem', { name: 'Start the tours over' }).click();
  await welcome.getByRole('button', { name: 'Take the tour' }).click();
  await expect(page.locator('.sc-tour .sc-tour-title')).toHaveText('Cast the faces of this brand');
  await page.getByRole('button', { name: 'Close tour' }).click();
  await expect(page.locator('.sc-tour')).toHaveCount(0);

  // An upgraded install that asked is taught like a new one: the next page tours on its own.
  await page.goto(`/${s}/scenes`);
  await expect(page.locator('.sc-tour .sc-tour-title')).toHaveText('Build the worlds you shoot in');
});
