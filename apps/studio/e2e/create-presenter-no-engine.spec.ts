import { expect, type Page, test } from '@playwright/test';
import { isolate } from './harness.js';
import { LOGO, PORTRAIT, picture } from './pictures.js';

/**
 * No drawing engine. A presenter is what an engine draws, from a sentence or
 * from photographs alike, so both doors stop at the same setup line.
 * Photographs still go in, and stay photographs: nothing is saved, no draft is
 * opened, and no upload becomes anybody's face.
 *
 * This file used to pin the opposite, "photos still become the presenter,
 * saved as they are", which is how a logo became a presenter on the wall.
 */
isolate({ shot: false, env: { SCENRI_DEMO_ENGINE: '0', SCENRI_DEMO_BUILDS: '0' } });

const GATE = 'Drawing a person needs image generation, which is not set up yet.';

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

const log = (p: Page) => p.getByRole('log');
const answer = (p: Page, label: string) => log(p).getByRole('button', { name: label, exact: true });

/** Nothing was made: no presenter of theirs on the brand (the seed's roster has one), and no draft on the server. */
async function nothingMade(p: Page, brandId: string) {
  const brands = await (await p.request.get('/api/brands')).json();
  const theirs = (brands.find((b: any) => b.id === brandId).json.characters ?? []).filter((c: any) =>
    String(c.id).startsWith('up-'),
  );
  expect(theirs).toEqual([]);
  const drafts = await (await p.request.get(`/api/brands/${brandId}/presenter-drafts`)).json();
  expect(drafts.drafts ?? drafts).toEqual([]);
}

/** Photographs chosen at the photo door and Continue pressed. */
async function continueWith(p: Page, files: { name: string; buffer: Buffer }[]) {
  await answer(p, 'Add photos').click();
  await p.locator('input[type="file"]').setInputFiles(files.map((f) => picture(f.name, f.buffer)));
  await expect(p.locator('.sc-assetform-ref')).toHaveCount(files.length);
  await p.getByRole('checkbox').check();
  await answer(p, 'Continue').click();
}

test('describing stops at the setup line, with no way round it', async ({ page }) => {
  const brand = await currentBrand(page);
  await page.goto(`/${brand.slug}/people/new`);
  await answer(page, 'Describe someone').click();
  await expect(log(page)).toContainText(GATE);
  await expect(answer(page, 'Set up')).toBeVisible();
  // the way round it was "Add photos instead", into a door that saved the upload as the face
  await expect(answer(page, 'Add photos instead')).toHaveCount(0);
  await expect(page.locator('.sc-pstudio-well img')).toHaveCount(0);
  await nothingMade(page, brand.id);
});

test('a logo at the photo door stays a photo: Continue stops at the same line, a reload keeps it, nothing is made', async ({
  page,
}) => {
  test.setTimeout(60_000);
  const brand = await currentBrand(page);
  await page.goto(`/${brand.slug}/people/new`);
  // the upload itself needs nothing: it goes in, and Continue is live
  await continueWith(page, [{ name: 'acme-logo.png', buffer: LOGO }]);
  await expect(log(page)).toContainText(GATE);
  await expect(answer(page, 'Set up')).toBeVisible();
  await expect(answer(page, 'Change photos')).toBeVisible();
  // the logo stands above the line as what was given, and nowhere as a face
  await expect(page.locator('[data-turn="you:photos"] img')).toHaveCount(1);
  await expect(page.locator('.sc-pstudio-well img')).toHaveCount(0);
  await expect(page).toHaveURL(/\/people\/new$/);
  await nothingMade(page, brand.id);

  // a reload is the same conversation, stopped at the same place, the logo still theirs
  await page.reload();
  await expect(log(page)).toContainText(GATE);
  await expect(page.locator('[data-turn="you:photos"] img')).toHaveCount(1);

  // and back to the photographs, every one still there, with nothing to upload again
  await answer(page, 'Change photos').click();
  await expect(page.locator('.sc-assetform-ref')).toHaveCount(1);
  await expect(answer(page, 'Continue')).toBeVisible();
  await nothingMade(page, brand.id);

  // nothing reached the wall: it still offers to cast their first one
  await page.goto(`/${brand.slug}/people`);
  await expect(page.getByRole('heading', { name: 'Create your own person' })).toBeVisible();
  await expect(page.getByText('Your people', { exact: true })).toHaveCount(0);
});

test('a photo that looks like a person, and more than one picture, stop at the same place', async ({ page }) => {
  const brand = await currentBrand(page);
  await page.goto(`/${brand.slug}/people/new`);
  await continueWith(page, [
    { name: 'portrait.png', buffer: PORTRAIT },
    { name: 'acme-logo.png', buffer: LOGO },
  ]);
  await expect(log(page)).toContainText(GATE);
  await expect(page.locator('[data-turn="you:photos"] img')).toHaveCount(2);
  await nothingMade(page, brand.id);
});

test('a studio that believed something could draw is refused by the server, and says Set up', async ({ page }) => {
  // What the studio read went stale: a login that lapsed after it opened. The
  // server is the one that knows, and its refusal is the same setup line.
  await page.route('**/api/asset-builds/capabilities', (route) =>
    route.fulfill({
      json: { canAnalyze: false, canGenerate: true, engineId: 'codex-cli', engineName: 'Codex', free: true },
    }),
  );
  const brand = await currentBrand(page);
  await page.goto(`/${brand.slug}/people/new`);
  await continueWith(page, [{ name: 'acme-logo.png', buffer: LOGO }]);
  await expect(log(page)).toContainText(GATE);
  await expect(answer(page, 'Set up')).toBeVisible();
  // never the server's own words under the composer
  await expect(page.getByText('no engine here can draw a person')).toHaveCount(0);
  await nothingMade(page, brand.id);
});
