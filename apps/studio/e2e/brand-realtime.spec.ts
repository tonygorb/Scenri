import { test, expect, type Page } from '@playwright/test';
import { isolate } from './harness.js';
import {
  brandJson,
  currentBrand,
  expectSameSession,
  goCreate,
  holdNext,
  markSession,
  switchBrand,
} from './realtime.js';

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
  // The dialog belonged to the brand that is gone: it does not reopen on the
  // brand you land on, with that brand's danger zone showing.
  await expect(page.getByRole('dialog', { name: 'Settings' })).toHaveCount(0);
  expect(new URL(page.url()).searchParams.get('settings')).toBeNull();
  await page.locator('.sc-org-btn').click();
  await expect(page.locator('.sc-menu-item', { hasText: 'Doomed Brand' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await goCreate(page);
  await expectSameSession(page);
});

// Every brand write used to re-arm the bell's poll loop, which fired a tick at
// once: an autosaving kit field asked for the brand's activity once per pause.
test('a kit save does not make the bell poll again', async ({ page }) => {
  const brand = await currentBrand(page);
  await page.goto(`/${brand.slug}/create`);
  await markSession(page);
  await openSettings(page);
  const polls: number[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/activity')) polls.push(Date.now());
  });

  const tagline = page.getByRole('dialog', { name: 'Settings' }).getByLabel('Tagline');
  const put = page.waitForResponse((r) => r.request().method() === 'PUT' && /\/api\/brands\/[^/]+$/.test(r.url()));
  await tagline.fill('Quietly saved');
  await tagline.press('Enter');
  await put;
  const savedAt = Date.now();
  await page.waitForTimeout(1_000);

  // no tick chasing the write: the poll keeps its own cadence
  expect(polls.filter((t) => t >= savedAt - 50 && t <= savedAt + 600)).toEqual([]);
  await expectSameSession(page);
});

// A kit field wrote itself when it blurred, and a field taken away with the
// caret in it never blurs: Back closed Settings around it, and a window
// crossing the phone width rebuilt Settings as the other layout (S2-02).
test('a kit edit still being typed is kept through Back and through a change of layout', async ({ page }) => {
  const brand = await currentBrand(page);
  await page.goto(`/${brand.slug}/create`);
  await markSession(page);
  await openSettings(page);
  const tagline = () => page.getByRole('dialog', { name: 'Settings' }).getByLabel('Tagline');
  await tagline().click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('Kept through Back');
  await expect(tagline()).toBeFocused();
  await page.goBack();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect.poll(async () => (await brandJson(page.request, brand.id)).meta?.tagline).toBe('Kept through Back');

  await openSettings(page);
  await tagline().click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('Kept through a resize');
  await expect(tagline()).toBeFocused();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(async () => (await brandJson(page.request, brand.id)).meta?.tagline).toBe('Kept through a resize');
  await page.setViewportSize({ width: 1440, height: 900 });
  await expectSameSession(page);
});

// The frame kept the brand it had left's workspace until the new brand's
// answer landed, and Create sent that project: a shot typed in that moment
// was filed in the other brand, with its rules, while its tile spun here (S8-03).
test('a shot sent right after a brand switch is filed in the brand on screen', async ({ page }) => {
  const home = await currentBrand(page);
  const made = await page.request.post('/api/brands', {
    data: { brand: { specVersion: '0.1', meta: { name: 'Second Studio' } } },
  });
  const other = (await made.json()) as { id: string };
  const projectOf = async (id: string) =>
    ((await (await page.request.get(`/api/brands/${id}/workspace`)).json()) as { project: { id: string } }).project.id;
  const otherProject = await projectOf(other.id);
  const homeProject = await projectOf(home.id);

  await page.goto(`/${home.slug}/create`);
  await markSession(page);
  await expect(page.locator('.sc-brief-line').first()).toBeVisible();
  const sent: string[] = [];
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().endsWith('/api/nodes')) sent.push(JSON.parse(r.postData() ?? '{}').projectId);
  });

  // the new brand's workspace answer is late, the way a loaded server's is
  const held = await holdNext(page, `**/api/brands/${other.id}/workspace`);
  await switchBrand(page, 'Second Studio');
  await goCreate(page);
  await held.caught;
  const line = page.locator('.sc-brief-line').first();
  await line.click();
  await page.keyboard.type('a shelf in the second studio');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
  expect(sent, `sent before the brand on screen was known; ${homeProject} is the brand just left`).toEqual([]);

  held.release();
  await expect(page.locator('.sc-canvas-dock .sc-send').first()).toBeEnabled();
  await line.click();
  await page.keyboard.press('Enter');
  await expect.poll(() => sent).toEqual([otherProject]);
  await expectSameSession(page);
});
