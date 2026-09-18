import { test, expect, type Page } from '@playwright/test';
import { isolate } from './harness.js';

/**
 * The focus ring answers the keyboard (DESIGN.md, the focus rule). A menu
 * opened and closed with the mouse hands focus back to its trigger and leaves
 * no ring and no tooltip there; the keyboard gets the ring every time.
 */
isolate();
test.beforeEach(({ page }) => page.setViewportSize({ width: 1440, height: 900 }));

const ring = (p: Page) =>
  p.evaluate(() => {
    const a = document.activeElement as HTMLElement;
    return { cls: a.className, outline: getComputedStyle(a).outlineStyle };
  });

for (const [name, trigger] of [
  ['the help button', '.sc-help-float button'],
  ['the brand menu', '.sc-org-btn'],
] as const) {
  test(`${name}: a mouse close leaves no ring and no tooltip; the keyboard brings the ring back`, async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.sc-greet')).toBeVisible();
    await page.locator(trigger).click();
    await expect(page.getByRole('menu')).toBeVisible();
    await page.mouse.click(700, 120);
    await expect(page.getByRole('menu')).toHaveCount(0);
    await expect(page.locator(trigger)).toBeFocused();
    await page.waitForTimeout(800);
    expect((await ring(page)).outline).toBe('none');
    await expect(page.getByRole('tooltip')).toHaveCount(0);

    await page.keyboard.press('Enter');
    await expect(page.getByRole('menu')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
    await expect(page.locator(trigger)).toBeFocused();
    expect((await ring(page)).outline).toBe('solid');
  });
}

test('Tab after a click shows the ring on the next control, and a field keeps its focus style', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.sc-greet')).toBeVisible();
  await page.locator('.sc-greet').click();
  await page.keyboard.press('Tab');
  expect((await ring(page)).outline).toBe('solid');

  await page.goto('/e2e-fixture/create');
  const line = page.locator('.sc-brief-line').first();
  await line.click();
  await expect(line).toBeFocused();
  await expect(page.locator('.sc-promptcard').first()).toHaveCSS('border-color', /.+/);
  expect(await page.evaluate(() => document.documentElement.dataset.input)).toBe('pointer');
});
