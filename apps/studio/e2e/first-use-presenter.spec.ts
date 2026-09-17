import { test, expect, type Page } from '@playwright/test';
import { isolate } from './harness.js';
import { guideRecord, noWelcomeWait, setUpBrand, steps, welcome } from './firstUse.js';

/**
 * The presenter task (DESIGN.md, "First use"): the studio held by the same
 * coach as the first shot, at the three moments that need a word (the start,
 * the face, the save) and quiet through every other question. A studio left
 * with a draft keeps the task, and First steps continues that exact draft.
 */
isolate({
  brand: false,
  env: { SCENRI_NO_GUIDE: '0', SCENRI_DEMO_BUILDS: '1', SCENRI_DEMO_REFS: '5', SCENRI_DEMO_DELAY_MS: '300' },
});
test.describe.configure({ mode: 'serial' });

const studio = (p: Page) => p.locator('.sc-pstudio');
const studioCoach = (p: Page) => studio(p).locator('.sc-coach');
const answer = (p: Page, label: string) => p.getByRole('log').getByRole('button', { name: label, exact: true });

async function settled(p: Page, brandId: string, draftId: string, view: string, want: string) {
  for (let i = 0; i < 300; i++) {
    const d = await (await p.request.get(`/api/brands/${brandId}/presenter-drafts/${draftId}`)).json();
    if (d.views[view].status === want && !d.activeView) return;
    await p.waitForTimeout(50);
  }
  throw new Error(`${view} never became ${want}`);
}

test('the studio is held at the face and the save, quiet between, and the task ends when the presenter is saved', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await noWelcomeWait(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  const slug = await setUpBrand(page, 'Cast Room');
  await welcome(page).locator('.sc-welcome-foot').getByRole('button', { name: 'Not now' }).click();
  const brandId = ((await (await page.request.get('/api/brands')).json()) as { id: string; slug: string }[]).find(
    (b) => b.slug === slug,
  )?.id as string;

  // A presenter task started, and a draft made in it that stops at the first face.
  await page.request.post('/api/guide', { data: { start: { task: 'presenter', brandId } } });
  const base = `/api/brands/${brandId}/presenter-drafts`;
  const draft = await (
    await page.request.post(base, { data: { source: 'synthetic', direction: 'a man in his 30s', name: 'Idan' } })
  ).json();
  await page.request.post(`${base}/${draft.id}/views/portrait/generate`, { data: {} });
  await settled(page, brandId, draft.id, 'portrait', 'candidate');

  // First steps continues that exact draft.
  await page.goto(`/${slug}`);
  const item = steps(page).locator('.sc-steps-item[data-state="active"]');
  await expect(item.locator('.sc-steps-name')).toHaveText('Continue your presenter');
  await item.click();
  await page.waitForURL(`**/presenters/new/${draft.id}`);

  await expect(studioCoach(page).locator('.sc-coach-title')).toHaveText('Settle the face first', { timeout: 20_000 });
  await expect(studio(page).locator('.sc-coach-veil')).toHaveCount(1);
  expect(
    await studio(page)
      .locator('.sc-pstudio-well')
      .evaluate((el) => !!el.closest('[inert]')),
  ).toBe(false);

  // Deciding the face lets the studio speak for itself while it draws the rest.
  await answer(page, 'Use this person').click();
  await expect(studioCoach(page)).toHaveCount(0);

  // The body view and the extras are the studio's own questions: answered, with the guide quiet throughout.
  const save = answer(page, 'Save presenter');
  for (let i = 0; i < 120 && !(await save.isVisible()); i++) {
    for (const label of ['Use it', 'Not now']) {
      const b = answer(page, label);
      if (await b.isVisible()) {
        await expect(studioCoach(page)).toHaveCount(0);
        await b.click();
      }
    }
    await page.waitForTimeout(500);
  }
  await expect(studioCoach(page).locator('.sc-coach-title')).toHaveText('Save to cast them', { timeout: 60_000 });
  await save.click();

  await expect.poll(async () => (await guideRecord(page)).active, { timeout: 20_000 }).toBeNull();
  expect((await guideRecord(page)).done.presenter).toBeTruthy();
});
