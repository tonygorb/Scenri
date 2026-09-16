import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import { isolate } from './harness.js';

/**
 * A mutation reaches every surface in the same commit, or it is not done.
 *
 * Owned presenters are read off the brand document that the shell holds, so
 * one `applyBrand` updates the wall, the page, the ingredient picker and the
 * chips together. Every presenter mutation answered with the brand and did
 * that, except delete, which answered `{ok:true}` and left every one of them
 * showing somebody who was gone until a reload.
 *
 * These are the surfaces a person would actually look at next, driven through
 * the UI rather than the API, because the point is what they see.
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

async function seedPresenter(req: APIRequestContext, brandId: string, name: string): Promise<string> {
  const base = `/api/brands/${brandId}/presenter-drafts`;
  const draft = await (
    await req.post(base, { data: { source: 'synthetic', direction: `${name}, a woman in her 30s`, name } })
  ).json();
  await req.post(`${base}/${draft.id}/views/portrait/generate`, { data: {} });
  await settled(req, brandId, draft.id, 'portrait', 'candidate');
  await req.post(`${base}/${draft.id}/views/portrait/approve`);
  await req.post(`${base}/${draft.id}/views/front/generate`, { data: {} });
  await settled(req, brandId, draft.id, 'front', 'candidate');
  await req.post(`${base}/${draft.id}/views/front/approve`);
  await req.post(`${base}/${draft.id}/views/three-quarter/generate`, { data: { decide: 'auto' } });
  await settled(req, brandId, draft.id, 'three-quarter', 'approved');
  return (await (await req.post(`${base}/${draft.id}/save`)).json()).presenter.id as string;
}

test('deleting a presenter takes them off every surface without a reload', async ({ page }) => {
  test.setTimeout(90_000);
  const brand = await currentBrand(page);
  const id = await seedPresenter(page.request, brand.id, 'Vanish');
  await seedPresenter(page.request, brand.id, 'Stays');

  // the wall has both, and so does the picker the composer offers
  await page.goto(`/${brand.slug}/presenters`);
  await expect(page.getByText('Vanish', { exact: true })).toBeVisible();
  await expect(page.getByText('Stays', { exact: true })).toBeVisible();

  // delete from their own page, which is the only place that offers it
  await page.goto(`/${brand.slug}/presenters/${id}`);
  await page.getByRole('button', { name: 'Delete presenter' }).click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: /Delete/ })
    .click();

  // the wall it lands on is drawn from the brand, so the card is already gone.
  // No reload anywhere in this test: that is the whole assertion.
  await expect(page).toHaveURL(new RegExp(`/${brand.slug}/presenters$`));
  await expect(page.getByText('Vanish', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Stays', { exact: true })).toBeVisible();

  // and the record really is gone, not merely hidden
  const brands = (await (await page.request.get('/api/brands')).json()) as any[];
  const cast = brands.find((b) => b.id === brand.id).json.characters ?? [];
  expect(cast.map((c: any) => c.name)).not.toContain('Vanish');
  expect(cast.map((c: any) => c.name)).toContain('Stays');
});

test('a deleted presenter is gone from the Create picker too, in the same commit', async ({ page }) => {
  test.setTimeout(90_000);
  const brand = await currentBrand(page);
  const id = await seedPresenter(page.request, brand.id, 'Picker');

  await page.goto(`/${brand.slug}/presenters/${id}`);
  await page.getByRole('button', { name: 'Delete presenter' }).click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: /Delete/ })
    .click();
  await expect(page).toHaveURL(new RegExp(`/${brand.slug}/presenters$`));

  // Through the app's own nav rather than `goto`: a fresh document load
  // refetches the brand and would pass whatever delete answered, which is
  // exactly the reload this is meant to prove unnecessary.
  await page.getByRole('link', { name: 'Create', exact: true }).click();
  await expect(page).toHaveURL(/\/create/);

  // and the list is actually opened, because an assertion against a picker
  // nobody reached passes whatever the picker holds
  await page.locator('.sc-brief').click();
  await page.keyboard.type('with @');
  await expect(page.locator('.sc-cmd-group')).toHaveText(/^Presenters\s+\d+$/);
  await expect(page.locator('.sc-cmd-row', { hasText: 'Picker' })).toHaveCount(0);
  await expect(page.locator('.sc-cmd-row').first()).toBeVisible();
});

test('deleting a presenter ends the editing session that was open on them', async ({ page }) => {
  test.setTimeout(90_000);
  const brand = await currentBrand(page);
  const id = await seedPresenter(page.request, brand.id, 'Session');

  // open the editor, which mints a session draft carrying their id
  await page.goto(`/${brand.slug}/presenters/${id}/edit`);
  await expect(page.getByRole('log')).toContainText('What would you like to change', { timeout: 30_000 });
  const before = (await (await page.request.get(`/api/brands/${brand.id}/presenter-drafts`)).json()) as {
    drafts: { id: string; presenterId?: string }[];
  };
  expect(before.drafts.filter((d) => d.presenterId === id)).toHaveLength(1);

  await page.goto(`/${brand.slug}/presenters/${id}`);
  await page.getByRole('button', { name: 'Delete presenter' }).click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: /Delete/ })
    .click();
  await expect(page).toHaveURL(new RegExp(`/${brand.slug}/presenters$`));

  // the session goes with them rather than drawing on into an orphan and
  // sitting there until the fourteen-day sweep
  const after = (await (await page.request.get(`/api/brands/${brand.id}/presenter-drafts`)).json()) as {
    drafts: { id: string; presenterId?: string }[];
  };
  expect(after.drafts.filter((d) => d.presenterId === id)).toHaveLength(0);
});

/**
 * The wall is the studio's parent route, so it stays mounted underneath and
 * its draft list is whatever it was fetched before. With the brand pointer
 * gone the wall is the only way back to a draft, so a list that predates the
 * draft you just started reads as the work having been thrown away.
 */
test('duplicating from the card appears on the wall and in the picker without a reload', async ({ page }) => {
  test.setTimeout(90_000);
  const brand = await currentBrand(page);
  await seedPresenter(page.request, brand.id, 'Maya');

  await page.goto(`/${brand.slug}/presenters`);
  await expect(page.locator('.sc-owned .sc-lookcard', { hasText: 'Maya' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'More for Maya' })).toBeAttached();

  await page.locator('.sc-owned .sc-lookcard', { hasText: 'Maya' }).click({ button: 'right' });
  const menu = page.getByRole('menu');
  await expect(menu.getByRole('menuitem', { name: 'Duplicate presenter' })).toBeVisible();
  await expect(menu.getByRole('menuitem').last()).toHaveText('Delete presenter');
  await menu.getByRole('menuitem', { name: 'Duplicate presenter' }).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Duplicate presenter' })).toBeVisible();
  await expect(dialog.locator('.sc-pdetails-field')).toHaveValue('Maya copy');
  await dialog.getByRole('button', { name: 'Duplicate', exact: true }).dblclick();
  await expect(page.locator('.sc-owned .sc-lookcard b', { hasText: /^Maya copy$/ })).toBeVisible();
  await expect(page.locator('.sc-owned .sc-lookcard b', { hasText: /^Maya$/ })).toBeVisible();
  await expect(page.locator('.sc-toast').filter({ hasText: 'Duplicated' })).toContainText('Maya copy');
  await expect(
    page.locator('.sc-owned .sc-lookcard', { has: page.locator('b', { hasText: /^Maya copy$/ }) }),
  ).toHaveAttribute('data-just-added', 'true');
  await expect(
    page.locator('.sc-owned .sc-lookcard', { has: page.locator('b', { hasText: /^Maya$/ }) }),
  ).not.toHaveAttribute('data-just-added');

  const cast = ((await (await page.request.get('/api/brands')).json()) as any[]).find((b) => b.id === brand.id).json
    .characters as { name: string }[];
  expect(cast.filter((c) => c.name === 'Maya copy')).toHaveLength(1);

  await page.getByRole('link', { name: 'Create', exact: true }).click();
  await expect(page).toHaveURL(/\/create/);
  await page.locator('.sc-brief').click();
  await page.keyboard.type('with @');
  await expect(page.getByRole('option', { name: 'Maya copy', exact: true })).toBeVisible();
  await expect(page.getByRole('option', { name: 'Maya', exact: true })).toBeVisible();
});

test('deleting from the card takes them off the wall and the picker without a reload', async ({ page }) => {
  test.setTimeout(90_000);
  const brand = await currentBrand(page);
  await seedPresenter(page.request, brand.id, 'CardGo');
  await seedPresenter(page.request, brand.id, 'CardStay');

  await page.goto(`/${brand.slug}/presenters`);
  await page.locator('.sc-owned .sc-lookcard', { hasText: 'CardGo' }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Delete presenter' }).click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: /Delete/ })
    .click();

  await expect(page.locator('.sc-owned .sc-lookcard b', { hasText: /^CardGo$/ })).toHaveCount(0);
  await expect(page.locator('.sc-owned .sc-lookcard b', { hasText: /^CardStay$/ })).toBeVisible();

  await page.getByRole('link', { name: 'Create', exact: true }).click();
  await expect(page).toHaveURL(/\/create/);
  await page.locator('.sc-brief').click();
  await page.keyboard.type('with @');
  await expect(page.getByRole('option', { name: 'CardGo', exact: true })).toHaveCount(0);
  await expect(page.getByRole('option', { name: 'CardStay', exact: true })).toBeVisible();
});

test('the wall reads its drafts again when the studio closes over it', async ({ page }) => {
  test.setTimeout(90_000);
  const brand = await currentBrand(page);
  await page.goto(`/${brand.slug}/presenters`);
  await expect(page.getByRole('link', { name: /^Continue / })).toHaveCount(0);

  // open the studio over the wall, then mint a draft behind it, which is what
  // answering through to a face does
  await page.getByRole('button', { name: 'Create presenter' }).click();
  await expect(page).toHaveURL(new RegExp(`/${brand.slug}/presenters/new$`));
  await page.request.post(`/api/brands/${brand.id}/presenter-drafts`, {
    data: { source: 'synthetic', direction: 'a woman in her 30s', name: 'Behind' },
  });

  // close it: no document load, so the wall can only be right if it read again
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(new RegExp(`/${brand.slug}/presenters$`));
  await expect(page.getByRole('link', { name: /^Continue / })).toHaveCount(1);
});
