import { test, expect, type Page } from '@playwright/test';
import { isolate } from './harness.js';

/**
 * The presenter studio, end to end.
 *
 * A person is cast one approved view at a time: from a sentence or from
 * photographs, portrait first, then full body, then three-quarter, each drawn
 * from the views approved before it, then named and saved. The harness runs
 * the demo engine and lets the build picker accept it (SCENRI_DEMO_BUILDS)
 * with five reference slots (SCENRI_DEMO_REFS), so every step draws a
 * placeholder instantly and nothing real is spent. What a step was drawn
 * from is read back off the draft, since a placeholder's pixels say nothing.
 *
 * SCENRI_NO_CODEX keeps the analyzer off, so the photos path takes its
 * no-analyzer branch: the first photo is the portrait.
 */
isolate({ env: { SCENRI_DEMO_BUILDS: '1', SCENRI_DEMO_REFS: '5' } });

/** One valid 1x1 PNG, enough for an upload the server will accept. */
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

async function installCommitCounter(p: Page): Promise<void> {
  await p.addInitScript(() => {
    const hook = {
      commits: 0,
      supportsFiber: true,
      inject: () => 1,
      onScheduleFiberRoot: () => {},
      onCommitFiberUnmount: () => {},
      onPostCommitFiberRoot: () => {},
      onCommitFiberRoot() {
        hook.commits++;
      },
      checkDCE: () => {},
      renderers: new Map(),
    };
    Object.defineProperty(window, '__REACT_DEVTOOLS_GLOBAL_HOOK__', { value: hook });
  });
}

/** Commits over roughly a second, once the page has had a moment to settle. */
async function commitRate(p: Page): Promise<number> {
  await p.waitForTimeout(500);
  const before = await p.evaluate(() => (window as any).__REACT_DEVTOOLS_GLOBAL_HOOK__.commits);
  await p.waitForTimeout(1000);
  const after = await p.evaluate(() => (window as any).__REACT_DEVTOOLS_GLOBAL_HOOK__.commits);
  return after - before;
}

const draftIdOf = (p: Page) => new URL(p.url()).pathname.split('/').pop() as string;
const draftOf = async (p: Page, brandId: string, draftId: string) =>
  (await p.request.get(`/api/brands/${brandId}/presenter-drafts/${draftId}`)).json();

/** Drive a draft to a candidate on a given view through the API, so a test can start mid-flow. */
async function seedDraft(p: Page, brandId: string, upTo: 'portrait-candidate' | 'portrait-approved') {
  const base = `/api/brands/${brandId}/presenter-drafts`;
  const draft = await (
    await p.request.post(base, { data: { source: 'synthetic', direction: 'a man in his 30s' } })
  ).json();
  await p.request.post(`${base}/${draft.id}/views/portrait/generate`, { data: {} });
  for (let i = 0; i < 100; i++) {
    const d = await draftOf(p, brandId, draft.id);
    if (d.views.portrait.status === 'candidate') break;
    await p.waitForTimeout(50);
  }
  if (upTo === 'portrait-approved') await p.request.post(`${base}/${draft.id}/views/portrait/approve`);
  return draft.id as string;
}

test.describe('a person from scratch', () => {
  test('doors, portrait, approve, build, name, save: one person, then their page', async ({ page }) => {
    test.setTimeout(90_000);
    await installCommitCounter(page);
    const brand = await currentBrand(page);

    // The library's own offer leads to the studio, a page under it.
    await page.goto(`/${brand.slug}/presenters`);
    await page.getByRole('button', { name: 'Create presenter' }).first().click();
    await expect(page).toHaveURL(new RegExp(`/${brand.slug}/presenters/new$`));
    await expect(page.getByRole('heading', { name: 'Create your presenter' })).toBeVisible();

    // One door, one sentence.
    await page.locator('[data-kind="scratch"]').click();
    await page.getByLabel('Who are they').fill('confident woman in her 40s, short silver hair');
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/${brand.slug}/presenters/new/pd-[a-f0-9]{8}$`));
    const draftId = draftIdOf(page);

    // The portrait is drawn without a click and waits for a decision.
    const approve = page.getByRole('button', { name: /Approve & (continue|finish)/ });
    await expect(approve).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('heading', { name: 'This is the person' })).toBeVisible();
    await expect(page.locator('.sc-studio-stage img')).toBeVisible();
    let d = await draftOf(page, brand.id, draftId);
    expect(d.views.portrait.status).toBe('candidate');
    expect(d.views.portrait.conditionedOn).toEqual([]);
    const portrait = d.views.portrait.hash as string;

    // Approve locks the face: the full body is drawn from it, nothing else.
    await approve.click();
    await expect(page.getByRole('heading', { name: 'Full body' })).toBeVisible({ timeout: 20_000 });
    await expect(approve).toBeVisible({ timeout: 20_000 });
    d = await draftOf(page, brand.id, draftId);
    expect(d.views.portrait.status).toBe('approved');
    expect(d.views.front.status).toBe('candidate');
    expect(d.views.front.conditionedOn).toEqual([portrait]);
    const front = d.views.front.hash as string;

    // And the three-quarter from both approved views.
    await approve.click();
    await expect(page.getByRole('heading', { name: 'Three-quarter' })).toBeVisible({ timeout: 20_000 });
    await expect(approve).toBeVisible({ timeout: 20_000 });
    d = await draftOf(page, brand.id, draftId);
    expect(d.views['three-quarter'].conditionedOn).toEqual([portrait, front]);
    // the strip is the progress: two approved, one current
    await expect(page.locator('.sc-studio-strip [data-state="approved"]')).toHaveCount(2);
    await expect(page.locator('.sc-studio-strip [data-state="current"]')).toHaveCount(1);

    // Approving the last view is the review: the person, then a name.
    await approve.click();
    const name = page.getByLabel('Name', { exact: true });
    await expect(name).toBeVisible({ timeout: 20_000 });
    const save = page.getByRole('button', { name: 'Save presenter' });
    await expect(save).toHaveAttribute('aria-disabled', 'true');
    await expect(save).toHaveAttribute('title', /name/i);
    await name.fill('Ofira');
    await expect(save).not.toHaveAttribute('aria-disabled', /.*/);
    await save.click();

    // Their page, alive, and the record exactly as approved.
    await expect(page).toHaveURL(new RegExp(`/${brand.slug}/presenters/up-[a-f0-9]{8}$`), { timeout: 20_000 });
    await expect(page.locator('input[aria-label="Their name"]')).toHaveValue('Ofira');
    expect(await commitRate(page)).toBeLessThan(50);
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
    // the draft is spent
    expect((await (await page.request.get(`/api/brands/${brand.id}/presenter-drafts`)).json()).drafts).toEqual([]);
    // and the library shows them as the brand's own
    await page.goto(`/${brand.slug}/presenters`);
    await expect(page.getByRole('heading', { name: 'Your presenters' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Ofira', exact: true })).toBeVisible();
  });

  test('a reload lands back on the same step, approved work intact', async ({ page }) => {
    const brand = await currentBrand(page);
    const draftId = await seedDraft(page, brand.id, 'portrait-approved');
    await page.goto(`/${brand.slug}/presenters/new/${draftId}`);
    // the full body is drawn on arrival, from the approved portrait
    await expect(page.getByRole('button', { name: 'Approve & continue' })).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('.sc-studio-strip [data-state="approved"]')).toHaveCount(1);
    await page.reload();
    await expect(page.getByRole('button', { name: 'Approve & continue' })).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('.sc-studio-strip [data-state="approved"]')).toHaveCount(1);
    const d = await draftOf(page, brand.id, draftId);
    expect(d.views.portrait.status).toBe('approved');
    expect(d.views.front.status).toBe('candidate');
  });

  test('Try again keeps the approved portrait and replaces only the candidate', async ({ page }) => {
    const brand = await currentBrand(page);
    const draftId = await seedDraft(page, brand.id, 'portrait-approved');
    await page.goto(`/${brand.slug}/presenters/new/${draftId}`);
    await expect(page.getByRole('button', { name: 'Approve & continue' })).toBeVisible({ timeout: 20_000 });
    const before = await draftOf(page, brand.id, draftId);
    await page.getByRole('button', { name: 'Try again' }).click();
    // The demo engine draws one prompt to one picture, so a second roll is
    // the same bytes and the same hash: what this proves is that the step
    // was spent again and the approved portrait was not touched. A real
    // engine's second roll differs, and the first lands in `rejected`.
    await expect.poll(async () => (await draftOf(page, brand.id, draftId)).views.front.attempts).toBe(2);
    await expect(page.getByRole('button', { name: 'Approve & continue' })).toBeVisible({ timeout: 20_000 });
    const after = await draftOf(page, brand.id, draftId);
    expect(after.views.portrait.hash).toBe(before.views.portrait.hash);
    expect(after.views.portrait.status).toBe('approved');
    expect(after.views.front.status).toBe('candidate');
    expect(after.generations).toBe(before.generations + 1);
  });

  test('Escape leaves and the draft stays; Discard asks, then leaves nothing behind', async ({ page }) => {
    const brand = await currentBrand(page);
    const draftId = await seedDraft(page, brand.id, 'portrait-approved');
    await page.goto(`/${brand.slug}/presenters/new/${draftId}`);
    await expect(page.getByRole('button', { name: 'Approve & continue' })).toBeVisible({ timeout: 20_000 });
    await page.keyboard.press('Escape');
    await expect(page).toHaveURL(new RegExp(`/${brand.slug}/presenters$`));
    const still = (await (await page.request.get(`/api/brands/${brand.id}/presenter-drafts`)).json()).drafts;
    expect(still.map((d: any) => d.id)).toContain(draftId);

    await page.goto(`/${brand.slug}/presenters/new/${draftId}`);
    await expect(page.getByRole('button', { name: 'Approve & continue' })).toBeVisible({ timeout: 20_000 });
    const portrait = (await draftOf(page, brand.id, draftId)).views.portrait.hash as string;
    await page.getByRole('button', { name: 'Discard', exact: true }).click();
    // something was drawn, so it asks once
    await page.getByRole('alertdialog').getByRole('button', { name: 'Discard', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/${brand.slug}/presenters$`));
    const left = (await (await page.request.get(`/api/brands/${brand.id}/presenter-drafts`)).json()).drafts;
    expect(left.map((d: any) => d.id)).not.toContain(draftId);
    // The demo engine draws one prompt to one picture, so other drafts in
    // this file hold the same bytes; the file stays while any of them does.
    // What is proven here is the row: the picture's own removal is covered
    // by the route test, where the draft is alone.
    expect((await page.request.get(`/api/brands/${brand.id}/presenter-drafts/${draftId}`)).status()).toBe(404);
    void portrait;
  });

  test('on a phone the picture, the strip and the decision all fit', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const brand = await currentBrand(page);
    const draftId = await seedDraft(page, brand.id, 'portrait-candidate');
    await page.goto(`/${brand.slug}/presenters/new/${draftId}`);
    const approve = page.getByRole('button', { name: /Approve & continue/ });
    await expect(approve).toBeVisible({ timeout: 20_000 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    const box = await approve.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(40);
  });
});

test.describe('from photos', () => {
  test('one photo and the confirmation: the photo is the portrait, the rest is drawn from it', async ({ page }) => {
    test.setTimeout(90_000);
    const brand = await currentBrand(page);
    await page.goto(`/${brand.slug}/presenters/new`);
    await page.locator('[data-kind="photos"]').click();
    await page.locator('input[type="file"]').setInputFiles({ name: 'noor.png', mimeType: 'image/png', buffer: PNG });
    await expect(page.locator('.sc-assetform-ref img')).toHaveCount(1);
    const go = page.getByRole('button', { name: 'Continue', exact: true });
    // the likeness confirmation gates the door
    await expect(go).toHaveAttribute('aria-disabled', 'true');
    await expect(go).toHaveAttribute('title', /permission/i);
    await page.getByRole('checkbox').check();
    await expect(go).not.toHaveAttribute('aria-disabled', /.*/);
    await go.click();
    await expect(page).toHaveURL(new RegExp(`/${brand.slug}/presenters/new/pd-[a-f0-9]{8}$`));
    const draftId = draftIdOf(page);

    // the photo fills the portrait as itself; the full body is drawn from it
    const approve = page.getByRole('button', { name: /Approve & (continue|finish)/ });
    await expect(approve).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('.sc-studio-strip [data-state="approved"]')).toContainText('Your photo');
    const d = await draftOf(page, brand.id, draftId);
    expect(d.views.portrait).toMatchObject({ status: 'approved', origin: 'photo' });
    const photo = d.views.portrait.hash as string;
    expect(d.views.front.conditionedOn).toEqual([photo]);
    await approve.click();
    await expect(page.getByRole('heading', { name: 'Three-quarter' })).toBeVisible({ timeout: 20_000 });
    await expect(approve).toBeVisible({ timeout: 20_000 });
    await approve.click();
    const name = page.getByLabel('Name', { exact: true });
    await expect(name).toBeVisible({ timeout: 20_000 });
    await name.fill('Noor');
    await page.getByRole('button', { name: 'Save presenter' }).click();
    await expect(page).toHaveURL(new RegExp(`/${brand.slug}/presenters/up-[a-f0-9]{8}$`), { timeout: 20_000 });
    const brands = await (await page.request.get('/api/brands')).json();
    const person = (brands.find((b: any) => b.id === brand.id).json.characters ?? []).find(
      (c: any) => c.name === 'Noor',
    );
    expect(person.source).toBe('photos');
    expect(person.likeness.version).toBe('v1');
    expect(person.sourceRefs.map((s: any) => s.file)).toEqual([`asset:${photo}`]);
    expect(person.shots[0]).toMatchObject({ file: `asset:${photo}`, angle: 'portrait' });
    expect(person.shots).toHaveLength(3);
    // the page shows the photographs it was built from
    await expect(page.getByText('Your photos')).toBeVisible();
  });
});

test.describe('the doors lead here', () => {
  test('the chooser row replaces itself, so one Back leaves', async ({ page }) => {
    const brand = await currentBrand(page);
    await page.goto(`/${brand.slug}/scenes`);
    await page.getByRole('button', { name: 'Add to this brand', exact: true }).click();
    await page.locator('[data-kind="presenter"]').click();
    await expect(page).toHaveURL(new RegExp(`/${brand.slug}/presenters/new$`));
    await expect(page.locator('.sc-newdlg')).toHaveCount(0);
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`/${brand.slug}/scenes$`));
    await expect(page.locator('.sc-newdlg')).toHaveCount(0);
  });

  test('a created scene page is just as alive', async ({ page }) => {
    test.setTimeout(90_000);
    await installCommitCounter(page);
    const brand = await currentBrand(page);

    // Scenes carried the identical effect loop, so the same walk guards them.
    await page.goto(`/${brand.slug}/scenes?new=scene`);
    await expect(page.getByRole('heading', { name: 'New scene' })).toBeVisible();
    await page.locator('.sc-newdlg input[type="file"]').setInputFiles({
      name: 'terrace.png',
      mimeType: 'image/png',
      buffer: PNG,
    });
    await page.getByLabel('Name', { exact: true }).fill('Low Terrace');
    // With no analyzer behind the harness, a scene built from photos alone
    // fails by design; a sentence of the user's own words is the other path.
    await page.getByLabel('Direction', { exact: true }).fill('A stone terrace in low evening sun.');
    await page.locator('.sc-dlg-go').click();
    await expect(page.locator('.sc-newdlg')).toHaveCount(0);

    await expect(page.getByRole('heading', { name: 'Your scenes' })).toBeVisible({ timeout: 30_000 });
    const ownCard = page.locator('.sc-owned .sc-lookcard-open').first();
    await expect(ownCard).toBeVisible({ timeout: 15_000 });
    await ownCard.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/${brand.slug}/scenes/[^/]+$`));

    expect(await commitRate(page)).toBeLessThan(50);
    await page.getByRole('link', { name: 'Scenri home' }).click();
    await expect(page).toHaveURL(new RegExp(`/${brand.slug}$`));
  });
});
