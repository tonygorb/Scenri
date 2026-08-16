import { test, expect, type Page } from '@playwright/test';
import { isolate } from './harness.js';

/**
 * What the app does when the tree it is holding is behind the server.
 *
 * The tree is a snapshot, and two screens used to read a gap in it as a fact:
 * the shot overlay told you a shot you had just made was "no longer available"
 * because it was fetched before that shot existed, and the set route threw you
 * out of a set you had just renamed because the list still spelled the old
 * slug. Both passed on a fast machine and failed on CI, where the answer takes
 * long enough to be seen.
 *
 * So a miss is now a question, not a verdict: ask the server once, and only
 * believe it if it is still a miss afterwards. Both halves are worth holding —
 * that a stale gap is survived, and that a real deletion is still reported —
 * so each case here has its negative twin.
 *
 * The staleness is forced rather than waited for: `staleOnce` serves the first
 * workspace with the row removed, which is the CI condition exactly and takes
 * no seconds to reproduce.
 */

// A scenri of this file's own, on an empty home, seeded from scratch.
isolate();

const api = async (p: Page, path: string, init?: RequestInit) =>
  p.evaluate(
    async ([u, i]) => {
      const r = await fetch(u as string, i as RequestInit);
      return r.json();
    },
    [path, init ?? undefined],
  );

async function currentBrand(p: Page) {
  await p.goto('/');
  await p.waitForURL((u) => {
    const seg = u.pathname.split('/').filter(Boolean);
    return seg.length === 1 && seg[0] !== 'setup';
  });
  const slug = decodeURIComponent(new URL(p.url()).pathname.split('/')[1]);
  const brands = (await api(p, '/api/brands')) as any[];
  return { id: brands.find((b) => b.slug === slug).id, slug };
}

/** Serve the workspace with `drop` applied, once, then tell the truth. */
async function staleOnce(p: Page, drop: (ws: any) => void) {
  let spent = false;
  await p.route('**/api/brands/*/workspace', async (route) => {
    const res = await route.fetch();
    const ws = await res.json();
    if (!spent) {
      spent = true;
      drop(ws);
    }
    await route.fulfill({ response: res, json: ws });
  });
}

test('a shot missing from a stale tree is confirmed, not declared gone', async ({ page }) => {
  const brand = await currentBrand(page);
  const ws = (await api(page, `/api/brands/${brand.id}/workspace`)) as any;
  const shot = ws.nodes.find((n: any) => n.kind !== 'root' && n.status === 'done');
  expect(shot, 'seed shot').toBeTruthy();

  // exactly the CI condition: the first tree the overlay sees predates the shot
  await staleOnce(page, (w) => {
    w.nodes = w.nodes.filter((n: any) => n.id !== shot.id);
  });

  await page.goto(`/${brand.slug}/create/shots/${shot.id}`);
  await expect(page.locator('.sc-ovl')).toBeVisible();
  await expect(page.locator('.sc-toast', { hasText: 'no longer available' })).toHaveCount(0);
});

test('a shot that really is gone still says so', async ({ page }) => {
  const brand = await currentBrand(page);
  await page.goto(`/${brand.slug}/create/shots/00000000-0000-4000-8000-000000000000`);
  await expect(page.locator('.sc-toast', { hasText: 'no longer available' })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/${brand.slug}/create$`));
});

test('a set missing from a stale tree is confirmed, not bounced', async ({ page }) => {
  const brand = await currentBrand(page);
  const made = (await api(page, `/api/brands/${brand.id}/sets`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Race set' }),
  })) as any;

  await staleOnce(page, (w) => {
    w.sets = w.sets.filter((s: any) => s.id !== made.id);
  });

  await page.goto(`/${brand.slug}/sets/${made.slug}`);
  await expect(page.locator('.sc-crumb-btn b')).toHaveText('Race set');
  await expect(page).toHaveURL(new RegExp(`/sets/${made.slug}$`));
});

test('a set that really is gone still bounces to the hub', async ({ page }) => {
  const brand = await currentBrand(page);
  await page.goto(`/${brand.slug}/sets/no-such-set-at-all`);
  await expect(page).toHaveURL(new RegExp(`/${brand.slug}/create$`));
});
