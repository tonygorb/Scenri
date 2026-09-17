import { test, expect, type Page } from '@playwright/test';
import { isolate } from './harness.js';
import { guideRecord, isInert, noWelcomeWait, pointsAt, setUpBrand, steps, welcome } from './firstUse.js';

/**
 * The presenter task (DESIGN.md, "First use"): the conversation held by the
 * same coach as the first shot at every answer that shapes the person, each
 * card beside the conversation pointing at the open question, only its answers
 * live; quiet through the look questions after the first and the waits. A
 * studio left with a draft keeps the task, and First steps continues that
 * exact draft.
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
  await expect(steps(page).locator('.sc-steps-title')).toHaveText('Continue your presenter');
  await steps(page).locator('.sc-steps-go').click();
  await page.waitForURL(`**/presenters/new/${draft.id}`);

  await expect(studioCoach(page).locator('.sc-coach-title')).toHaveText('Decide the face', { timeout: 20_000 });
  await expect(studio(page).locator('.sc-coach-veil')).toHaveCount(1);
  expect(
    await studio(page)
      .locator('.sc-pstudio-well')
      .evaluate((el) => !!el.closest('[inert]')),
  ).toBe(false);

  // Deciding the face moves the guide on with the conversation.
  await answer(page, 'Use this person').click();
  await expect(studioCoach(page).locator('.sc-coach-title')).not.toHaveText('Decide the face');

  // The full body and the extra views each get their own word, pointing at their own answers.
  const save = answer(page, 'Save presenter');
  const expectations: [string, string][] = [
    ['Use it', 'Check the full body'],
    ['Not now', 'More angles are optional'],
  ];
  for (let i = 0; i < 120 && !(await save.isVisible()); i++) {
    for (const [label, title] of expectations) {
      const b = answer(page, label);
      if (await b.isVisible()) {
        await expect(studioCoach(page).locator('.sc-coach-title')).toHaveText(title);
        await b.click();
      }
    }
    await page.waitForTimeout(500);
  }
  await expect(studioCoach(page).locator('.sc-coach-title')).toHaveText('Save your presenter', { timeout: 60_000 });
  await save.click();

  await expect.poll(async () => (await guideRecord(page)).active, { timeout: 20_000 }).toBeNull();
  expect((await guideRecord(page)).done.presenter).toBeTruthy();
});

test('a presenter from scratch: every answer that shapes them is guided, one question at a time, to the save', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const brand = ((await (await page.request.get('/api/brands')).json()) as { id: string; slug: string }[])[0];
  await page.request.post('/api/guide', { data: { start: { task: 'presenter', brandId: brand.id } } });
  await page.goto(`/${brand.slug}/presenters/new`);
  const title = studioCoach(page).locator('.sc-coach-title');
  const q = (id: string) => `.sc-pstudio [data-turn="q:${id}"]`;

  // The start: the card beside the question, pointing at it; its answers usable, the composer not.
  await expect(title).toHaveText('Create a presenter', { timeout: 20_000 });
  await expect(studioCoach(page)).toHaveAttribute('data-beside', 'true');
  await pointsAt(page, `${q('source')} .sc-convo-q`);
  expect(await isInert(page, '.sc-pstudio-foot .sc-convo-card')).toBe(true);
  await answer(page, 'Describe someone').click();

  // The first look question gets a word; the rows after it explain themselves.
  await expect(title).toHaveText('Build their look');
  await pointsAt(page, `${q('look-who')} .sc-convo-q`);
  await answer(page, 'Woman').click();
  await expect(page.getByRole('log')).toContainText('Roughly how old?');
  await expect(studioCoach(page)).toHaveCount(0);
  for (const pick of ['30s', 'Mediterranean', 'Olive', 'Black', 'Shoulder', 'Green', 'Solid', 'Average']) {
    await answer(page, pick).click();
  }

  // Distinctive details, then the read-back before anything is drawn.
  await expect(title).toHaveText('Anything distinctive?');
  await pointsAt(page, `${q('traits')} .sc-convo-q`);
  await answer(page, 'Nothing else').click();
  await expect(title).toHaveText('Draw the presenter');
  await answer(page, 'Draw the presenter').click();
  await page.waitForURL(/\/presenters\/new\/pd-/, { timeout: 40_000 });

  // From the face to the save, each decision is its own step; the name is typed where the card points.
  const seen: string[] = [];
  for (let i = 0; i < 240; i++) {
    const now = (await title.count()) ? ((await title.textContent()) ?? '') : '';
    if (now === 'Save your presenter') break;
    if (now && seen.at(-1) !== now) seen.push(now);
    if (now === 'Decide the face') {
      expect(await isInert(page, '.sc-pstudio-well')).toBe(false);
      await answer(page, 'Use this person').click();
    } else if (now === 'Check the full body') await answer(page, 'Use it').click();
    else if (now === 'More angles are optional') await answer(page, 'Not now').click();
    else if (now === 'Name them') {
      expect(await isInert(page, '.sc-pstudio-foot .sc-convo-card')).toBe(false);
      const words = page.locator('.sc-pstudio-foot .sc-convo-card textarea');
      await words.fill('Maya');
      await words.press('Enter');
    }
    await page.waitForTimeout(250);
  }
  expect(seen).toContain('Decide the face');
  expect(seen).toContain('Name them');
  await expect(title).toHaveText('Save your presenter', { timeout: 30_000 });
  await answer(page, 'Save presenter').click();
  await expect.poll(async () => (await guideRecord(page)).active, { timeout: 20_000 }).toBeNull();
});
