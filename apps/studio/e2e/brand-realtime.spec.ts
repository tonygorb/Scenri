import { test, expect, type Page } from '@playwright/test';
import { isolate } from './harness.js';
import { currentBrand, expectSameSession, goCreate, markSession, switchBrand } from './realtime.js';

/**
 * Brand-level mutations and the shot surfaces, on the same terms as the asset
 * realtime specs: one document per test, and every change seen where the
 * person is, without a reload.
 */
isolate();
test.describe.configure({ mode: 'serial' });

const openSettings = async (page: Page, pane?: string) => {
  await page.locator('.sc-org-btn').click();
  await page.locator('.sc-menu').getByText('Settings', { exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  if (pane) await page.getByRole('dialog').getByRole('button', { name: pane, exact: true }).click();
};

const cells = (p: Page) => p.locator('.sc-cell[data-fb-node]');
const railShots = (p: Page) =>
  p.locator('.sc-assets .sc-agroup', { has: p.locator('.sc-agroup-t', { hasText: 'Recent shots' }) });

async function seedShots(page: Page, brandId: string, count: number): Promise<void> {
  const ws = (await (await page.request.get(`/api/brands/${brandId}/workspace`)).json()) as {
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
      const feed = (await (await page.request.get(`/api/brands/${brandId}/feed?limit=50`)).json()) as {
        items: { status: string }[];
      };
      return feed.items.filter((n) => n.status === 'done').length;
    })
    .toBeGreaterThanOrEqual(count);
}

test('renaming the brand moves its address and its name in place, without remounting the studio', async ({ page }) => {
  const brand = await currentBrand(page);
  await page.goto(`/${brand.slug}/create`);
  await markSession(page);
  await openSettings(page);
  // a stamp on the dialog as it is now: a remount draws a new one without it
  await page.getByRole('dialog').evaluate((el) => el.setAttribute('data-probe', 'same'));
  const puts: string[] = [];
  page.on('request', (r) => {
    if (r.method() === 'PUT' && /\/api\/brands\/[^/]+$/.test(r.url())) puts.push(r.url());
  });

  const name = page.getByRole('dialog').getByLabel('Name', { exact: true });
  await name.fill('Renamed Fixture');
  await name.press('Enter');

  await expect(page).toHaveURL(/\/renamed-fixture\/create/);
  await expect(page.locator('.sc-org-btn')).toHaveAttribute('aria-label', 'Renamed Fixture, brand and settings');
  await expect(page.getByRole('dialog', { name: 'Settings' })).toHaveAttribute('data-probe', 'same');
  // Enter saved the name and was spent there: no shot opened behind the dialog
  await expect(page.locator('.sc-ovl')).toHaveCount(0);
  await page.waitForTimeout(800);
  // one save for one edit: a remount used to send the kit's edits again on its way out
  expect(puts).toHaveLength(1);
  await expectSameSession(page);
});

test('archiving a shot takes it out of the open Recent shots section too', async ({ page }) => {
  const brand = await currentBrand(page);
  await seedShots(page, brand.id, 3);
  await page.goto(`/${brand.slug}/create`);
  await markSession(page);
  await expect(cells(page).first()).toBeVisible();
  await railShots(page).locator('.sc-agroup-t').click();
  await expect(railShots(page).locator('.sc-agroup-t')).toHaveAttribute('aria-expanded', 'true');
  const tiles = railShots(page).locator('.sc-acard');
  await expect(tiles.first()).toBeVisible();
  const before = await tiles.count();

  const top = cells(page).first();
  await top.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Archive' }).click();
  await expect(tiles).toHaveCount(before - 1);
  await expectSameSession(page);
});

test('deleting every generated shot empties the feed and the rail behind the dialog', async ({ page }) => {
  const brand = await currentBrand(page);
  await seedShots(page, brand.id, 2);
  await page.goto(`/${brand.slug}/create`);
  await markSession(page);
  await expect(cells(page).first()).toBeVisible();
  await railShots(page).locator('.sc-agroup-t').click();
  await expect(railShots(page).locator('.sc-acard').first()).toBeVisible();

  await openSettings(page, 'Danger zone');
  await page.getByRole('button', { name: 'Delete shots', exact: true }).click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: /Delete/ })
    .click();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await expect(cells(page)).toHaveCount(0);
  await expect(railShots(page).locator('.sc-acard')).toHaveCount(0);
  await expectSameSession(page);
});

test('deleting a brand lands on another one without mounting the dead one again', async ({ page }) => {
  const home = await currentBrand(page);
  const doomed = (
    await (
      await page.request.post('/api/brands', {
        data: { brand: { specVersion: '0.1', meta: { name: 'Doomed Brand' } } },
      })
    ).json()
  ).id as string;
  await page.goto(`/${home.slug}`);
  await markSession(page);
  await switchBrand(page, 'Doomed Brand');
  await expect(page).toHaveURL(/\/doomed-brand(\/|$)/);

  const after: string[] = [];
  let deleted = false;
  page.on('response', (r) => {
    if (r.request().method() === 'DELETE' && r.url().endsWith(`/api/brands/${doomed}`)) deleted = true;
  });
  page.on('request', (r) => {
    if (deleted && r.url().includes(`/api/brands/${doomed}/`)) after.push(r.url());
  });
  await openSettings(page, 'Danger zone');
  await page.getByRole('button', { name: 'Delete brand', exact: true }).click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: /Delete/ })
    .click();

  await expect(page).not.toHaveURL(/\/doomed-brand(\/|$)/);
  await expect(page.locator('.sc-org-btn')).not.toHaveAttribute('aria-label', /^Doomed Brand,/);
  await page.waitForTimeout(800);
  expect(after).toEqual([]);
  await page.locator('.sc-org-btn').click();
  await expect(page.locator('.sc-menu-item', { hasText: 'Doomed Brand' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await goCreate(page);
  await expectSameSession(page);
});
