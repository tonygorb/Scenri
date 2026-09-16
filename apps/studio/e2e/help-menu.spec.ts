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
  await expect(items).toHaveText(['Tour this page', "What's new", 'About Scenri', 'Scenri on GitHub']);
  const github = page.getByRole('menuitem', { name: 'Scenri on GitHub' });
  await expect(github).toHaveAttribute('href', 'https://github.com/tonygorb/scenri');
  await expect(github).toHaveAttribute('target', '_blank');

  await page.getByRole('menuitem', { name: 'Tour this page' }).click();
  await expect(page.locator('.sc-tour .sc-tour-title')).toHaveText('Cast your own');
  await page.locator('.sc-tour-skip').click();
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

test('between 1024 and 1279 the ? waits out the assets drawer rather than landing on Generate', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 800 });
  const s = await slug(page);
  await page.goto(`/${s}/create`);
  await expect(page.locator('.sc-work[data-assets="false"]')).toBeVisible();
  await expect(float(page)).toBeVisible();
  await page.getByRole('button', { name: 'Assets panel' }).click();
  await expect(page.locator('.sc-work[data-assets="true"]')).toBeVisible();
  await expect(page.locator('.sc-help-float')).toBeHidden();
  await page.getByRole('button', { name: 'Close assets' }).click();
  await expect(float(page)).toBeVisible();
});

test('below 1024px the ? moves into the top bar', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 800 });
  const s = await slug(page);
  await page.goto(`/${s}`);
  await expect(page.locator('.sc-topbar [aria-label="Help"]')).toBeVisible();
  await expect(page.locator('.sc-help-float')).toHaveCount(0);
});
