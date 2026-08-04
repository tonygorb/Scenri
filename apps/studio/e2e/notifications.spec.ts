import { test, expect, type Page } from '@playwright/test';

/**
 * The bell exists because work used to be visible only from the screen that
 * started it. So the case that matters most here is the one that used to be
 * impossible: start a generation, stand somewhere else entirely, and still be
 * told when it lands.
 *
 * Like the other specs this runs against a real scenri server on the free Demo
 * engine, and selects by the `bt-` class names the app actually ships.
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

async function brandId(p: Page): Promise<string> {
  await p.goto('/');
  await p.waitForURL(/\/b\/[^/]+$/);
  return new URL(p.url()).pathname.split('/')[2];
}

const bell = (p: Page) => p.locator('.bt-topbar .bt-notif-btn');
const pop = (p: Page) => p.locator('.bt-notif-pop');
const tabs = (p: Page) => p.locator('.bt-notif-tab');
const rows = (p: Page) => p.locator('.bt-notif-scroll .bt-notif-row');

/** Start a generation without ever opening the project it belongs to. */
async function fireAndWalkAway(p: Page, brand: string) {
  const projects = (await api(p, `/api/projects?brandId=${brand}`)) as any[];
  const project =
    projects[0] ?? (await api(p, '/api/projects', postJson({ brandId: brand, name: 'Bell spec' }))).project;
  const tree = (await api(p, `/api/projects/${project.id}/tree`)) as any;
  const root = (tree.nodes ?? []).find((n: any) => n.kind === 'root');
  const made = (await api(
    p,
    '/api/nodes',
    postJson({
      projectId: project.id,
      parentId: root?.id ?? null,
      kind: 'generation',
      prompt: 'bell spec shot',
      engineId: 'demo',
      count: 1,
    }),
  )) as any;
  return { projectId: project.id, nodeId: made.id };
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
  const brand = await brandId(page);
  const projects = (await api(page, `/api/projects?brandId=${brand}`)) as any[];

  for (const path of [`/b/${brand}`, `/b/${brand}/looks`, `/b/${brand}/brand`]) {
    await page.goto(path);
    await expect(bell(page)).toBeVisible();
  }
  if (projects[0]) {
    await page.goto(`/b/${brand}/p/${projects[0].id}`);
    await expect(bell(page)).toBeVisible();
  }
});

test('opens on Tasks; Notifications starts empty and is keyboard reachable', async ({ page }) => {
  const brand = await brandId(page);
  await clearHistory(page);
  await page.goto(`/b/${brand}/looks`);

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
  await expect(page.locator('.bt-notif-empty')).toHaveText('You have no notifications yet.');
  await page.keyboard.press('ArrowRight');
  await expect(tabs(page).nth(0)).toHaveAttribute('aria-selected', 'true');
});

test('work started from another screen still arrives, survives a reload, and clears', async ({ page }) => {
  const brand = await brandId(page);
  await clearHistory(page);

  // stand on Home. The project this belongs to is never opened.
  await page.goto(`/b/${brand}`);
  await expect(bell(page)).toBeVisible();
  await fireAndWalkAway(page, brand);

  // the badge is the first thing that should change
  await expect(page.locator('.bt-bell-dot')).toBeVisible({ timeout: 20_000 });
  await expect(page).toHaveURL(new RegExp(`/b/${brand}$`));

  await bell(page).click();
  await tabs(page).nth(1).click();
  await expect(rows(page)).not.toHaveCount(0);
  const first = rows(page).first();
  await expect(first).toContainText('bell spec shot');

  // reading the list is what clears the badge, not opening the bell
  await page.keyboard.press('Escape');
  await expect(pop(page)).toHaveCount(0);
  await expect(page.locator('.bt-bell-dot')).toHaveCount(0);

  // the record outlives the page
  await page.reload();
  await bell(page).click();
  await tabs(page).nth(1).click();
  await expect(rows(page)).not.toHaveCount(0);

  // and a row is a way back to the thing it is about
  await rows(page).first().click();
  await page.waitForURL(/\/p\/[^/]+\/n\/[^/]+/);
  await expect(page.locator('.bt-ovl')).toBeVisible();
});

test('the panel does not follow you to the next screen', async ({ page }) => {
  const brand = await brandId(page);
  await page.goto(`/b/${brand}`);
  await bell(page).click();
  await expect(pop(page)).toBeVisible();

  await page.locator('.bt-nav button', { hasText: 'Looks' }).click();
  await page.waitForURL(/\/looks$/);
  await expect(pop(page)).toHaveCount(0);
});

test('clearing empties the record', async ({ page }) => {
  const brand = await brandId(page);
  await page.goto(`/b/${brand}`);
  await bell(page).click();
  await tabs(page).nth(1).click();

  const clear = page.locator('.bt-notif-clear');
  if (await clear.isVisible().catch(() => false)) {
    await clear.click();
  }
  await expect(page.locator('.bt-notif-empty')).toHaveText('You have no notifications yet.');
});

test('a finish still toasts while you are on the project', async ({ page }) => {
  const brand = await brandId(page);
  await clearHistory(page);
  const { projectId } = await fireAndWalkAway(page, brand);

  // the emitter moved up to TaskCenter; the toast must not have gone with it
  await page.goto(`/b/${brand}/p/${projectId}`);
  await fireAndWalkAway(page, brand);
  await expect(page.locator('.bt-toast').first()).toBeVisible({ timeout: 20_000 });
});
