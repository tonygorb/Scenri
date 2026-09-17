import { test, expect, type Page } from '@playwright/test';
import { isolate } from './harness.js';
import { guideRecord, isInert, noWelcomeWait, pointsAt, setUpBrand, steps, welcome } from './firstUse.js';

/**
 * The presenter task (DESIGN.md, "First use"): the studio asks its own
 * questions, so the tutor says nothing through them. Three decisions earn a
 * word, because the questions do not explain them: which road to take, whether
 * this face is the face, and that saving is what keeps them. A studio left
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

let slug = '';
let brandId = '';

test('a word at the start, then quiet: the studio asks its own questions', async ({ page }) => {
  test.setTimeout(90_000);
  await noWelcomeWait(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  slug = await setUpBrand(page, 'Cast Room');
  await welcome(page).locator('.sc-welcome-foot').getByRole('button', { name: 'Not now' }).click();
  brandId = ((await (await page.request.get('/api/brands')).json()) as { id: string; slug: string }[]).find(
    (b) => b.slug === slug,
  )?.id as string;

  // First steps opens the studio, and the tutor says which road is which.
  await steps(page).locator('.sc-steps-item', { hasText: 'Create a presenter' }).click();
  await page.waitForURL('**/presenters/new**');
  await expect(studioCoach(page).locator('.sc-coach-title')).toHaveText('Describe someone, or start from photos', {
    timeout: 20_000,
  });
  await pointsAt(page, '.sc-pstudio [data-turn="q:source"] .sc-convo-q');
  // only that question's own answers can be used
  expect(await isInert(page, '.sc-pstudio-foot .sc-convo-card')).toBe(true);
  expect(await isInert(page, '.sc-pstudio [data-turn="q:source"]')).toBe(false);

  // Answering it hands the conversation back: the questionnaire speaks for itself.
  await answer(page, 'Describe someone').click();
  await expect(page.getByRole('log')).toContainText('Who are they?');
  await expect(studioCoach(page)).toHaveCount(0);
  for (const pick of ['Woman', '30s', 'Mediterranean', 'Olive', 'Black', 'Shoulder', 'Green', 'Solid', 'Average'])
    await answer(page, pick).click();
  await expect(page.getByRole('log')).toContainText('Anything else that is always true of them?');
  await expect(studioCoach(page)).toHaveCount(0);
});

test('the face and the save are the two words it says, and saving ends the task', async ({ page }) => {
  test.setTimeout(120_000);
  await noWelcomeWait(page);
  await page.setViewportSize({ width: 1440, height: 900 });

  // The task in hand, and then a draft made inside it that reaches its first
  // face: the record only counts a draft begun after the task began.
  await page.request.post('/api/guide', { data: { start: { task: 'presenter', brandId } } });
  const base = `/api/brands/${brandId}/presenter-drafts`;
  const draft = await (
    await page.request.post(base, { data: { source: 'synthetic', direction: 'a man in his 30s', name: 'Idan' } })
  ).json();
  await page.request.post(`${base}/${draft.id}/views/portrait/generate`, { data: {} });
  await settled(page, brandId, draft.id, 'portrait', 'candidate');

  // First steps continues that exact draft.
  await page.goto(`/${slug}`);
  await expect(steps(page).locator('.sc-steps-item[data-state="active"]')).toHaveText(/Continue your presenter/);
  await steps(page).locator('.sc-steps-item', { hasText: 'Continue your presenter' }).click();
  await page.waitForURL(`**/presenters/new/${draft.id}`);

  await expect(studioCoach(page).locator('.sc-coach-title')).toHaveText('Decide the face', { timeout: 20_000 });
  // the portrait stays usable beside the question: its versions are part of deciding
  expect(await isInert(page, '.sc-pstudio-well')).toBe(false);
  await answer(page, 'Use this person').click();

  // Everything between is the studio's own; the tutor speaks again at the save.
  const save = answer(page, 'Save presenter');
  for (let i = 0; i < 120 && !(await save.isVisible()); i++) {
    for (const label of ['Use it', 'Not now']) {
      const b = answer(page, label);
      if (await b.isVisible()) await b.click();
    }
    await page.waitForTimeout(500);
  }
  await expect(studioCoach(page).locator('.sc-coach-title')).toHaveText('Save your presenter', { timeout: 60_000 });
  await save.click();

  await expect.poll(async () => (await guideRecord(page)).active, { timeout: 20_000 }).toBeNull();
  expect((await guideRecord(page)).done.presenter).toBeTruthy();
});
