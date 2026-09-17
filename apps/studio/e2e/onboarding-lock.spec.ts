import { test, expect } from '@playwright/test';
import { isolate } from './harness.js';
import {
  expectLetGo,
  noWelcomeWait,
  pointsAt,
  setUpBrand,
  tourCard,
  tourNext,
  tourTitle,
  tourX,
  welcome,
} from './firstUse.js';

/**
 * What a tour holds while it is on screen: the page behind takes no press, no
 * Tab and no shortcut; the stop's window works; nothing is left held after.
 */
isolate({ brand: false, env: { SCENRI_NO_GUIDE: '0' } });
test.describe.configure({ mode: 'serial' });
test.beforeEach(({ page }) => noWelcomeWait(page));

const SLUG = 'held-page';

test('the page behind takes no press and no Tab; the window does', async ({ page }) => {
  await setUpBrand(page, 'Held Page');
  await welcome(page).getByRole('button', { name: 'Take the tour' }).click();
  await expect(tourTitle(page)).toHaveText('Every shot starts as a brief');
  await pointsAt(page, '.sc-create-grid');

  const before = await page.locator('[inert]:not([data-sc-tour-inert])').count();
  const products = await page.evaluate(() => {
    const link = document.querySelector('.sc-topbar [data-tour="nav.products"]') as HTMLElement;
    const r = link.getBoundingClientRect();
    return document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2))?.className;
  });
  expect(products).toBe('sc-tour-catch-part');
  await expect(page.locator('.sc-topbar')).toHaveAttribute('inert', '');

  // Tab walks the card and the window, and past the card's last control out to
  // the browser's own chrome (the page reads that as <body>), never onto the page behind.
  const visited = new Set<string>();
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Tab');
    const where = await page.evaluate(() => {
      const a = document.activeElement;
      if (!a || a === document.body) return 'outside';
      if (a.closest('.sc-tour')) return 'card';
      if (a.closest('.sc-create-grid')) return 'window';
      return `page: ${a.tagName}.${a.className}`;
    });
    visited.add(where);
  }
  expect([...visited].sort()).toEqual(['card', 'outside', 'window']);

  await tourX(page).click();
  await expect(tourCard(page)).toHaveCount(0);
  await expectLetGo(page);
  expect(await page.locator('[inert]').count()).toBe(before);
});

test("the page's own shortcuts do not fire while the tour holds the key, and Escape reaches nothing else", async ({
  page,
}) => {
  await page.goto(`/${SLUG}/create`);
  await expect(tourTitle(page)).toHaveText('Bring in what stays the same');
  await expect(tourCard(page)).toBeFocused();
  const rail = await page.locator('.sc-work').getAttribute('data-assets');
  await page.keyboard.press('.');
  await page.keyboard.press('?');
  await page.waitForTimeout(300);
  await expect(page.locator('.sc-work')).toHaveAttribute('data-assets', rail ?? '');
  await expect(page.getByRole('dialog', { name: 'Shortcuts' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(tourCard(page)).toHaveCount(0);
  await expectLetGo(page);
});

test('a stop whose control moves at a breakpoint follows it to the one on screen', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/${SLUG}`);
  await page.locator('.sc-help-float button').click();
  await page.getByRole('menuitem', { name: 'Tour this page' }).click();
  await expect(tourTitle(page)).toHaveText('Every shot starts as a brief');
  await tourNext(page).click();
  await tourNext(page).click();
  await expect(tourTitle(page)).toHaveText('Where your shots are kept');
  await pointsAt(page, '[data-tour="nav.create"]');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.sc-tabbar [data-tour="nav.create"]')).toBeVisible();
  await expect(async () => pointsAt(page, '.sc-tabbar [data-tour="nav.create"]')).toPass({ timeout: 5000 });
  await tourX(page).click();
  await expectLetGo(page);
});

test('with reduced motion nothing fades', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/${SLUG}/scenes`);
  await page.locator('.sc-help-float button').click();
  await page.getByRole('menuitem', { name: 'Tour this page' }).click();
  await expect(tourTitle(page)).toHaveText('Build the worlds you shoot in');
  const motion = await page.evaluate(() => ({
    veil: getComputedStyle(document.querySelector('.sc-tour-veil') as Element).animationName,
    card: getComputedStyle(document.querySelector('.sc-tour') as Element).transitionDuration,
  }));
  expect(motion).toEqual({ veil: 'none', card: '0s' });
  await tourX(page).click();
});
