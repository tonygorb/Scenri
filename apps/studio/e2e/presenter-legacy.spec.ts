import { test, expect, type Page } from '@playwright/test';
import { isolate } from './harness.js';

/**
 * Presenters made before the studio existed.
 *
 * 0.10.0 must not assume every record came from Studio v2. The oldest ones
 * carry a name and some pictures and nothing else: no angle on their shots, no
 * source, no prose about who they are. Opening one used to be a dead end, and
 * the editor claimed changes it had not been given.
 */
isolate({ env: { SCENRI_DEMO_BUILDS: '1', SCENRI_DEMO_REFS: '5' } });

const log = (p: Page) => p.getByRole('log');
const answer = (p: Page, label: string) => log(p).getByRole('button', { name: label, exact: true });
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

async function currentBrand(p: Page): Promise<{ slug: string; id: string }> {
  await p.goto('/');
  await p.waitForURL((u) => {
    const seg = u.pathname.split('/').filter(Boolean);
    return seg.length === 1 && seg[0] !== 'setup';
  });
  const slug = decodeURIComponent(new URL(p.url()).pathname.split('/')[1]);
  const brands = (await (await p.request.get('/api/brands')).json()) as { id: string; slug: string }[];
  return { slug, id: brands.find((b) => b.slug === slug)?.id ?? brands[0].id };
}

/**
 * A record of the oldest shape: pictures with no angle, and nothing said about
 * who they are. With no `sourceRefs` it reads as synthetic, which is the case
 * that had no way to draw anything.
 */
async function legacyPresenter(p: Page, brandId: string, name: string): Promise<string> {
  const hashes: string[] = [];
  for (let i = 0; i < 2; i++) {
    const up = await p.request.post('/api/images', {
      multipart: { file: { name: `${name}-${i}.png`, mimeType: 'image/png', buffer: PNG } },
    });
    hashes.push((await up.json()).hash);
  }
  const made = await (
    await p.request.post(`/api/brands/${brandId}/presenters`, { data: { name, shotHashes: hashes } })
  ).json();
  return made.presenter.id as string;
}

test('a legacy record opens on its page, with its pictures and no broken frame', async ({ page }) => {
  const brand = await currentBrand(page);
  const id = await legacyPresenter(page, brand.id, 'Ancient');
  await page.goto(`/${brand.slug}/presenters/${id}`);
  await expect(page.getByLabel('Their name').or(page.getByRole('heading', { level: 1 }))).toBeVisible();
  await expect(page.locator('.sc-refset li')).toHaveCount(2);
  await expect(page.getByRole('link', { name: 'Edit presenter' })).toBeVisible();
});

/**
 * The editor used to say a legacy record was dirty the moment it opened.
 *
 * The session promotes an angle-less first shot to the portrait, and `isDirty`
 * keyed the saved shots by their raw angle, so that promoted face matched
 * nothing and read as a change nobody had made. Discard changes was offered
 * over an untouched record.
 */
test('the editor does not claim changes nobody made', async ({ page }) => {
  const brand = await currentBrand(page);
  const id = await legacyPresenter(page, brand.id, 'Untouched');
  await page.goto(`/${brand.slug}/presenters/${id}/edit`);
  await expect(log(page)).toContainText('What would you like to change', { timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'Discard changes' })).toHaveCount(0);
});

/**
 * The dead end. A record with no prose refused every draw with "describe who
 * they are in a sentence" and offered nothing that could supply one: Build
 * them, a retry and an identity edit all 400, and the only way out was to
 * leave. The sentence typed at a person who has no description is now that
 * description.
 */
test('a record that says nothing about them can still be drawn, from a sentence', async ({ page }) => {
  test.setTimeout(90_000);
  const brand = await currentBrand(page);
  const id = await legacyPresenter(page, brand.id, 'Wordless');
  await page.goto(`/${brand.slug}/presenters/${id}/edit`);
  await expect(log(page)).toContainText('What would you like to change', { timeout: 30_000 });
  // nothing to build them from, so no build is offered and the line is open
  await expect(answer(page, 'Build them')).toHaveCount(0);

  await page.locator('.sc-convo-card textarea').fill('a woman in her 40s with short grey hair');
  await page.locator('.sc-convo-card textarea').press('Enter');

  // it draws rather than refusing, and the decision is what it asks about
  await expect(answer(page, 'Use this')).toBeVisible({ timeout: 40_000 });
  const drafts = (await (await page.request.get(`/api/brands/${brand.id}/presenter-drafts`)).json()) as {
    drafts: { id: string; presenterId?: string }[];
  };
  const mine = drafts.drafts.find((d) => d.presenterId === id)!;
  const row = await (await page.request.get(`/api/brands/${brand.id}/presenter-drafts/${mine.id}`)).json();
  expect(row.direction).toContain('short grey hair');
});

test('a legacy record can be cast into a brief like any other', async ({ page }) => {
  const brand = await currentBrand(page);
  await legacyPresenter(page, brand.id, 'Castable');
  await page.goto(`/${brand.slug}/create?compose=1`);
  await page.locator('.sc-brief').click();
  await page.keyboard.type('with @');
  await expect(page.locator('.sc-cmd-row', { hasText: 'Castable' })).toHaveCount(1);
});
