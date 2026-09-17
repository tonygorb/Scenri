import { test, expect, type Page } from '@playwright/test';
import { isolate } from './harness.js';
import { expectNoGuide, steps } from './firstUse.js';

/**
 * The help button on an install that was not new (the harness's default):
 * nothing guides on its own, the button in the corner stays clear of the
 * assets rail, and each item opens what it names. First steps is there for
 * anyone who asks, ticked by what the library already holds.
 */
isolate();

async function slug(p: Page): Promise<string> {
  return ((await (await p.request.get('/api/brands')).json()) as { slug: string }[])[0].slug;
}
const float = (p: Page) => p.locator('.sc-help-float button');

test('nothing guides on its own; the ? sits in the corner and gathers the help', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const s = await slug(page);
  await page.goto(`/${s}/presenters`);
  await expect(float(page)).toBeVisible();
  await expectNoGuide(page);
  await expect(page.locator('.sc-welcome')).toHaveCount(0);

  const box = await float(page).boundingBox();
  expect(Math.round((box?.x ?? 0) + (box?.width ?? 0))).toBe(1440 - 16);
  expect(Math.round((box?.y ?? 0) + (box?.height ?? 0))).toBe(900 - 16);

  await float(page).click();
  const items = page.locator('.sc-help-menu [role="menuitem"]');
  await expect(items).toHaveText(['First steps', "What's new", 'About Scenri', 'Scenri on GitHub']);
  const github = page.getByRole('menuitem', { name: 'Scenri on GitHub' });
  await expect(github).toHaveAttribute('href', 'https://github.com/tonygorb/scenri');
  await expect(github).toHaveAttribute('target', '_blank');

  await page.getByRole('menuitem', { name: 'About Scenri' }).click();
  await expect(page).toHaveURL(/settings=about/);
});

test('First steps, asked for, opens on Home ticked by what the library holds, and starts nothing by itself', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const s = await slug(page);
  await page.goto(`/${s}`);
  await expect(page.locator('.sc-greet')).toBeVisible();
  await expect(steps(page)).toHaveCount(0);

  await page.goto(`/${s}/scenes`);
  await float(page).click();
  await page.getByRole('menuitem', { name: 'First steps' }).click();
  await page.waitForURL((u) => u.pathname === `/${s}`);
  // the seeded brand already holds a finished shot and a product of its own
  await expect(steps(page).locator('.sc-steps-item')).toHaveText([
    'Make a shot, done',
    'Refine a shot',
    'Add your product, done',
    'Cast a presenter',
    'Build a scene',
  ]);

  // Opening a surface is not asking to be guided on an install that was not new.
  await page.goto(`/${s}?new=scene`);
  await expect(page.getByRole('dialog', { name: 'New scene' })).toBeVisible();
  await expectNoGuide(page);
  expect(((await (await page.request.get('/api/guide')).json()) as { active: unknown }).active).toBeNull();
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
