import { test, expect, type Page } from '@playwright/test';

/**
 * The composer at hand width.
 *
 * The row used to hold six controls at any width, so on a phone the engine chip
 * and the aspect pill drew on top of each other. These cases are the floor: the
 * row never overflows its card, a finger always has something to hit, and the
 * three shot settings are reachable from wherever they ended up.
 *
 * Real devices rather than a resized desktop, because the touch rules hang off
 * `pointer: coarse` and a narrow desktop window does not report it.
 */

const line = (p: Page) => p.locator('.sc-brief-line').first();
const row = (p: Page) => p.locator('.sc-prompt-row').first();
const chip = (p: Page) => p.locator('.sc-shotset');
const pills = (p: Page) => p.locator('.sc-prompt-right > .sc-var:not(.sc-shotset)');

const isPhone = (p: Page) => (p.viewportSize()?.width ?? 0) < 768;

/** What the row spills, if anything. 1px of rounding is not a spill. */
async function overflow(p: Page): Promise<number> {
  return p.evaluate(() => {
    const el = document.querySelector('.sc-prompt-row') as HTMLElement;
    return el.scrollWidth - el.clientWidth;
  });
}

test.beforeEach(async ({ page }) => {
  // the brief lives on the hub: Home is the way in and carries no tools
  await page.goto('/');
  await page.waitForURL(/\/b\/[^/]+$/);
  await page.goto(`${new URL(page.url()).pathname}/create`);
  await line(page).waitFor();
});

test('the control row never spills its card', async ({ page }) => {
  const sizes = isPhone(page)
    ? [
        { width: 320, height: 720 },
        { width: 390, height: 844 },
      ]
    : [
        { width: 768, height: 1024 },
        { width: 1024, height: 768 },
      ];

  for (const size of sizes) {
    await page.setViewportSize(size);
    await expect.poll(() => overflow(page), { message: `row overflows at ${size.width}px` }).toBeLessThanOrEqual(1);
  }
});

test('every control in the row is big enough for a finger', async ({ page }) => {
  const controls = row(page).locator('button:visible');
  const count = await controls.count();
  expect(count).toBeGreaterThan(2);
  for (let i = 0; i < count; i++) {
    const box = await controls.nth(i).boundingBox();
    if (!box) continue;
    // 40px is the graphic; coarse pointers get to 44 through an invisible box
    expect(box.height, `control ${i} is ${box.height}px tall`).toBeGreaterThanOrEqual(30);
    const reach = await controls.nth(i).evaluate((el) => {
      const after = getComputedStyle(el, '::after');
      return Math.max(el.getBoundingClientRect().height, Number.parseFloat(after.height) || 0);
    });
    expect(reach, `control ${i} reaches only ${reach}px`).toBeGreaterThanOrEqual(40);
  }
});

test('a phone trades the three pills for a sheet', async ({ page }) => {
  test.skip(!isPhone(page), 'the full row has the room above 768px');

  await expect(chip(page)).toBeVisible();
  await expect(pills(page).first()).toBeHidden();

  await chip(page).click();
  const sheet = page.locator('.sc-shotsheet');
  await expect(sheet).toBeVisible();

  // two settings in one visit, because nothing here closes the sheet
  await sheet.locator('.sc-seg-o', { hasText: /^High$/ }).click();
  await sheet.locator('.sc-seg-o', { hasText: /^9:16$/ }).click();
  await expect(sheet).toBeVisible();
  await expect(sheet.locator('.sc-seg-o[data-on]', { hasText: /^High$/ })).toHaveCount(1);

  // the sheet and the pills are one state, not two copies of it
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  await expect(page.locator('.sc-prompt-right .sc-var', { hasText: 'High' })).toHaveCount(1);
  await expect(page.locator('.sc-prompt-right .sc-var', { hasText: '9:16' })).toHaveCount(1);
});

test('the sheet is dragged away, and springs back from a nudge', async ({ page }) => {
  test.skip(!isPhone(page), 'the sheet only exists below 768px');

  const sheet = page.locator('.sc-shotsheet');
  const pull = async (dy: number) => {
    const box = (await page.locator('.sc-shotsheet-grip').boundingBox())!;
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y + dy, { steps: 10 });
    await page.mouse.up();
  };

  // a nudge is not an intention: the sheet stays, and stays put
  await chip(page).click();
  await expect(sheet).toBeVisible();
  await pull(24);
  await expect(sheet).toBeVisible();
  await expect.poll(() => sheet.evaluate((el) => el.style.transform)).toBe('');

  // a real pull sends it away
  await pull(200);
  await expect(sheet).toBeHidden();
});

test('a tablet keeps the full row', async ({ page }) => {
  test.skip(isPhone(page), 'a phone has no room for it');

  await expect(chip(page)).toBeHidden();
  await expect(pills(page)).not.toHaveCount(0);
  for (const pill of await pills(page).all()) await expect(pill).toBeVisible();
});

test('focusing the brief cannot zoom the page', async ({ page }) => {
  // iOS zooms whenever it focuses a control computing under 16px
  const size = await line(page).evaluate((el) => Number.parseFloat(getComputedStyle(el).fontSize));
  expect(size).toBeGreaterThanOrEqual(16);
});
