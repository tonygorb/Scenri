import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import { isolate } from './harness.js';

/**
 * Coming back to a presenter that was in the middle of something.
 *
 * The demo engine is told to take its time, so a draw is a state a person can
 * actually be in rather than something that has already happened by the time
 * the next line runs. Every other presenter spec draws instantly, which is why
 * none of them could see any of this.
 */
isolate({ env: { SCENRI_DEMO_BUILDS: '1', SCENRI_DEMO_REFS: '5', SCENRI_DEMO_STAGGER_MS: '4000' } });

test.beforeEach(async ({ page }, testInfo) => {
  await page.bringToFront();
  testInfo.setTimeout(90_000);
});

const log = (p: Page) => p.getByRole('log');
/** The stage says what it is doing; the log is the conversation. */
const stage = (p: Page) => p.locator('.sc-pstudio');
const answer = (p: Page, label: string) => log(p).getByRole('button', { name: label, exact: true });
const turn = (p: Page, key: string) => log(p).locator(`.sc-convo-turn[data-turn="${key}"]`);

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

const row = async (req: APIRequestContext, brandId: string, id: string) =>
  await (await req.get(`/api/brands/${brandId}/presenter-drafts/${id}`)).json();

/** A draft with a draw actually running on it, left there. */
async function drawing(req: APIRequestContext, brandId: string): Promise<string> {
  const base = `/api/brands/${brandId}/presenter-drafts`;
  const d = await (
    await req.post(base, { data: { source: 'synthetic', direction: 'a woman in her 30s, dark curly hair' } })
  ).json();
  await req.post(`${base}/${d.id}/views/portrait/generate`, { data: {} });
  for (let i = 0; i < 100; i++) {
    if ((await row(req, brandId, d.id)).activeView) return d.id;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('the draw never started');
}

async function settle(req: APIRequestContext, brandId: string, id: string) {
  for (let i = 0; i < 300; i++) {
    if (!(await row(req, brandId, id)).activeView) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('the draw never finished');
}

test('a reload while a face is drawing comes back to the same draw, and does not start a second', async ({ page }) => {
  const brand = await currentBrand(page);
  const id = await drawing(page.request, brand.id);

  await page.goto(`/${brand.slug}/presenters/new/${id}`);
  await expect(stage(page)).toContainText('Drawing the face', { timeout: 20_000 });
  const attempts = (await row(page.request, brand.id, id)).views.portrait.attempts;

  await page.reload();
  await expect(stage(page)).toContainText('Drawing the face', { timeout: 20_000 });

  // the conversation is the draft's own, read off it, rather than the opening
  // question over the top of a face that is already being drawn
  await expect(log(page)).toContainText('a woman in her 30s, dark curly hair', { timeout: 20_000 });

  // the same draw, not another: arriving on a drawing draft spends nothing
  await settle(page.request, brand.id, id);
  const after = await row(page.request, brand.id, id);
  expect(after.views.portrait.attempts).toBe(attempts + 1);
  expect(after.generations).toBe(1);
  await expect(answer(page, 'Use this person')).toBeVisible({ timeout: 30_000 });
});

test('leaving while a face is drawing leaves the draw alone, and the wall says so', async ({ page }) => {
  const brand = await currentBrand(page);
  const id = await drawing(page.request, brand.id);

  await page.goto(`/${brand.slug}/presenters/new/${id}`);
  await expect(stage(page)).toContainText('Drawing the face', { timeout: 20_000 });
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(new RegExp(`/${brand.slug}/presenters$`));

  // the card is on the wall and says it is working
  const card = page.locator(`.sc-lookcard:has(a[href$="/presenters/new/${id}"])`);
  await expect(card).toContainText('Drawing');

  // and the work really did carry on
  await settle(page.request, brand.id, id);
  expect((await row(page.request, brand.id, id)).views.portrait.status).toBe('candidate');
});

test('a reload mid-conversation comes back to the same question, with nothing said twice', async ({ page }) => {
  const brand = await currentBrand(page);
  await page.goto(`/${brand.slug}/presenters/new`);
  await answer(page, 'Describe someone').click();
  await answer(page, 'Woman').click();
  await answer(page, '30s').click();
  await expect(turn(page, 'you:look-age')).toContainText('30s');
  const keys = () =>
    log(page)
      .locator('.sc-convo-turn')
      .evaluateAll((els) => els.map((e) => e.dataset.turn));
  const before = await keys();

  await page.reload();
  await expect(turn(page, 'you:look-age')).toContainText('30s', { timeout: 20_000 });
  const after = await keys();
  // every answer that was given is back, exactly once: a reload used to write
  // the whole conversation out again as though it were being said now
  expect(after.filter((k) => k?.startsWith('you:'))).toEqual(before.filter((k) => k?.startsWith('you:')));
  expect(new Set(after).size).toBe(after.length);
  await expect(log(page).locator('.sc-convo-dots')).toHaveCount(0);
});

/**
 * Back and forward across the presenter area.
 *
 * Every move inside the studio replaces rather than pushes, so the studio owns
 * one history entry: Back leaves it the way the close does. The wall, a
 * presenter's page and their editor are ordinary entries either side of that.
 */
test('back and forward walk the library, a presenter and the studio without stranding anything', async ({ page }) => {
  const brand = await currentBrand(page);
  const id = await drawing(page.request, brand.id);
  await settle(page.request, brand.id, id);

  await page.goto(`/${brand.slug}/presenters`);
  await page.getByRole('button', { name: 'Create presenter' }).click();
  await expect(page).toHaveURL(new RegExp(`/${brand.slug}/presenters/new$`));

  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`/${brand.slug}/presenters$`));
  await expect(page.locator('.sc-pstudio')).toHaveCount(0);

  await page.goForward();
  await expect(page).toHaveURL(new RegExp(`/${brand.slug}/presenters/new$`));
  // forward into the studio is a conversation, not a resumed one
  await expect(answer(page, 'Describe someone')).toBeVisible({ timeout: 20_000 });

  // and a draft reached from the wall goes back to the wall
  await page.goBack();
  await page.locator(`a[href$="/presenters/new/${id}"]`).click();
  await expect(page).toHaveURL(new RegExp(`/presenters/new/${id}$`));
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`/${brand.slug}/presenters$`));
  await expect(page.locator('.sc-pstudio')).toHaveCount(0);
});
