import { expect, type Page, test } from '@playwright/test';

/**
 * The alpha feedback layer, which exists only in an alpha build.
 *
 * Run it against one:
 *   pnpm --filter @scenri/studio build:alpha
 *   pnpm --filter @scenri/studio test:e2e
 *
 * Against a public build there is nothing to test, and that is itself the
 * point — the layer is compiled out rather than switched off — so every case
 * here skips instead of failing. Selects by the `sc-` class names the app
 * ships, like the rest of the suite.
 */

const fbMenu = (p: Page) => p.locator('.sc-fb-menu');
const picker = (p: Page) => p.locator('.sc-fb-picker');
const ring = (p: Page) => p.locator('.sc-fb-ring');
const hint = (p: Page) => p.locator('.sc-fb-hint');
const pop = (p: Page) => p.locator('.sc-fb-pop');

async function openCreate(p: Page) {
  await p.goto('/');
  await p.waitForFunction(() => {
    const seg = location.pathname.split('/').filter(Boolean);
    return seg.length >= 1 && seg[0] !== 'setup';
  });
  const slug = (await p.evaluate(() => location.pathname.split('/').filter(Boolean)[0])) as string;
  await p.goto(`/${slug}/create`);
  await p.waitForSelector('.sc-topbar');
}

/** Right-click somewhere inert and see whether our menu answers. */
async function alphaOrSkip(p: Page) {
  await openCreate(p);
  await p.locator('.sc-topbar').click({ button: 'right' });
  const ours = await fbMenu(p).count();
  if (ours) await p.keyboard.press('Escape');
  test.skip(ours === 0, 'not an alpha build');
}

test.describe('contextual feedback', () => {
  test('picks a target and opens the composer on it', async ({ page }) => {
    await alphaOrSkip(page);

    // no standing button in the chrome: right-click anywhere is the way in
    await page.locator('.sc-topbar').click({ button: 'right' });
    await expect(fbMenu(page)).toBeVisible();
    await page.locator('[role="menuitem"]', { hasText: 'Report this' }).click();
    await expect(pop(page)).toBeVisible();
    await page.keyboard.press('Escape');

    await page.keyboard.press('Shift+F');
    await expect(picker(page)).toBeVisible();
    await expect(hint(page)).toContainText('Tap the thing');

    const tile = page.locator('.sc-cell[data-fb-node]').first();
    test.skip((await tile.count()) === 0, 'seed has no finished shot');

    // hover paints a ring and names the surface, so the tester can see what
    // they are about to report before committing to it
    const box = (await tile.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await expect(ring(page)).toBeVisible();
    await expect(hint(page)).toContainText('Shot tile');

    await page.mouse.down();
    await page.mouse.up();
    await expect(pop(page)).toBeVisible();
    await expect(page.locator('.sc-fb-title')).toContainText('Shot tile');
    // reporting a generated image is inferred, never asked
    await expect(page.locator('.sc-fb-meta')).toContainText('Generated shot');
  });

  test('the picker does not activate what it is pointed at', async ({ page }) => {
    await alphaOrSkip(page);
    const before = page.url();
    await page.keyboard.press('Shift+F');
    const tile = page.locator('.sc-cell[data-fb-node]').first();
    test.skip((await tile.count()) === 0, 'seed has no finished shot');
    const box = (await tile.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.up();
    // clicking a shot normally opens it; in picker mode it must only select
    await expect(pop(page)).toBeVisible();
    expect(page.url()).toBe(before);
  });

  test('shows every field before it sends any of them', async ({ page }) => {
    await alphaOrSkip(page);
    await page.keyboard.press('Shift+F');
    const tile = page.locator('.sc-cell[data-fb-node]').first();
    test.skip((await tile.count()) === 0, 'seed has no finished shot');
    const box = (await tile.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.up();

    // the notice is shown once, before a first report can ever be sent
    await expect(page.locator('.sc-fb-notice')).toBeVisible();

    await pop(page).locator('textarea').fill('the sleeve colour changes between variants');
    await page.locator('.sc-fb-disclose summary').click();
    const shown = await page.locator('.sc-fb-disclose pre').innerText();

    // the disclosure is a security control: what it shows is what leaves
    expect(shown).toContain('the sleeve colour changes between variants');
    expect(shown).toContain('### Where');
    expect(shown).toMatch(/\*\*Shot:\*\* [0-9a-f-]{36}/);
    expect(shown).toContain('### Environment');
    // and the access token is never in it, however the app was reached
    expect(shown).not.toContain('?t=');
  });

  test('Escape leaves the picker without reporting anything', async ({ page }) => {
    await alphaOrSkip(page);
    await page.keyboard.press('Shift+F');
    await expect(picker(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(picker(page)).toHaveCount(0);
    await expect(pop(page)).toHaveCount(0);
  });

  test('a shot tile offers Report this on right-click', async ({ page }) => {
    await alphaOrSkip(page);
    const tile = page.locator('.sc-cell[data-fb-node]').first();
    test.skip((await tile.count()) === 0, 'seed has no finished shot');
    await tile.click({ button: 'right' });
    const item = page.locator('[role="menuitem"]', { hasText: 'Report this' });
    await expect(item).toBeVisible();
    // and it skips the picker: the shot is already known
    await item.click();
    await expect(pop(page)).toBeVisible();
  });

  test('offers one thing and nothing else', async ({ page }) => {
    await alphaOrSkip(page);
    await page.locator('.sc-topbar').click({ button: 'right', position: { x: 300, y: 26 } });
    await expect(fbMenu(page)).toBeVisible();
    // a menu about reporting stays about reporting: no image or file actions
    await expect(fbMenu(page).locator('[role="menuitem"]')).toHaveCount(1);
    await expect(fbMenu(page)).toContainText('Report this');
  });

  test('leaves the native menu alone where the caret lives', async ({ page }) => {
    await alphaOrSkip(page);
    // a textarea can paste and spellcheck, and no page menu can reproduce that
    const line = page.locator('.sc-brief-line, textarea').first();
    test.skip((await line.count()) === 0, 'no composer on this screen');
    await line.click({ button: 'right' });
    await expect(fbMenu(page)).toHaveCount(0);
  });

  test('a surface with its own menu keeps it', async ({ page }) => {
    await alphaOrSkip(page);
    const tile = page.locator('.sc-cell[data-fb-node]').first();
    test.skip((await tile.count()) === 0, 'seed has no finished shot');
    await tile.click({ button: 'right' });
    // the richer Radix menu wins; ours stands down on defaultPrevented
    await expect(page.locator('[role="menuitem"]', { hasText: 'Refine from this' })).toBeVisible();
    await expect(fbMenu(page)).toHaveCount(0);
  });
});
