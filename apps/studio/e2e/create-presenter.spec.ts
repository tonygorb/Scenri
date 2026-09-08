import { test, expect, type Page } from '@playwright/test';
import { isolate } from './harness.js';

/**
 * The presenter studio, end to end, in the create dialog.
 *
 * A person is cast one used view at a time: from a sentence or from
 * photographs, the face first, then the full body and the three-quarter
 * view, each drawn from the views used before it, then named and saved. A
 * sentence in the composer changes the person (the face is redrawn and the
 * other views follow) or one view alone. The harness runs the demo engine
 * (SCENRI_DEMO_BUILDS) with five reference slots (SCENRI_DEMO_REFS), so every
 * step draws a placeholder instantly, and conditioning is proven through
 * `conditionedOn` on the draft. SCENRI_NO_CODEX keeps the analyzer off, so
 * the photos path files the first photo as the face.
 */
isolate({ env: { SCENRI_DEMO_BUILDS: '1', SCENRI_DEMO_REFS: '5' } });

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

const dialog = (p: Page) => p.locator('.sc-newdlg');
const status = (p: Page) => p.locator('.sc-pstudio-status');
const composer = (p: Page) => p.getByLabel('What should change');
const draftsOf = async (p: Page, brandId: string) =>
  (await (await p.request.get(`/api/brands/${brandId}/presenter-drafts`)).json()) as { drafts: { id: string }[] };
const draftOf = async (p: Page, brandId: string, draftId: string) =>
  (await p.request.get(`/api/brands/${brandId}/presenter-drafts/${draftId}`)).json();

async function waitDraft(p: Page, brandId: string): Promise<string> {
  for (let i = 0; i < 80; i++) {
    const { drafts } = await draftsOf(p, brandId);
    if (drafts[0]) return drafts[0].id;
    await p.waitForTimeout(50);
  }
  throw new Error('draft never appeared');
}

type View = 'portrait' | 'front' | 'three-quarter';

async function settledView(p: Page, brandId: string, draftId: string, view: View, want: string) {
  for (let i = 0; i < 200; i++) {
    const d = await draftOf(p, brandId, draftId);
    if (d.views[view].status === want && !d.activeView) return d;
    await p.waitForTimeout(50);
  }
  throw new Error(`${view} never became ${want}`);
}

/** A draft built through the API, up to a point, so a test can start there. */
async function seedDraft(
  p: Page,
  brandId: string,
  upTo: 'portrait-candidate' | 'portrait-approved' | 'all-approved',
): Promise<string> {
  const base = `/api/brands/${brandId}/presenter-drafts`;
  const draft = await (
    await p.request.post(base, { data: { source: 'synthetic', direction: 'a man in his 30s' } })
  ).json();
  const build = async (view: View) => {
    await p.request.post(`${base}/${draft.id}/views/${view}/generate`, { data: {} });
    await settledView(p, brandId, draft.id, view, 'candidate');
    await p.request.post(`${base}/${draft.id}/views/${view}/approve`);
  };
  await p.request.post(`${base}/${draft.id}/views/portrait/generate`, { data: {} });
  await settledView(p, brandId, draft.id, 'portrait', 'candidate');
  if (upTo === 'portrait-candidate') return draft.id as string;
  await p.request.post(`${base}/${draft.id}/views/portrait/approve`);
  if (upTo === 'portrait-approved') return draft.id as string;
  await build('front');
  await build('three-quarter');
  return draft.id as string;
}

async function openDraft(p: Page, brand: { slug: string; id: string }, draftId: string) {
  await p.goto(`/${brand.slug}/presenters`);
  await p.evaluate(({ id, brandId }) => sessionStorage.setItem(`scenri:presenter-draft:${brandId}`, id), {
    id: draftId,
    brandId: brand.id,
  });
  await p.goto(`/${brand.slug}/presenters?new=presenter`);
}

/** Use each view as it lands on the stage, in build order. */
async function useViews(p: Page, labels: string[]) {
  const use = p.getByRole('button', { name: 'Use', exact: true });
  for (const label of labels) {
    await expect(status(p)).toContainText(label, { timeout: 20_000 });
    await expect(use).toBeVisible({ timeout: 20_000 });
    await use.click();
  }
}

test.describe('a person from scratch', () => {
  test('a sentence, the face, Use, the build, a name, a save: one person in the library', async ({ page }) => {
    test.setTimeout(90_000);
    const brand = await currentBrand(page);

    await page.goto(`/${brand.slug}/presenters`);
    await page.getByRole('button', { name: 'Create presenter' }).first().click();
    await expect(page).toHaveURL(new RegExp(`/${brand.slug}/presenters\\?new=presenter$`));
    await expect(dialog(page)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'New presenter' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'From scratch' })).toHaveAttribute('aria-selected', 'true');

    const create = page.getByRole('button', { name: 'Create person' });
    await expect(create).toHaveAttribute('aria-disabled', 'true');
    await page.getByLabel('Describe the person').fill('confident woman in her 40s, short silver hair');
    await expect(create).not.toHaveAttribute('aria-disabled', /.*/);
    await create.click();

    const usePerson = page.getByRole('button', { name: 'Use this person' });
    await expect(usePerson).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('.sc-pstudio-well img')).toBeVisible();
    await expect(status(page)).toContainText('Is this the person?');
    const draftId = await waitDraft(page, brand.id);
    let d = await draftOf(page, brand.id, draftId);
    expect(d.views.portrait.status).toBe('candidate');
    expect(d.views.portrait.conditionedOn).toEqual([]);
    const portrait = d.views.portrait.hash as string;

    // the face is used, and the full body is drawn from it with no click
    await usePerson.click();
    await expect(page.getByRole('button', { name: 'Use', exact: true })).toBeVisible({ timeout: 20_000 });
    d = await draftOf(page, brand.id, draftId);
    expect(d.views.portrait.status).toBe('approved');
    expect(d.views.front.status).toBe('candidate');
    expect(d.views.front.conditionedOn).toEqual([portrait]);
    const front = d.views.front.hash as string;

    await useViews(page, ['Full body', 'Three-quarter']);
    d = await draftOf(page, brand.id, draftId);
    expect(d.views['three-quarter'].conditionedOn).toEqual([portrait, front]);
    await expect(page.locator('.sc-pstudio-slot[data-state="approved"]')).toHaveCount(2);
    await expect(page.locator('.sc-pstudio-slot[data-state="current"]')).toHaveCount(1);

    // the name comes last, with the person in front of you
    const name = page.getByLabel('Name', { exact: true });
    await expect(name).toBeVisible({ timeout: 20_000 });
    await expect(status(page)).toContainText('one person');
    const save = page.getByRole('button', { name: 'Save presenter' });
    await expect(save).toHaveAttribute('aria-disabled', 'true');
    await expect(save).toHaveAttribute('title', /name/i);
    await name.fill('Ofira');
    await expect(save).not.toHaveAttribute('aria-disabled', /.*/);
    await save.click();

    await expect(dialog(page)).toHaveCount(0, { timeout: 20_000 });
    await expect(page.getByText('Ofira added')).toBeVisible();
    const brands = await (await page.request.get('/api/brands')).json();
    const person = (brands.find((b: any) => b.id === brand.id).json.characters ?? []).find(
      (c: any) => c.name === 'Ofira',
    );
    expect(person.source).toBe('synthetic');
    expect(person.shots.map((s: any) => s.angle)).toEqual(['portrait', 'front', 'three-quarter']);
    expect(person.shots[0].file).toBe(`asset:${portrait}`);
    expect(person.avatar).toMatch(/^asset:[a-f0-9]{32}$/);
    expect(person.preview).toBe(`asset:${portrait}`);
    expect(person.likeness).toBeUndefined();
    expect((await draftsOf(page, brand.id)).drafts).toEqual([]);
    await expect(page.getByRole('heading', { name: 'Your presenters' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Ofira', exact: true })).toBeVisible();
  });

  test('close keeps the draft; reopen resumes the same step', async ({ page }) => {
    const brand = await currentBrand(page);
    const draftId = await seedDraft(page, brand.id, 'portrait-approved');
    await openDraft(page, brand, draftId);
    await expect(page.getByRole('button', { name: 'Use', exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('.sc-pstudio-slot[data-state="approved"]')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toHaveCount(0);
    expect((await draftsOf(page, brand.id)).drafts.map((d) => d.id)).toContain(draftId);

    await page.goto(`/${brand.slug}/presenters?new=presenter`);
    await expect(page.getByRole('button', { name: 'Use', exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('.sc-pstudio-slot[data-state="approved"]')).toHaveCount(1);
    const d = await draftOf(page, brand.id, draftId);
    expect(d.views.portrait.status).toBe('approved');
    expect(d.views.front.status).toBe('candidate');
  });

  test('Try again keeps the used face and replaces only the candidate', async ({ page }) => {
    const brand = await currentBrand(page);
    const draftId = await seedDraft(page, brand.id, 'portrait-approved');
    await openDraft(page, brand, draftId);
    await expect(page.getByRole('button', { name: 'Use', exact: true })).toBeVisible({ timeout: 20_000 });
    const before = await draftOf(page, brand.id, draftId);
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect.poll(async () => (await draftOf(page, brand.id, draftId)).views.front.attempts).toBe(2);
    await expect(page.getByRole('button', { name: 'Use', exact: true })).toBeVisible({ timeout: 20_000 });
    const after = await draftOf(page, brand.id, draftId);
    expect(after.views.portrait.hash).toBe(before.views.portrait.hash);
    expect(after.views.portrait.status).toBe('approved');
    expect(after.views.front.status).toBe('candidate');
    expect(after.generations).toBe(before.generations + 1);
  });

  test('a sentence after the lock redraws the face, and Use redraws the views built on it', async ({ page }) => {
    test.setTimeout(60_000);
    const brand = await currentBrand(page);
    const draftId = await seedDraft(page, brand.id, 'all-approved');
    await openDraft(page, brand, draftId);
    await expect(page.getByLabel('Name', { exact: true })).toBeVisible({ timeout: 20_000 });
    const before = await draftOf(page, brand.id, draftId);

    await composer(page).fill('a little shorter hair');
    await page.getByRole('button', { name: 'Send' }).click();
    await expect(page.getByRole('button', { name: 'Keep previous' })).toBeVisible({ timeout: 20_000 });
    let d = await draftOf(page, brand.id, draftId);
    expect(d.views.portrait.status).toBe('candidate');
    expect(d.views.portrait.prior).toBe(before.views.portrait.hash);
    expect(d.views.portrait.adjustment).toBe('a little shorter hair');
    // conditioned on the used face, so the change keeps the person
    expect(d.views.portrait.conditionedOn).toEqual([before.views.portrait.hash]);
    expect(d.views.front.status).toBe('approved');
    const revised = d.views.portrait.hash as string;

    await page.getByRole('button', { name: 'Use', exact: true }).click();
    // the views built on the old face are drawn again from the new one, with no click
    await expect(status(page)).toContainText('Full body', { timeout: 20_000 });
    await expect(page.getByRole('button', { name: 'Use', exact: true })).toBeVisible({ timeout: 20_000 });
    d = await draftOf(page, brand.id, draftId);
    expect(d.views.portrait).toMatchObject({ status: 'approved', hash: revised });
    expect(d.views.portrait.prior).toBeUndefined();
    expect(d.views.front.status).toBe('candidate');
    expect(d.views.front.conditionedOn).toEqual([revised]);
    expect(d.views['three-quarter'].status).toBe('stale');
    await useViews(page, ['Full body', 'Three-quarter']);
    d = await draftOf(page, brand.id, draftId);
    expect(d.views['three-quarter'].conditionedOn).toEqual([revised, d.views.front.hash]);
    await expect(page.getByLabel('Name', { exact: true })).toBeVisible({ timeout: 20_000 });
  });

  test('a sentence about the view on the stage changes that view only, and can be kept as it was', async ({ page }) => {
    test.setTimeout(60_000);
    const brand = await currentBrand(page);
    const draftId = await seedDraft(page, brand.id, 'all-approved');
    await openDraft(page, brand, draftId);
    await expect(page.getByLabel('Name', { exact: true })).toBeVisible({ timeout: 20_000 });
    const before = await draftOf(page, brand.id, draftId);

    await page.getByRole('button', { name: /^Full body/ }).click();
    await expect(page.locator('.sc-pstudio-slot[data-state="current"]')).toHaveAttribute('aria-label', /Full body/);
    await composer(page).fill('turn a little more to camera');
    await page.getByRole('button', { name: 'Send' }).click();
    await expect(page.getByRole('button', { name: 'Keep previous' })).toBeVisible({ timeout: 20_000 });
    let d = await draftOf(page, brand.id, draftId);
    expect(d.views.front).toMatchObject({ status: 'candidate', prior: before.views.front.hash });
    expect(d.views.portrait).toMatchObject({ status: 'approved', hash: before.views.portrait.hash });
    expect(d.views['three-quarter'].status).toBe('approved');

    await page.getByRole('button', { name: 'Keep previous' }).click();
    await expect(page.getByLabel('Name', { exact: true })).toBeVisible({ timeout: 20_000 });
    d = await draftOf(page, brand.id, draftId);
    expect(d.views.front).toMatchObject({ status: 'approved', hash: before.views.front.hash });
    expect(d.views.front.prior).toBeUndefined();
    expect(d.views['three-quarter'].status).toBe('approved');
  });

  test('Start over asks, then leaves nothing behind', async ({ page }) => {
    const brand = await currentBrand(page);
    const draftId = await seedDraft(page, brand.id, 'portrait-approved');
    await openDraft(page, brand, draftId);
    await expect(page.getByRole('button', { name: 'Use', exact: true })).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: 'Start over', exact: true }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Start over', exact: true }).click();
    await expect(page.getByRole('tab', { name: 'From scratch' })).toBeVisible();
    // the sentence comes back, so a second try starts from it
    await expect(page.getByLabel('Describe the person')).toHaveValue('a man in his 30s');
    expect((await draftsOf(page, brand.id)).drafts.map((d) => d.id)).not.toContain(draftId);
    expect((await page.request.get(`/api/brands/${brand.id}/presenter-drafts/${draftId}`)).status()).toBe(404);
  });

  test('a failed draw offers Retry and keeps the rest of the person', async ({ page }) => {
    const brand = await currentBrand(page);
    const draftId = await seedDraft(page, brand.id, 'portrait-approved');
    let blocked = true;
    await page.route(`**/presenter-drafts/${draftId}/views/front/generate`, async (route) => {
      if (blocked && route.request().method() === 'POST') {
        blocked = false;
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'the engine fell over' }),
        });
        return;
      }
      await route.continue();
    });
    await openDraft(page, brand, draftId);
    await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: 'Retry' }).click();
    await expect(page.getByRole('button', { name: 'Use', exact: true })).toBeVisible({ timeout: 20_000 });
    const d = await draftOf(page, brand.id, draftId);
    expect(d.views.portrait.status).toBe('approved');
    expect(d.views.front.status).toBe('candidate');
  });
});

test.describe('from photos', () => {
  test('one photo and the confirmation: the photo is the face, the rest is drawn from it', async ({ page }) => {
    test.setTimeout(90_000);
    const brand = await currentBrand(page);
    await page.goto(`/${brand.slug}/presenters?new=presenter`);
    await page.getByRole('tab', { name: 'From photos' }).click();
    await page.locator('input[type="file"]').setInputFiles({ name: 'noor.png', mimeType: 'image/png', buffer: PNG });
    await expect(page.locator('.sc-pstudio-pslot-frame[data-filled] img')).toHaveCount(1);
    // the photo is on the stage before anything is drawn
    await expect(page.locator('.sc-pstudio-well img')).toBeVisible();
    const go = page.getByRole('button', { name: 'Continue', exact: true });
    await expect(go).toHaveAttribute('aria-disabled', 'true');
    await expect(go).toHaveAttribute('title', /permission/i);
    await page.getByRole('checkbox').check();
    await expect(go).not.toHaveAttribute('aria-disabled', /.*/);
    await go.click();

    const use = page.getByRole('button', { name: 'Use', exact: true });
    await expect(use).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('.sc-pstudio-slot[aria-label*="your photo"]')).toHaveCount(1);
    await expect(page.locator('.sc-pstudio-line')).toContainText('Face from your photo');
    const draftId = await waitDraft(page, brand.id);
    const d = await draftOf(page, brand.id, draftId);
    expect(d.views.portrait).toMatchObject({ status: 'approved', origin: 'photo' });
    const photo = d.views.portrait.hash as string;
    expect(d.views.front.conditionedOn).toEqual([photo]);

    // the composer will not redraw a photograph
    await page.getByRole('button', { name: /^Face/ }).click();
    await composer(page).fill('shorter hair');
    await page.getByRole('button', { name: 'Send' }).click();
    await expect(page.getByRole('alert')).toContainText('Their photos define who they are');
    await page.getByRole('button', { name: /^Full body/ }).click();

    await useViews(page, ['Full body', 'Three-quarter']);
    const name = page.getByLabel('Name', { exact: true });
    await expect(name).toBeVisible({ timeout: 20_000 });
    await name.fill('Noor');
    await page.getByRole('button', { name: 'Save presenter' }).click();
    await expect(dialog(page)).toHaveCount(0, { timeout: 20_000 });
    const brands = await (await page.request.get('/api/brands')).json();
    const person = (brands.find((b: any) => b.id === brand.id).json.characters ?? []).find(
      (c: any) => c.name === 'Noor',
    );
    expect(person.source).toBe('photos');
    expect(person.likeness.version).toBe('v1');
    expect(person.sourceRefs.map((s: any) => s.file)).toEqual([`asset:${photo}`]);
    expect(person.shots[0]).toMatchObject({ file: `asset:${photo}`, angle: 'portrait' });
    expect(person.shots).toHaveLength(3);
  });
});

test.describe('the doors lead here', () => {
  test('the chooser row replaces itself, so one Back returns to the chooser', async ({ page }) => {
    const brand = await currentBrand(page);
    await page.goto(`/${brand.slug}/scenes`);
    await page.getByRole('button', { name: 'Add to this brand', exact: true }).click();
    await page.locator('[data-kind="presenter"]').click();
    await expect(page).toHaveURL(/\?new=presenter$/);
    await expect(dialog(page)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'New presenter' })).toBeVisible();
    await page.locator('.sc-newdlg-back').click();
    await expect(page).toHaveURL(/\?new=1$/);
    await expect(page.locator('.sc-pick')).toHaveCount(3);
  });

  test('a created scene page is just as alive', async ({ page }) => {
    test.setTimeout(90_000);
    const brand = await currentBrand(page);
    await page.goto(`/${brand.slug}/scenes?new=scene`);
    await expect(page.getByRole('heading', { name: 'New scene' })).toBeVisible();
    await page.locator('.sc-newdlg input[type="file"]').setInputFiles({
      name: 'terrace.png',
      mimeType: 'image/png',
      buffer: PNG,
    });
    await page.getByLabel('Name', { exact: true }).fill('Low Terrace');
    await page.getByLabel('Direction', { exact: true }).fill('A stone terrace in low evening sun.');
    await page.locator('.sc-dlg-go').click();
    await expect(dialog(page)).toHaveCount(0);

    await expect(page.getByRole('heading', { name: 'Your scenes' })).toBeVisible({ timeout: 30_000 });
    const ownCard = page.locator('.sc-owned .sc-lookcard-open').first();
    await expect(ownCard).toBeVisible({ timeout: 15_000 });
    await ownCard.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/${brand.slug}/scenes/[^/]+$`));
    await page.getByRole('link', { name: 'Scenri home' }).click();
    await expect(page).toHaveURL(new RegExp(`/${brand.slug}$`));
  });

  test('an existing presenter still opens from the library', async ({ page }) => {
    const brand = await currentBrand(page);
    await page.goto(`/${brand.slug}/presenters`);
    await expect(page.getByRole('heading', { name: 'Your presenters' })).toBeVisible();
    const mine = page.locator('.sc-owned .sc-lookcard-open').first();
    await expect(mine).toBeVisible();
    await mine.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/${brand.slug}/presenters/[^/?]+$`));
    await expect(page.locator('#main.sc-presenterpage')).toBeVisible();

    await page.goto(`/${brand.slug}/presenters`);
    await expect(page.getByRole('heading', { name: 'Scenri presenters' })).toBeVisible();
    await expect(page.locator('.sc-masonry .sc-lookcard-open').nth(2)).toBeVisible();
  });
});
