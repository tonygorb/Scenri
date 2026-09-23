import { expect, type Locator, type Page, test } from '@playwright/test';
import { arrived, isolate } from './harness.js';

/**
 * Studio work that fails is never a dead end, in front of you or out of sight.
 *
 * Every change to a drawn picture is refused here (SCENRI_DEMO_FAIL_EDIT), the
 * way a signed-out or rate-limited engine refuses one: the new words still
 * land, the picture never does. On the page the reason is said and the ways on
 * stay; away from it, one card says it did not finish, stays until dismissed,
 * and leads back.
 */
isolate({
  env: {
    SCENRI_DEMO_BUILDS: '1',
    SCENRI_DEMO_REFS: '5',
    SCENRI_DEMO_DELAY_MS: '3000',
    SCENRI_DEMO_ANALYSIS: 'usable',
    SCENRI_DEMO_READ_MS: '200',
    SCENRI_DEMO_FAIL_EDIT: '1',
  },
});

async function brandSlug(p: Page): Promise<string> {
  await p.goto('/');
  await p.waitForURL((u) => {
    const seg = u.pathname.split('/').filter(Boolean);
    return seg.length === 1 && seg[0] !== 'setup';
  });
  return decodeURIComponent(new URL(p.url()).pathname.split('/')[1]);
}

const studio = (p: Page) => p.locator('.sc-pstudio');
const line = (p: Page) => p.locator('.sc-convo-card textarea');
const openQ = (p: Page) => studio(p).locator('[data-turn^="q:"]:not([data-picked])').last();

async function say(p: Page, text: string) {
  await line(p).fill(text);
  await line(p).press('Enter');
}

async function tap(q: Locator, name: string) {
  await q.getByRole('button', { name, exact: true }).click();
}

/** A scene drawn once, standing on the stage, ready to be changed. */
async function drawn(p: Page, slug: string, name: string) {
  await p.goto(`/${slug}/scenes/new`);
  await arrived(p, '.sc-pstudio[data-kind="scene"]');
  await say(p, 'A white cyclorama under hard flash, seen straight on, on a low plinth, mist lying low');
  await expect(openQ(p)).toHaveAttribute('data-turn', /^q:agree-/, { timeout: 15_000 });
  await tap(openQ(p), 'Draw the scene');
  await say(p, name);
  await expect(openQ(p)).toHaveAttribute('data-turn', /^q:decide-/, { timeout: 20_000 });
  return new URL(p.url()).pathname;
}

test('a change that fails on the page says why, keeps the picture it had, and every way on stays', async ({ page }) => {
  const slug = await brandSlug(page);
  await drawn(page, slug, 'Refused Cyc');
  await say(page, 'make the floor darker');
  await expect(studio(page)).toContainText('refused', { timeout: 20_000 });
  // the words it read stand, with nothing drawn for them yet, and drawing is one press
  await expect(openQ(page)).toHaveAttribute('data-turn', /^q:(agree|decide)-/);
  await expect(line(page)).toBeEnabled();
  // the picture from before is still there to put back
  await expect(studio(page).locator('[data-turn^="scenri:pic-"]')).toHaveCount(1);
});

test('a change that fails out of sight leaves one card that stays and leads back', async ({ page }) => {
  test.setTimeout(75_000);
  const slug = await brandSlug(page);
  const at = await drawn(page, slug, 'Far Cyc');
  await say(page, 'make the floor darker');
  await studio(page).getByRole('button', { name: 'Close', exact: true }).click();
  await expect(studio(page)).toHaveCount(0);

  const card = page.locator('.sc-toast', { hasText: 'Far Cyc did not finish' });
  await expect(card).toBeVisible({ timeout: 20_000 });
  // an error stays until dismissed: still there well past the longest timed card
  await page.waitForTimeout(15_000);
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: 'Open' }).click();
  await page.waitForURL((u) => u.pathname === at);
  await expect(openQ(page)).toHaveAttribute('data-turn', /^q:(agree|decide)-/);
  await expect(line(page)).toBeEnabled();
});

test('a change that failed closes without asking, waits on the wall as not finished, and opens with every way on', async ({
  page,
}) => {
  test.setTimeout(60_000);
  const slug = await brandSlug(page);
  const at = await drawn(page, slug, 'Stuck Cyc');
  await say(page, 'make the floor darker');
  await expect(studio(page)).toContainText('refused', { timeout: 20_000 });
  // nothing is lost by closing: no discard-or-stay question
  await studio(page).getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await page.waitForURL(new RegExp(`/${slug}/scenes$`));
  const card = page.locator('.sc-lookcard[data-build]', { hasText: 'Stuck Cyc' });
  await expect(card).toContainText('Did not finish');
  await card.getByRole('link').click();
  await page.waitForURL((u) => u.pathname === at);
  await expect(openQ(page)).toHaveAttribute('data-turn', /^q:(agree|decide)-/);
  await expect(line(page)).toBeEnabled();
});
