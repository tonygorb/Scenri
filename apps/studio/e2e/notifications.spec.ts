import { test, expect, type Page } from '@playwright/test';

/**
 * The bell exists because work used to be visible only from the screen that
 * started it. So the case that matters most here is the one that used to be
 * impossible: start a generation, stand somewhere else entirely, and still be
 * told when it lands.
 *
 * Like the other specs this runs against a real scenri server on the free Demo
 * engine, and selects by the `sc-` class names the app actually ships.
 */

const api = async (p: Page, path: string, init?: RequestInit) =>
  p.evaluate(
    async ([u, i]) => {
      const r = await fetch(u as string, i as RequestInit);
      return r.json();
    },
    [path, init ?? undefined],
  );

const postJson = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

/** The path carries the brand's slug; the API still speaks in ids. */
async function currentBrand(p: Page): Promise<{ id: string; slug: string }> {
  await p.goto('/');
  await p.waitForURL(/\/b\/[^/]+$/);
  const slug = decodeURIComponent(new URL(p.url()).pathname.split('/')[2]);
  const brands = (await api(p, '/api/brands')) as any[];
  return { id: brands.find((b) => b.slug === slug).id, slug };
}

const bell = (p: Page) => p.locator('.sc-topbar .sc-notif-btn');
const pop = (p: Page) => p.locator('.sc-notif-pop');
const tabs = (p: Page) => p.locator('.sc-notif-tab');
const rows = (p: Page) => p.locator('.sc-notif-scroll .sc-notif-row');

/** Start a generation while standing somewhere the feed is not on screen. */
async function fireAndWalkAway(p: Page, brand: string) {
  const ws = (await api(p, `/api/brands/${brand}/workspace`)) as any;
  const root = (ws.nodes ?? []).find((n: any) => n.kind === 'root');
  const made = (await api(
    p,
    '/api/nodes',
    postJson({
      projectId: ws.project.id,
      parentId: root?.id ?? null,
      kind: 'generation',
      prompt: 'bell spec shot',
      engineId: 'demo',
      count: 1,
    }),
  )) as any;
  return { nodeId: made.id };
}

/** Nothing in this spec should inherit another case's history. */
async function clearHistory(p: Page) {
  await p.evaluate(() => {
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith('scenri:notifications')) localStorage.removeItem(k);
    }
  });
}

test('the bell is in the bar on every screen', async ({ page }) => {
  const brand = await currentBrand(page);
  const set = (await api(page, `/api/brands/${brand.id}/sets`, postJson({ name: 'Bell spec' }))) as any;

  for (const path of [
    `/b/${brand.slug}`,
    `/b/${brand.slug}/create`,
    `/b/${brand.slug}/looks`,
    `/b/${brand.slug}/brand`,
    `/b/${brand.slug}/s/${set.slug}`,
  ]) {
    await page.goto(path);
    await expect(bell(page)).toBeVisible();
  }
});

test('opens on Tasks; Notifications starts empty and is keyboard reachable', async ({ page }) => {
  const brand = await currentBrand(page);
  await clearHistory(page);
  await page.goto(`/b/${brand.slug}/looks`);

  await bell(page).click();
  await expect(pop(page)).toBeVisible();
  await expect(tabs(page)).toHaveCount(2);
  await expect(tabs(page).nth(0)).toHaveAttribute('aria-selected', 'true');
  await expect(tabs(page).nth(0)).toContainText('Tasks');
  await expect(tabs(page).nth(1)).toContainText('Notifications');

  // arrow keys move between the two, and wrap
  await tabs(page).nth(0).focus();
  await page.keyboard.press('ArrowRight');
  await expect(tabs(page).nth(1)).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.sc-notif-empty')).toHaveText('You have no notifications yet.');
  await page.keyboard.press('ArrowRight');
  await expect(tabs(page).nth(0)).toHaveAttribute('aria-selected', 'true');
});

test('work started from another screen still arrives, survives a reload, and clears', async ({ page }) => {
  const brand = await currentBrand(page);
  await clearHistory(page);

  // stand on Home. The project this belongs to is never opened.
  await page.goto(`/b/${brand.slug}`);
  await expect(bell(page)).toBeVisible();
  await fireAndWalkAway(page, brand.id);

  // the badge is the first thing that should change
  await expect(page.locator('.sc-bell-dot')).toBeVisible({ timeout: 20_000 });
  await expect(page).toHaveURL(new RegExp(`/b/${brand.slug}$`));

  await bell(page).click();
  await tabs(page).nth(1).click();
  await expect(rows(page)).not.toHaveCount(0);
  const first = rows(page).first();
  await expect(first).toContainText('bell spec shot');

  // reading the list is what clears the badge, not opening the bell
  await page.keyboard.press('Escape');
  await expect(pop(page)).toHaveCount(0);
  await expect(page.locator('.sc-bell-dot')).toHaveCount(0);

  // the record outlives the page
  await page.reload();
  await bell(page).click();
  await tabs(page).nth(1).click();
  await expect(rows(page)).not.toHaveCount(0);

  // and a row is a way back to the thing it is about
  await rows(page).first().click();
  await page.waitForURL(/\/b\/[^/]+\/create\/n\/[^/]+/);
  await expect(page.locator('.sc-ovl')).toBeVisible();
});

test('the panel does not follow you to the next screen', async ({ page }) => {
  const brand = await currentBrand(page);
  await page.goto(`/b/${brand.slug}`);
  await bell(page).click();
  await expect(pop(page)).toBeVisible();

  await page.locator('.sc-nav button', { hasText: 'Looks' }).click();
  await page.waitForURL(/\/looks$/);
  await expect(pop(page)).toHaveCount(0);
});

test('clearing empties the record', async ({ page }) => {
  const brand = await currentBrand(page);
  await page.goto(`/b/${brand.slug}`);
  await bell(page).click();
  await tabs(page).nth(1).click();

  const clear = page.locator('.sc-notif-clear');
  if (await clear.isVisible().catch(() => false)) {
    await clear.click();
  }
  await expect(page.locator('.sc-notif-empty')).toHaveText('You have no notifications yet.');
});

test('a finish still toasts while you are on the feed', async ({ page }) => {
  const brand = await currentBrand(page);
  await clearHistory(page);

  // the emitter moved up to TaskCenter; the toast must not have gone with it
  await page.goto(`/b/${brand.slug}`);
  await fireAndWalkAway(page, brand.id);
  await expect(page.locator('.sc-toast').first()).toBeVisible({ timeout: 20_000 });
});

test('a notification row opens the shot it is about', async ({ page }) => {
  const brand = await currentBrand(page);
  await clearHistory(page);

  await page.goto(`/b/${brand.slug}/looks`);
  const { nodeId } = await fireAndWalkAway(page, brand.id);
  await expect(page.locator('.sc-bell-dot')).toBeVisible({ timeout: 20_000 });

  await bell(page).click();
  await tabs(page).nth(1).click();
  await rows(page).first().click();

  // the href used to name a project route that no longer exists
  await page.waitForURL(`**/b/${brand.slug}/create/n/${nodeId}`);
  await expect(page.locator('.sc-ovl')).toBeVisible();
});
