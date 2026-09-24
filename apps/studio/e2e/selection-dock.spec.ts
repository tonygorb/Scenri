import { test, expect, type Page } from '@playwright/test';
import { isolate } from './harness.js';

/**
 * The bar that appears when shots are picked: what it offers, and that each
 * verb acts on the whole selection.
 *
 * Archive was the one verb missing from it. Every tile carries Archive in its
 * own menu, so putting twelve shots away meant twelve menus; the bar offered
 * Keep and Add to set and left the one bulk verb somebody actually wants for
 * a feed of misses on the tile alone.
 *
 * Since the toolbar redesign the verbs are icons that name themselves in a
 * tooltip, so these tests read accessible names rather than button text: the
 * name is the contract, the glyph is the drawing.
 */
isolate();

async function seedShots(page: Page, count: number): Promise<{ slug: string; id: string }> {
  await page.goto('/');
  await page.waitForURL((u) => u.pathname.split('/').filter(Boolean).length === 1);
  const slug = decodeURIComponent(new URL(page.url()).pathname.split('/')[1]);
  const brands = (await (await page.request.get('/api/brands')).json()) as { id: string; slug: string }[];
  const id = brands.find((b) => b.slug === slug)?.id ?? brands[0].id;
  const ws = (await (await page.request.get(`/api/brands/${id}/workspace`)).json()) as {
    project: { id: string };
    root: string;
  };
  await page.request.post('/api/nodes', {
    data: {
      projectId: ws.project.id,
      parentId: ws.root,
      kind: 'generation',
      prompt: 'a shelf',
      engineId: 'demo',
      count,
    },
  });
  await expect
    .poll(async () => {
      const feed = (await (await page.request.get(`/api/brands/${id}/feed?limit=50`)).json()) as {
        items: { status: string }[];
      };
      return feed.items.filter((n) => n.status === 'done').length;
    })
    .toBeGreaterThanOrEqual(count);
  return { slug, id };
}

const cells = (p: Page) => p.locator('.sc-cell[data-fb-node]');
const bar = (p: Page) => p.locator('.sc-picked');

async function pick(page: Page, i: number) {
  const cell = cells(page).nth(i);
  // no manual scroll: the feed re-renders as shots land and a handle taken
  // before that detaches, where the retrying actions below do not
  await expect(cell).toBeVisible();
  await cell.hover();
  await cell.getByRole('button', { name: /^Select/ }).click();
}

const lensCount = async (page: Page, name: RegExp) =>
  Number(((await page.getByRole('tab', { name }).textContent()) ?? '').replace(/\D/g, '') || '0');

test('the bar archives the whole selection at once, and one Undo brings it all back', async ({ page }) => {
  test.setTimeout(90_000);
  const brand = await seedShots(page, 3);
  await page.goto(`/${brand.slug}/create`);
  await expect(cells(page).first()).toBeVisible();
  const before = await cells(page).count();
  const archivedBefore = await lensCount(page, /^Archived/);

  await pick(page, 0);
  await pick(page, 1);
  await expect(bar(page)).toContainText('2 selected');
  await bar(page).getByRole('button', { name: 'Archive' }).click();

  // both leave the feed, the bar goes with the selection, and one toast says so
  await expect(cells(page)).toHaveCount(before - 2);
  await expect(bar(page)).toHaveCount(0);
  const toast = page.locator('.sc-toast', { hasText: 'Archived 2 shots' });
  await expect(toast).toBeVisible();
  await expect.poll(() => lensCount(page, /^Archived/)).toBe(archivedBefore + 2);

  await toast.getByRole('button', { name: 'Undo' }).click();
  await expect(cells(page)).toHaveCount(before);
  await expect.poll(() => lensCount(page, /^Archived/)).toBe(archivedBefore);
});

test('the bar carries the same verbs as one tile, and Done leaves the selection empty', async ({ page }) => {
  test.setTimeout(90_000);
  const brand = await seedShots(page, 2);
  await page.goto(`/${brand.slug}/create`);
  await expect(cells(page).first()).toBeVisible();

  await pick(page, 0);
  const verbs = await bar(page)
    .getByRole('button')
    .evaluateAll((els) => els.map((el) => el.getAttribute('aria-label') ?? (el.textContent ?? '').trim()));
  expect(verbs).toEqual(['Select all', 'Keep', 'Add to set', 'Archive', 'Done']);

  await bar(page).getByRole('button', { name: 'Done' }).click();
  await expect(bar(page)).toHaveCount(0);
  await expect(page.locator('.sc-cell[data-picked]')).toHaveCount(0);
});

test('an archived selection offers Restore and Delete, and archiving is not offered twice', async ({ page }) => {
  test.setTimeout(90_000);
  const brand = await seedShots(page, 2);
  await page.goto(`/${brand.slug}/create`);
  await expect(cells(page).first()).toBeVisible();
  await pick(page, 0);
  await bar(page).getByRole('button', { name: 'Archive' }).click();
  await expect(bar(page)).toHaveCount(0);

  await page.getByRole('tab', { name: /^Archived/ }).click();
  await expect(cells(page).first()).toBeVisible();
  await pick(page, 0);
  const verbs = await bar(page)
    .getByRole('button')
    .evaluateAll((els) => els.map((el) => el.getAttribute('aria-label') ?? (el.textContent ?? '').trim()).join(' '));
  expect(verbs).toContain('Restore');
  expect(verbs).toContain('Delete 1 permanently');
  expect(verbs).not.toContain('Archive');
  await bar(page).getByRole('button', { name: 'Restore' }).click();
  await expect(bar(page)).toHaveCount(0);
});

test('right-click on a picked tile archives the whole pick', async ({ page }) => {
  test.setTimeout(90_000);
  const brand = await seedShots(page, 3);
  await page.goto(`/${brand.slug}/create`);
  await expect(cells(page).first()).toBeVisible();
  const before = await cells(page).count();

  await pick(page, 0);
  await pick(page, 1);
  await expect(bar(page)).toContainText('2 selected');
  await cells(page).nth(0).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Archive 2 shots' }).click();

  await expect(cells(page)).toHaveCount(before - 2);
  await expect(bar(page)).toHaveCount(0);
});

test('right-click on an unpicked tile during a pick still archives only that shot', async ({ page }) => {
  test.setTimeout(90_000);
  const brand = await seedShots(page, 3);
  await page.goto(`/${brand.slug}/create`);
  await expect(cells(page).first()).toBeVisible();
  const before = await cells(page).count();

  await pick(page, 0);
  await pick(page, 1);
  await expect(bar(page)).toContainText('2 selected');
  await cells(page).nth(2).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Archive' }).click();

  await expect(cells(page)).toHaveCount(before - 1);
  await expect(bar(page)).toContainText('2 selected');
});

test('right-click Remove from set takes the whole pick out of the set', async ({ page }) => {
  test.setTimeout(90_000);
  const brand = await seedShots(page, 3);
  const feed = (await (await page.request.get(`/api/brands/${brand.id}/feed?limit=50`)).json()) as {
    items: { id: string; status: string }[];
  };
  const ids = feed.items.filter((n) => n.status === 'done').map((n) => n.id);
  const stamp = String(Date.now());
  const made = (await (
    await page.request.post(`/api/brands/${brand.id}/sets`, { data: { name: `test123 ${stamp}` } })
  ).json()) as { id: string; slug: string };
  await page.request.post(`/api/sets/${made.id}/nodes`, { data: { nodeIds: ids } });

  await page.goto(`/${brand.slug}/sets/${made.slug}`);
  await expect(cells(page)).toHaveCount(ids.length);
  await pick(page, 0);
  await pick(page, 1);
  await expect(bar(page)).toContainText('2 selected');
  const removeName = `Remove 2 shots from test123 ${stamp}`;
  await expect(bar(page).getByRole('button', { name: removeName })).toBeVisible();
  await cells(page).nth(0).click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: removeName })).toBeVisible();
  await page.keyboard.press('Escape');
  await bar(page).getByRole('button', { name: removeName }).click();

  await expect(cells(page)).toHaveCount(ids.length - 2);
  await expect(bar(page)).toHaveCount(0);
});
