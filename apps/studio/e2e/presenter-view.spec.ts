import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import { isolate } from './harness.js';

/**
 * The presenter page shows the saved record and nothing else: the avatar,
 * the name, the reference set by role, the way into the editor, and a
 * session under way offered back rather than shown as them.
 */
isolate({ env: { SCENRI_DEMO_BUILDS: '1', SCENRI_DEMO_REFS: '5' } });

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

async function settled(req: APIRequestContext, brandId: string, draftId: string, view: string, want: string) {
  for (let i = 0; i < 200; i++) {
    const d = await (await req.get(`/api/brands/${brandId}/presenter-drafts/${draftId}`)).json();
    if (d.views[view].status === want && !d.activeView) return d;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`${view} never became ${want}`);
}

async function seedPresenter(req: APIRequestContext, brandId: string): Promise<string> {
  const base = `/api/brands/${brandId}/presenter-drafts`;
  const draft = await (
    await req.post(base, { data: { source: 'synthetic', direction: 'a woman in her 30s', name: 'Maren' } })
  ).json();
  await req.post(`${base}/${draft.id}/views/portrait/generate`, { data: {} });
  await settled(req, brandId, draft.id, 'portrait', 'candidate');
  await req.post(`${base}/${draft.id}/views/portrait/approve`);
  // The full body is decided by hand like the face; only the views nobody
  // decides may be asked to decide themselves.
  await req.post(`${base}/${draft.id}/views/front/generate`, { data: {} });
  await settled(req, brandId, draft.id, 'front', 'candidate');
  await req.post(`${base}/${draft.id}/views/front/approve`);
  await req.post(`${base}/${draft.id}/views/three-quarter/generate`, { data: { decide: 'auto' } });
  await settled(req, brandId, draft.id, 'three-quarter', 'approved');
  return (await (await req.post(`${base}/${draft.id}/save`)).json()).presenter.id as string;
}

test('the page is the record: tiles by role that open at full size, two actions, and no editor controls', async ({
  page,
}) => {
  const brand = await currentBrand(page);
  const id = await seedPresenter(page.request, brand.id);
  await page.goto(`/${brand.slug}/presenters/${id}`);
  await expect(page.getByRole('heading', { level: 1 }).or(page.getByLabel('Their name'))).toBeVisible();
  await expect(page.locator('.sc-refset li')).toHaveCount(3);
  await expect(page.locator('.sc-refset-lb')).toHaveText(['Face', 'Full body', 'Three-quarter']);
  await expect(page.getByRole('button', { name: 'Use in a shot' }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'Edit presenter' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'What must stay the same' })).toHaveCount(0);
  await expect(page.getByText('Used in shots')).toHaveCount(0);
  await expect(page.locator('.sc-convo-card')).toHaveCount(0);
  await page.getByRole('button', { name: 'Full body, open' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('dialog')).toContainText('Full body');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('a session under way is offered back, never shown as the presenter', async ({ page }) => {
  const brand = await currentBrand(page);
  const id = await seedPresenter(page.request, brand.id);
  await page.goto(`/${brand.slug}/presenters/${id}`);
  await expect(page.getByRole('link', { name: 'Continue editing' })).toHaveCount(0);
  const before = await (await page.request.get('/api/brands')).json();
  const shots = before.find((b: any) => b.id === brand.id).json.characters.find((c: any) => c.id === id).shots;
  // a session with a redrawn view, left open
  const d = await (await page.request.post(`/api/brands/${brand.id}/presenters/${id}/edit`)).json();
  await page.request.post(`/api/brands/${brand.id}/presenter-drafts/${d.id}/views/front/generate`, {
    data: { adjustment: 'to camera' },
  });
  // the full body is decided by hand, so a redraw of it stands as a candidate:
  // an unfinished session, which is what this test is about
  await settled(page.request, brand.id, d.id, 'front', 'candidate');
  await page.reload();
  await expect(page.getByRole('link', { name: 'Continue editing' })).toBeVisible();
  // the page still shows the saved pictures
  const after = await (await page.request.get('/api/brands')).json();
  expect(after.find((b: any) => b.id === brand.id).json.characters.find((c: any) => c.id === id).shots).toEqual(shots);
  const tiles = await page
    .locator('.sc-refset-tile img')
    .evaluateAll((imgs) => imgs.map((i) => (i as HTMLImageElement).src));
  expect(tiles.some((src) => src.includes(shots[1].file.replace('asset:', '')))).toBe(true);
  await page.getByRole('link', { name: 'Continue editing' }).click();
  await expect(page).toHaveURL(new RegExp(`/presenters/${id}/edit$`));
  await expect(page.getByRole('log')).toContainText('to camera');
});
