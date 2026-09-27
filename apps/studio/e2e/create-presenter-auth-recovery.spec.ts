import { expect, type Page, test } from '@playwright/test';
import { isolate } from './harness.js';
import { LOGO, picture } from './pictures.js';

/**
 * Something to draw with arrives while a conversation is stopped at the setup
 * line. The studio reads its capabilities again when setup closes, the
 * conversation carries on from where it stopped with nothing to add again,
 * and nothing is drawn until the press that was refused is pressed again.
 *
 * The server here can draw (the demo engine); the studio is told it cannot
 * until setup closes, which is what a fresh login looks like from the page.
 */
isolate({ env: { SCENRI_DEMO_BUILDS: '1', SCENRI_DEMO_REFS: '5', SCENRI_DEMO_DELAY_MS: '400' } });

const GATE = 'Drawing a presenter needs image generation, which is not set up yet.';
const CAPS = '**/api/asset-builds/capabilities';

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
const draftsOf = async (p: Page, brandId: string) => {
  const r = await (await p.request.get(`/api/brands/${brandId}/presenter-drafts`)).json();
  return (r.drafts ?? r) as { id: string }[];
};

/** The studio believes nothing can draw, until setup closes. */
async function nothingCanDraw(p: Page) {
  await p.route(CAPS, (route) =>
    route.fulfill({ json: { canAnalyze: false, canGenerate: false, engineId: null, engineName: null, free: true } }),
  );
}

/** Set up pressed, something connected there, and the dialog closed. */
async function setUpAndReturn(p: Page) {
  await p.unroute(CAPS);
  await answer(p, 'Set up').click();
  await p.waitForURL(/[?&]setup=/);
  await p.keyboard.press('Escape');
  await p.waitForURL((u) => !u.searchParams.has('setup'));
}

test('a logo held at the setup line carries on after setup, is drawn from on Continue, and stays a photo', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await nothingCanDraw(page);
  const brand = await currentBrand(page);
  await page.goto(`/${brand.slug}/presenters/new`);
  await answer(page, 'Add photos').click();
  await page.locator('input[type="file"]').setInputFiles(picture('acme-logo.png', LOGO));
  await page.getByRole('checkbox').check();
  await answer(page, 'Continue').click();
  await expect(log(page)).toContainText(GATE);

  await setUpAndReturn(page);
  // back at the photographs, the logo still there, and nothing started on its own
  await expect(log(page)).not.toContainText(GATE);
  await expect(page.locator('.sc-assetform-ref')).toHaveCount(1);
  await expect(answer(page, 'Continue')).toBeVisible();
  await page.waitForTimeout(1500);
  expect(await draftsOf(page, brand.id)).toEqual([]);
  await expect(page).toHaveURL(/\/presenters\/new$/);

  // the press that was refused, pressed again: now a face is drawn from the logo, never the logo itself
  await answer(page, 'Continue').click();
  await expect(page).toHaveURL(/\/presenters\/new\/pd-/, { timeout: 40_000 });
  await answer(page, 'Nothing to add').click();
  await expect(log(page)).toContainText('Here is the face', { timeout: 30_000 });
  await answer(page, 'Use this person').click();
  await expect(log(page)).toContainText('Here is the full body', { timeout: 30_000 });
  await answer(page, 'Use it').click();
  await expect(answer(page, 'Not now')).toBeVisible({ timeout: 30_000 });
  await answer(page, 'Not now').click();
  await page.locator('.sc-convo-card textarea').fill('Acme');
  await page.locator('.sc-convo-card textarea').press('Enter');
  await answer(page, 'Save presenter').click();
  await expect(page).toHaveURL(/\/presenters\/up-/, { timeout: 40_000 });

  const brands = await (await page.request.get('/api/brands')).json();
  const person = (brands.find((b: any) => b.id === brand.id).json.characters ?? []).find((c: any) => c.name === 'Acme');
  // the upload is a source and nothing else: not a view, not the card, not the avatar
  const logo = person.sourceRefs[0].file as string;
  expect(person.sourceRefs).toHaveLength(1);
  expect(person.shots.map((s: { file: string }) => s.file)).not.toContain(logo);
  expect(person.preview).not.toBe(logo);
  expect(person.avatar).not.toBe(logo);
  expect(person.shots.map((s: { angle: string }) => s.angle)).toEqual(['portrait', 'front', 'three-quarter']);
});

test('a description said at the setup line is drawn on Draw the presenter once something can draw, never before', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await nothingCanDraw(page);
  const brand = await currentBrand(page);
  await page.goto(`/${brand.slug}/presenters/new`);
  // a whole description typed at the first question: the door and the description in one
  await page
    .locator('.sc-convo-card textarea')
    .fill('a woman in her 30s with shoulder-length black hair, olive skin, a solid build');
  await page.locator('.sc-convo-card textarea').press('Enter');
  await expect(log(page)).toContainText(GATE);

  await setUpAndReturn(page);
  // the conversation carries on where it stopped: what is always true of them, then the read-back
  await answer(page, 'Nothing else').click();
  // the description stands, read back, and waits for its press: the engine arriving is not one
  await expect(answer(page, 'Draw the presenter')).toBeVisible({ timeout: 15_000 });
  await expect(log(page)).toContainText('shoulder-length black hair');
  await page.waitForTimeout(1500);
  expect(await draftsOf(page, brand.id)).toEqual([]);

  await answer(page, 'Draw the presenter').click();
  await expect(page).toHaveURL(/\/presenters\/new\/pd-/, { timeout: 40_000 });
  await expect(log(page)).toContainText('Here is the face', { timeout: 30_000 });
});
