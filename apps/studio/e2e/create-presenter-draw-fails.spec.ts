import { expect, type Page, test } from '@playwright/test';
import { isolate } from './harness.js';
import { LOGO, picture } from './pictures.js';

/**
 * The engine is there and refuses every picture. A face that could not be
 * drawn is a failure said in the conversation, with a way on, and the
 * photographs it was to be drawn from stay photographs: no upload stands in
 * for the face that did not come back, and nothing is saved.
 */
isolate({ shot: false, env: { SCENRI_DEMO_BUILDS: '1', SCENRI_DEMO_REFS: '5', SCENRI_DEMO_FAIL_SLOT: '0' } });

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

test('a face the engine refused leaves the logo a photo, the stage empty, and nothing saved', async ({ page }) => {
  test.setTimeout(90_000);
  const brand = await currentBrand(page);
  await page.goto(`/${brand.slug}/presenters/new`);
  await answer(page, 'Add photos').click();
  await page.locator('input[type="file"]').setInputFiles(picture('acme-logo.png', LOGO));
  await page.getByRole('checkbox').check();
  await answer(page, 'Continue').click();
  await expect(page).toHaveURL(/\/presenters\/new\/pd-/, { timeout: 40_000 });
  await answer(page, 'Nothing to add').click();

  // the refusal is said, with the way on
  await expect(answer(page, 'Retry')).toBeVisible({ timeout: 30_000 });
  // and nothing took the face's place
  const draftId = new URL(page.url()).pathname.split('/').pop() as string;
  const d = await (await page.request.get(`/api/brands/${brand.id}/presenter-drafts/${draftId}`)).json();
  expect(d.sources).toHaveLength(1);
  expect(d.views.portrait.hash ?? null).toBeNull();
  expect(d.views.portrait.status).toBe('empty');
  expect(d.views.portrait.error).toBeTruthy();
  await expect(page.locator('.sc-pstudio-well img')).toHaveCount(0);
  await expect(answer(page, 'Use this person')).toHaveCount(0);
  await expect(answer(page, 'Save presenter')).toHaveCount(0);
  const brands = await (await page.request.get('/api/brands')).json();
  const theirs = (brands.find((b: any) => b.id === brand.id).json.characters ?? []).filter((c: any) =>
    String(c.id).startsWith('up-'),
  );
  expect(theirs).toEqual([]);
  // the server refuses a save of it too
  const save = await page.request.post(`/api/brands/${brand.id}/presenter-drafts/${draftId}/save`);
  expect(save.status()).toBe(400);
});
