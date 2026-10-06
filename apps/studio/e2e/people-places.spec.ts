import { test, expect, type Page } from '@playwright/test';
import { isolate } from './harness.js';
import { brandJson, currentBrand, mainNav, seedScene, uploadPng } from './realtime.js';

/**
 * Presenters became People and Scenes became Places (0.22). The words moved;
 * nothing a Brand stores did. This file proves both halves against a brand
 * written the way 0.21 writes one: a person kept under `characters[]`, a place
 * under `scenes[]`, a shot whose brief names them with the `character` and
 * `template` tokens, a refinement of it, a set, a keeper, and the bookmarks
 * under their historical keys. The old words in this file are the point: they
 * are the addresses and keys a user of 0.21 still holds.
 */
isolate();

const postJson = (data: unknown) => ({ data });

interface Legacy {
  slug: string;
  id: string;
  personId: string;
  placeId: string;
  curatedPersonId: string;
  shotId: string;
  refineId: string;
  setSlug: string;
}

let legacy: Legacy | null = null;

async function waitDone(p: Page, id: string): Promise<{ id: string; images: string[]; brief?: any }> {
  let n: any = null;
  await expect
    .poll(
      async () => {
        n = await (await p.request.get(`/api/nodes/${id}`)).json();
        return n?.status;
      },
      { timeout: 60_000 },
    )
    .toBe('done');
  return n;
}

/** The brand 0.21 left behind, made once and shared by every test below. */
async function legacyBrand(p: Page): Promise<Legacy> {
  if (legacy) return legacy;
  const brand = await currentBrand(p);
  const hashes = [await uploadPng(p.request, 0), await uploadPng(p.request, 1)];
  const made = await (
    await p.request.post(`/api/brands/${brand.id}/presenters`, postJson({ name: 'Legacy Lena', shotHashes: hashes }))
  ).json();
  const personId = made.presenter.id as string;
  const placeId = await seedScene(p.request, brand.id, 'Legacy Loft');
  const curated = ((await (await p.request.get('/api/presenters')).json()).presenters ?? [])[0];

  const ws = await (await p.request.get(`/api/brands/${brand.id}/workspace`)).json();
  const shot = await (
    await p.request.post(
      '/api/nodes',
      postJson({
        projectId: ws.project.id,
        parentId: ws.root ?? null,
        kind: 'generation',
        prompt: 'legacy brief',
        engineId: 'demo',
        count: 1,
        brief: {
          prose: 'legacy brief',
          tokens: [
            { t: 'character', id: personId },
            { t: 'template', id: placeId },
          ],
        },
      }),
    )
  ).json();
  const done = await waitDone(p, shot.id);
  const refine = await (
    await p.request.post(
      '/api/nodes',
      postJson({
        projectId: ws.project.id,
        parentId: done.id,
        kind: 'edit',
        prompt: 'warmer light',
        engineId: 'demo',
        sourceImage: done.images[0],
        // what the composer sends for a refine: its own words, nothing re-attached
        brief: { prose: 'warmer light', tokens: [] },
      }),
    )
  ).json();
  await waitDone(p, refine.id);
  await p.request.post(`/api/nodes/${done.id}/keep`, postJson({ kept: true }));
  const set = await (await p.request.post(`/api/brands/${brand.id}/sets`, postJson({ name: 'Legacy set' }))).json();
  await p.request.post(`/api/sets/${set.id}/nodes`, postJson({ nodeIds: [done.id] }));

  legacy = {
    ...brand,
    personId,
    placeId,
    curatedPersonId: curated.id,
    shotId: done.id,
    refineId: refine.id,
    setSlug: set.slug,
  };
  return legacy;
}

/** Bookmarks live in the browser, under the keys 0.21 wrote. */
async function legacyBookmarks(p: Page, l: Legacy): Promise<void> {
  await p.evaluate(
    ({ id, person }) => {
      localStorage.setItem(`sc-favpresenters-${id}`, JSON.stringify([person]));
    },
    { id: l.id, person: l.curatedPersonId },
  );
}

test('the bar says People and Places, and each lands on its own address', async ({ page }) => {
  const l = await legacyBrand(page);
  await page.goto(`/${l.slug}`);
  const nav = mainNav(page);
  await expect(nav.getByRole('link', { name: 'People', exact: true })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Places', exact: true })).toBeVisible();
  await expect(nav.getByText(/Presenters|Scenes/)).toHaveCount(0);

  await nav.getByRole('link', { name: 'People', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/${l.slug}/people$`));
  await expect(page).toHaveTitle(/^People/);
  await nav.getByRole('link', { name: 'Places', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/${l.slug}/places$`));
  await expect(page).toHaveTitle(/^Places/);
});

test('every address 0.21 could spell lands on its People or Places page', async ({ page }) => {
  const l = await legacyBrand(page);
  const cases: [string, string][] = [
    [`/${l.slug}/presenters`, `/${l.slug}/people`],
    [`/${l.slug}/presenters/new`, `/${l.slug}/people/new`],
    [`/${l.slug}/presenters/${l.personId}`, `/${l.slug}/people/${l.personId}`],
    [`/${l.slug}/presenters/${l.personId}/edit`, `/${l.slug}/people/${l.personId}/edit`],
    [`/${l.slug}/scenes`, `/${l.slug}/places`],
    [`/${l.slug}/scenes/new`, `/${l.slug}/places/new`],
    [`/${l.slug}/scenes/${l.placeId}`, `/${l.slug}/places/${l.placeId}`],
    [`/b/${l.slug}/scenes`, `/${l.slug}/places`],
    [`/b/${l.slug}/presenters`, `/${l.slug}/people`],
  ];
  for (const [from, to] of cases) {
    await page.goto(from);
    await expect(page, `${from} lands`).toHaveURL(new RegExp(`${to.replace(/[/]/g, '\\/')}$`));
  }

  // the query and hash travel with it
  await page.goto(`/${l.slug}/scenes?attach=1#top`);
  await expect(page).toHaveURL(new RegExp(`/${l.slug}/places\\?attach=1#top$`));

  // the old address is replaced, not stacked: Back leaves, it does not bounce
  await page.goto(`/${l.slug}/products`);
  await page.goto(`/${l.slug}/presenters/${l.personId}`);
  await expect(page).toHaveURL(new RegExp(`/people/${l.personId}$`));
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Legacy Lena');
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`/${l.slug}/products$`));
  await page.goForward();
  await expect(page).toHaveURL(new RegExp(`/people/${l.personId}$`));
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Legacy Lena');
});

test('?new= opens the studio by its new name and by its old one', async ({ page }) => {
  const l = await legacyBrand(page);
  for (const [value, to] of [
    ['person', 'people'],
    ['presenter', 'people'],
    ['place', 'places'],
    ['scene', 'places'],
  ]) {
    await page.goto(`/${l.slug}/create?new=${value}`);
    await expect(page, `?new=${value}`).toHaveURL(new RegExp(`/${l.slug}/${to}/new`));
  }
});

test('a link that applies a person or a place works by either name', async ({ page }) => {
  const l = await legacyBrand(page);
  const line = page.locator('.sc-brief-line');
  for (const q of [`person=${l.personId}`, `presenter=${l.personId}`]) {
    await page.goto(`/${l.slug}/create?fresh=1&${q}`);
    await expect(line.locator('[aria-label^="person: Legacy Lena"]'), q).toBeVisible();
  }
  for (const q of [`place=${l.placeId}`, `scene=${l.placeId}`]) {
    await page.goto(`/${l.slug}/create?fresh=1&${q}`);
    await expect(line.locator('[aria-label^="place: Legacy Loft"]'), q).toBeVisible();
  }
});

test('the 0.21 brand opens whole: its people, places, shots, set, keeper and bookmarks', async ({ page }) => {
  const l = await legacyBrand(page);
  const before = await brandJson(page.request, l.id);
  await page.goto(`/${l.slug}`);
  await legacyBookmarks(page, l);

  // People: the owned person, with its pictures, and the bookmarked curated one
  await page.goto(`/${l.slug}/people`);
  await expect(page.getByRole('heading', { name: 'People', level: 1 })).toBeVisible();
  await expect(page.getByText('Legacy Lena', { exact: true }).first()).toBeVisible();
  await page.goto(`/${l.slug}/people/${l.personId}`);
  await expect(page.locator('.sc-refset li')).toHaveCount(2);
  // an earlier test opened the editor at its old address, which left a draft
  await expect(page.getByRole('link', { name: /^(Edit person|Continue editing)$/ })).toBeVisible();

  // Places: the owned place
  await page.goto(`/${l.slug}/places`);
  await expect(page.getByRole('heading', { name: 'Places', level: 1 })).toBeVisible();
  await expect(page.getByText('Legacy Loft', { exact: true }).first()).toBeVisible();
  await page.goto(`/${l.slug}/places/${l.placeId}`);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Legacy Loft');

  // The old shot names them both, and opens the pages by their new addresses
  await page.goto(`/${l.slug}/create/shots/${l.shotId}`);
  await expect(page.locator('.sc-ovl')).toBeVisible();
  await expect(page.locator('.sc-ingredient[data-kind="presenter"]')).toContainText('Legacy Lena');
  await expect(page.locator('.sc-ingredient[data-kind="scene"]')).toContainText('Legacy Loft');

  // its refinement is still its child, and still carries the person
  const refine = await (await page.request.get(`/api/nodes/${l.refineId}`)).json();
  expect(refine.parentId).toBe(l.shotId);
  const carried = [...(refine.brief?.tokens ?? []), ...(refine.brief?.inherited ?? [])];
  expect(carried.some((t: any) => t.t === 'character' && t.id === l.personId)).toBe(true);

  // keeper and set
  const shot = await (await page.request.get(`/api/nodes/${l.shotId}`)).json();
  expect(shot.kept).toBeTruthy();
  await page.goto(`/${l.slug}/sets/${l.setSlug}/shots/${l.shotId}`);
  await expect(page.locator('.sc-ovl')).toBeVisible();

  // the bookmark written under the old key still reads
  const marks = await page.evaluate((id) => localStorage.getItem(`sc-favpresenters-${id}`), l.id);
  expect(JSON.parse(marks ?? '[]')).toEqual([l.curatedPersonId]);

  // nothing above wrote to the brand
  expect(await brandJson(page.request, l.id)).toEqual(before);
});

test('saving a person again keeps every field the brand held', async ({ page }) => {
  const l = await legacyBrand(page);
  const before = await brandJson(page.request, l.id);
  const res = await page.request.patch(`/api/brands/${l.id}/presenters/${l.personId}`, postJson({ name: 'Lena' }));
  expect(res.ok()).toBe(true);
  const after = await brandJson(page.request, l.id);
  const strip = (j: any) => ({
    ...j,
    characters: (j.characters ?? []).map((c: any) => (c.id === l.personId ? { ...c, name: 'X' } : c)),
  });
  expect(strip(after)).toEqual(strip(before));
  expect(after.scenes).toEqual(before.scenes);
  await page.request.patch(`/api/brands/${l.id}/presenters/${l.personId}`, postJson({ name: 'Legacy Lena' }));
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('the tab bar says People and Places and fits', async ({ page }) => {
    const l = await legacyBrand(page);
    await page.goto(`/${l.slug}`);
    const bar = page.locator('.sc-tabbar');
    await expect(bar.getByRole('link', { name: 'People' })).toBeVisible();
    await expect(bar.getByRole('link', { name: 'Places' })).toBeVisible();
    const fits = await bar.evaluate((el) => el.scrollWidth <= el.clientWidth);
    expect(fits).toBe(true);
    await bar.getByRole('link', { name: 'Places' }).click();
    await expect(page).toHaveURL(new RegExp(`/${l.slug}/places$`));
  });
});
