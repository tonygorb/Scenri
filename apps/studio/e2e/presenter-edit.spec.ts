import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import { isolate } from './harness.js';

/**
 * A saved presenter stays editable: the editor is the studio surface over
 * the presenter's page, on a session seeded from the record. A view is
 * repaired, the person is changed and the views built on the face follow,
 * Save changes writes a revision, Discard leaves the record, a sentence
 * that belongs to Create is said so, and an old shot keeps refining against
 * the person it was made with while a new one carries them as they are.
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

const log = (p: Page) => p.getByRole('log');
const composer = (p: Page) => p.locator('.sc-convo-card textarea');
const send = async (p: Page, text: string) => {
  await composer(p).fill(text);
  await composer(p).press('Enter');
};
const answer = (p: Page, label: string) => log(p).getByRole('button', { name: label, exact: true });

async function settled(req: APIRequestContext, brandId: string, draftId: string, view: string, want: string) {
  for (let i = 0; i < 200; i++) {
    const d = await (await req.get(`/api/brands/${brandId}/presenter-drafts/${draftId}`)).json();
    if (d.views[view].status === want && !d.activeView) return d;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`${view} never became ${want}`);
}

/** A saved three-view presenter, made through the API the way the studio makes one. */
async function seedPresenter(
  req: APIRequestContext,
  brandId: string,
  name = 'Maren',
): Promise<{ id: string; shots: string[] }> {
  const base = `/api/brands/${brandId}/presenter-drafts`;
  const draft = await (
    await req.post(base, { data: { source: 'synthetic', direction: 'a woman in her 30s', name } })
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
  const r = await (await req.post(`${base}/${draft.id}/save`)).json();
  return { id: r.presenter.id as string, shots: (r.presenter.shots as { file: string }[]).map((s) => s.file) };
}

const recordOf = async (req: APIRequestContext, brandId: string, id: string) => {
  const brands = await (await req.get('/api/brands')).json();
  return (brands.find((b: any) => b.id === brandId).json.characters ?? []).find((c: any) => c.id === id);
};

/** The list is card summaries; the whole row is asked for by id. */
async function draftRow(page: Page, brandId: string, n = 0) {
  const list = await (await page.request.get(`/api/brands/${brandId}/presenter-drafts`)).json();
  const id = list.drafts[n].id;
  return { list, row: await (await page.request.get(`/api/brands/${brandId}/presenter-drafts/${id}`)).json() };
}

test('the editor opens on the record, repairs one view, and Save changes writes a revision the old shots do not follow', async ({
  page,
}) => {
  test.setTimeout(60_000);
  const brand = await currentBrand(page);
  const person = await seedPresenter(page.request, brand.id);

  // a shot made with the person as they are now
  const preview = async (id: string) =>
    (
      await (
        await page.request.post('/api/brief/preview', {
          data: {
            brief: {
              tokens: [
                { t: 'character', id },
                { t: 'text', v: 'a portrait' },
              ],
            },
            engineId: 'demo',
            brandId: brand.id,
          },
        })
      ).json()
    ).attachments.map((a: any) => a.hash);
  const before = await preview(person.id);
  expect(before).toHaveLength(3);

  await page.goto(`/${brand.slug}/presenters/${person.id}`);
  await page.getByRole('link', { name: 'Edit presenter' }).click();
  await expect(page).toHaveURL(new RegExp(`/presenters/${person.id}/edit$`));
  await expect(log(page)).toContainText('What would you like to change about Maren?');
  await expect(page.locator('.sc-pstudio-slot')).toHaveCount(3);
  // opening spends nothing
  const { list, row } = await draftRow(page, brand.id);
  expect(list.drafts).toHaveLength(1);
  expect(list.drafts[0].presenterId).toBe(person.id);
  expect(row.generations).toBe(0);

  await page.locator('.sc-pstudio-slot[data-view="three-quarter"]').click();
  await expect(page.locator('.sc-convo-scope')).toHaveCount(0);
  await send(page, 'It does not look like her here');
  await expect(page.locator('.sc-pstudio-offer')).toContainText('Redrew the three-quarter view.', { timeout: 20_000 });
  await expect(log(page)).toContainText('Save changes when you are done.');
  // the record has not moved
  expect((await recordOf(page.request, brand.id, person.id)).shots.map((s: any) => s.file)).toEqual(person.shots);

  await answer(page, 'Save changes').click();
  await expect(page).toHaveURL(/\/presenters\/up-[a-f0-9]+$/, { timeout: 20_000 });
  const headId = page.url().split('/').pop() as string;
  expect(headId).not.toBe(person.id);
  const old = await recordOf(page.request, brand.id, person.id);
  const head = await recordOf(page.request, brand.id, headId);
  expect(old.supersededBy).toBe(headId);
  expect(head.revisionOf).toBe(person.id);
  expect(head.shots[2].file).not.toBe(old.shots[2].file);
  expect(head.shots[0].file).toBe(old.shots[0].file);
  // an old shot refines against the person it was made with; a new one gets them as they are
  expect(await preview(person.id)).toEqual(before);
  expect(await preview(headId)).not.toEqual(before);
  // the old address lands on the current one
  await page.goto(`/${brand.slug}/presenters/${person.id}`);
  await expect(page).toHaveURL(new RegExp(`/presenters/${headId}$`));
});

test('a change to the person is decided first, then the views built on the face follow', async ({ page }) => {
  test.setTimeout(60_000);
  const brand = await currentBrand(page);
  const person = await seedPresenter(page.request, brand.id, 'Idan');
  await page.goto(`/${brand.slug}/presenters/${person.id}/edit`);
  await expect(log(page)).toContainText('What would you like to change about Idan?');
  await send(page, 'Make his hair shorter');
  await expect(log(page)).toContainText('Here is Idan with the change', { timeout: 20_000 });
  await expect(page.locator('.sc-pstudio-compare')).toBeVisible();
  await page.locator('.sc-pstudio-compare').click();
  await expect(page.locator('.sc-pstudio-compare')).toHaveAttribute('aria-pressed', 'true');
  await answer(page, 'Use this').click();
  // the full body is rebuilt from the new face and is decided by hand too. It
  // had a picture of its own before the change, so that one is offered back.
  await expect(log(page)).toContainText('Redrew the full body.', { timeout: 30_000 });
  await answer(page, 'Use it').click();
  await expect(log(page)).toContainText('Save changes when you are done.', { timeout: 30_000 });
  await expect(log(page)).toContainText('Make his hair shorter');
  await expect(log(page)).toContainText('Changed Idan.');
  const { row: d } = await draftRow(page, brand.id);
  expect(d.identityEdits).toEqual(['Make his hair shorter']);
  expect(d.views.front.conditionedOn).toContain(d.views.portrait.hash);
  expect(d.views['three-quarter'].status).toBe('approved');
  await answer(page, 'Save changes').click();
  await expect(page).toHaveURL(/\/presenters\/up-[a-f0-9]+$/, { timeout: 20_000 });
  const headId = page.url().split('/').pop() as string;
  const head = await recordOf(page.request, brand.id, headId);
  expect(head.identityEdits).toEqual(['Make his hair shorter']);
  expect(head.avatar).not.toBe((await recordOf(page.request, brand.id, person.id)).avatar);
});

test('Discard leaves the record as it was, and a sentence for Create generates nothing', async ({ page }) => {
  const brand = await currentBrand(page);
  const person = await seedPresenter(page.request, brand.id);
  await page.goto(`/${brand.slug}/presenters/${person.id}/edit`);
  await expect(log(page)).toContainText('What would you like to change');
  let calls = 0;
  page.on('request', (r) => {
    if (r.url().includes('/views/') && r.method() === 'POST') calls++;
  });
  await send(page, 'Put Maren in a red dress in Paris holding my perfume');
  await expect(log(page)).toContainText('Use Create for wardrobe, products and scenes.');
  await page.waitForTimeout(600);
  expect(calls).toBe(0);
  // with a body view on the stage, a sentence about the face reads both ways
  await page.locator('.sc-pstudio-slot[data-view="front"]').click();
  await send(page, 'her face looks wrong with the shorter hair');
  await expect(log(page)).toContainText('Apply this to:');
  await answer(page, 'The presenter').click();
  await expect(log(page)).toContainText('with the change', { timeout: 20_000 });
  await answer(page, 'Use this').click();
  // the full body is rebuilt from the new face and is decided by hand too
  await expect(log(page)).toContainText('Redrew the full body.', { timeout: 30_000 });
  await answer(page, 'Use it').click();
  await expect(log(page)).toContainText('Save changes when you are done.', { timeout: 30_000 });
  await page.getByRole('button', { name: 'Discard changes', exact: true }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Discard changes', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/presenters/${person.id}$`));
  expect((await recordOf(page.request, brand.id, person.id)).shots.map((s: any) => s.file)).toEqual(person.shots);
  expect((await (await page.request.get(`/api/brands/${brand.id}/presenter-drafts`)).json()).drafts).toHaveLength(0);
});

test('a refresh mid-edit resumes the session, and a save after the record moved elsewhere is refused', async ({
  page,
  browser,
}) => {
  test.setTimeout(60_000);
  const brand = await currentBrand(page);
  const person = await seedPresenter(page.request, brand.id, 'Noa');
  await page.goto(`/${brand.slug}/presenters/${person.id}/edit`);
  await page.locator('.sc-pstudio-slot[data-view="front"]').click();
  await send(page, 'turn slightly more to camera');
  await expect(log(page)).toContainText('Redrew the full body. Use it, or keep the previous one.', {
    timeout: 20_000,
  });
  await page.reload();
  // the decision survives the reload: the session resumes where it paused
  await expect(log(page)).toContainText('Redrew the full body.', { timeout: 20_000 });
  await expect(log(page)).toContainText('turn slightly more to camera');
  await answer(page, 'Use it').click();
  await expect(log(page)).toContainText('Save changes when you are done.', { timeout: 20_000 });

  // elsewhere, the same person is renamed and saved in place
  const other = await browser.newContext({ baseURL: page.url().split('/').slice(0, 3).join('/') });
  const r = await other.request.patch(`/api/brands/${brand.id}/presenters/${person.id}`, { data: { name: 'Noa B' } });
  expect(r.ok()).toBe(true);
  // a rename patches in place, so the head is the same record and the session still saves
  await answer(page, 'Save changes').click();
  await expect(page).toHaveURL(/\/presenters\/up-[a-f0-9]+$/, { timeout: 20_000 });
  await other.close();
});

test('a legacy one-photo presenter opens, is offered its missing views, and saves as it was when declined', async ({
  page,
}) => {
  const brand = await currentBrand(page);
  const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );
  const up = await page.request.post('/api/images', {
    multipart: { file: { name: 'k.png', mimeType: 'image/png', buffer: PNG } },
  });
  const { hash } = await up.json();
  const made = await (
    await page.request.post(`/api/brands/${brand.id}/presenters`, {
      data: { name: 'Kwame', shotHashes: [hash], sourceHashes: [hash] },
    })
  ).json();
  await page.goto(`/${brand.slug}/presenters/${made.presenter.id}`);
  await expect(page.locator('.sc-refset li')).toHaveCount(1);
  await page.getByRole('link', { name: 'Edit presenter' }).click();
  await expect(log(page)).toContainText('Kwame has one reference. Build the full body and three-quarter view from it?');
  await answer(page, 'Not now').click();
  await expect(log(page)).not.toContainText('Build the full body');
  await expect(page.locator('.sc-pstudio-slot')).toHaveCount(3);
  // nothing was drawn by opening or declining
  const { row } = await draftRow(page, brand.id);
  expect(row.generations).toBe(0);
});
