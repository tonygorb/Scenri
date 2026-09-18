import { test, expect, type Page } from '@playwright/test';
import { isolate } from './harness.js';
import { coachCard, coachTitle, guideRecord, noWelcomeWait, setUpBrand, steps, welcome } from './firstUse.js';

/**
 * Learn (DESIGN.md, "First use"): every lesson, then one lesson, and a lesson
 * is the same guided task First steps runs. Begun from either, it is in hand
 * in both; done from either (or without the tutor), it is done in both.
 */
isolate({ brand: false, env: { SCENRI_NO_GUIDE: '0', SCENRI_DEMO_BUILDS: '1', SCENRI_DEMO_REFS: '5' } });
test.describe.configure({ mode: 'serial' });

let slug = '';
const learn = (p: Page) => p.getByRole('dialog').filter({ has: p.locator('.sc-learn-grid, .sc-learn-detail') });
const card = (p: Page, title: string) => learn(p).locator('.sc-learn-card', { hasText: title });

test.beforeEach(async ({ page }) => {
  await noWelcomeWait(page);
  await page.setViewportSize({ width: 1440, height: 900 });
});

test('First steps and Learn are one list, and Learn is every lesson in it', async ({ page }) => {
  slug = await setUpBrand(page, 'Learning Co');
  await welcome(page).locator('.sc-welcome-foot').getByRole('button', { name: 'Not now' }).click();
  // the short list's way to the long one
  await steps(page).getByRole('button', { name: 'All lessons' }).click();
  await expect(page).toHaveURL(/learn=lessons/);
  await expect(learn(page).locator('.sc-learn-name')).toHaveText([
    'Make your first shot',
    'Add your product',
    'Create a presenter',
    'Build a scene',
    'Refine a shot',
  ]);
  // where each stands, in a few words: a count of steps, never a time
  await expect(card(page, 'Create a presenter').locator('.sc-learn-meta')).toHaveText('4 steps');
  await expect(learn(page)).not.toContainText(/min/);
  // First steps is the same list, four of them
  await expect(steps(page).locator('.sc-steps-item')).toHaveText([
    'Make your first shot',
    'Create a presenter',
    'Build a scene',
    'Refine a shot',
  ]);

  // one lesson: its steps as outcomes, and one way to begin it
  await card(page, 'Create a presenter').click();
  await expect(page).toHaveURL(/learn=presenter/);
  await expect(learn(page).locator('.sc-learn-step')).toHaveText([
    'Start a presenter',
    'Describe someone, or add photos',
    'Decide the face',
    'Save them',
  ]);
  await expect(learn(page).getByRole('button', { name: 'Start' })).toBeFocused();
  // back to every lesson lands on the one just read
  await learn(page).getByRole('button', { name: 'All lessons' }).click();
  await expect(page).toHaveURL(/learn=lessons/);
  await expect(card(page, 'Create a presenter')).toBeFocused();
  // a link to one lesson opens that lesson, and Escape closes it all
  await page.goto(`/${slug}?learn=scene`);
  await expect(learn(page).locator('.sc-newdlg-title')).toHaveText('Build a scene');
  await page.keyboard.press('Escape');
  await expect(learn(page)).toHaveCount(0);
  expect((await guideRecord(page)).active).toBeNull();
});

test('a lesson begun in Learn is the same task First steps continues, paused and continued as it was', async ({
  page,
}) => {
  await page.goto(`/${slug}?learn=presenter`);
  await learn(page).getByRole('button', { name: 'Start' }).click();
  await page.waitForURL('**/presenters/new**');
  await expect(page.locator('.sc-pstudio .sc-coach-title')).toHaveText('Describe someone, or start from photos', {
    timeout: 20_000,
  });
  const since = (await guideRecord(page)).active?.since;
  // closing the guide pauses the task rather than dropping it
  await page.locator('.sc-pstudio .sc-coach').getByRole('button', { name: 'Close guide' }).click();
  await expect(page.locator('.sc-pstudio .sc-coach')).toHaveCount(0);
  await expect.poll(async () => (await guideRecord(page)).active?.paused).toBe(true);

  // First steps and Learn both say it is in hand
  await page.goto(`/${slug}`);
  await expect(steps(page).locator('.sc-steps-item[data-state="active"]')).toHaveText('Continue your presenter');
  await steps(page).getByRole('button', { name: 'All lessons' }).click();
  await expect(card(page, 'Create a presenter').locator('.sc-learn-meta')).toHaveText('Step 1 of 4');
  await card(page, 'Create a presenter').click();
  await expect(learn(page).locator('.sc-learn-step[aria-current="step"]')).toHaveText('Start a presenter');
  // continuing it keeps the window it began with
  await learn(page).getByRole('button', { name: 'Continue' }).click();
  await page.waitForURL('**/presenters/new**');
  await expect(page.locator('.sc-pstudio .sc-coach-title')).toHaveText('Describe someone, or start from photos', {
    timeout: 20_000,
  });
  const going = (await guideRecord(page)).active;
  expect(going).toMatchObject({ task: 'presenter', since });
  expect(going?.paused).toBeUndefined();
});

test('a lesson done from Learn is done in First steps, and can be done again', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto(`/${slug}?learn=scene`);
  await learn(page).getByRole('button', { name: 'Start' }).click();
  await expect(page).toHaveURL(/new=scene/);
  await expect(coachTitle(page)).toHaveText('Build a scene');
  await page.getByPlaceholder('Name this place').fill('Quiet terrace');
  await page.getByPlaceholder('What matters in these references, and what to ignore').fill('Low sun on stone');
  await page.getByRole('button', { name: 'Create scene' }).click();
  await expect.poll(async () => (await guideRecord(page)).done.scene, { timeout: 60_000 }).toBeTruthy();
  await expect.poll(async () => (await guideRecord(page)).active, { timeout: 20_000 }).toBeNull();

  await page.goto(`/${slug}`);
  await expect(steps(page).locator('.sc-steps-item', { hasText: 'Build a scene' })).toHaveAttribute(
    'data-state',
    'done',
  );
  await steps(page).getByRole('button', { name: 'All lessons' }).click();
  await expect(card(page, 'Build a scene').locator('.sc-learn-meta')).toHaveText('Done');
  await card(page, 'Build a scene').click();
  await expect(learn(page).locator('.sc-learn-step[data-state="done"]')).toHaveCount(3);
  await expect(learn(page).getByRole('button', { name: 'Do it again' })).toBeVisible();
});

test('refining with no shot says so, and its one action makes a shot first', async ({ page }) => {
  await page.goto(`/${slug}?learn=refine`);
  await expect(learn(page)).toContainText('Refining starts from a shot you have made.');
  await learn(page).getByRole('button', { name: 'Make a shot first' }).click();
  await page.waitForURL(`**/${slug}/create`);
  await expect(coachTitle(page)).toContainText('This is Create', { timeout: 20_000 });
  expect((await guideRecord(page)).active?.task).toBe('first-shot');
});

test('on a phone Learn is the sheet, and every lesson a row', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/${slug}?learn=lessons`);
  await expect(learn(page).locator('.sc-learn-card')).toHaveCount(5);
  const columns = await learn(page)
    .locator('.sc-learn-grid')
    .evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length);
  expect(columns).toBe(1);
  // the sheet holds one height for both levels, so its top edge does not jump
  const top = async () => Math.round((await page.locator('.sc-learn').boundingBox())?.y ?? 0);
  // measured once the sheet has come up, not while it slides in
  await page.waitForTimeout(400);
  const before = await top();
  await card(page, 'Refine a shot').click();
  await expect(learn(page).locator('.sc-learn-detail')).toBeVisible();
  await page.waitForTimeout(200);
  expect(Math.abs((await top()) - before)).toBeLessThanOrEqual(1);
  await expect(coachCard(page)).toHaveCount(0);
});
