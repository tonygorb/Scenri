import { test, expect, type Page } from '@playwright/test';
import { isolate } from './harness.js';
import {
  coachCard,
  coachTitle,
  guideRecord,
  noWelcomeWait,
  pickTheIngredients,
  learnButton,
  setUpBrand,
  walkToCreate,
  welcome,
} from './firstUse.js';

/**
 * Learn (DESIGN.md, "First use"): the bar's ghost button beside the bell, every
 * lesson, then one lesson. A lesson is a guided task: begun here it is in hand
 * here, paused it is continued as it was, and done here (or without the tutor)
 * it is done here.
 */
isolate({ brand: false, env: { SCENRI_NO_GUIDE: '0', SCENRI_DEMO_BUILDS: '1', SCENRI_DEMO_REFS: '5' } });
test.describe.configure({ mode: 'serial' });

let slug = '';
const learn = (p: Page) => p.getByRole('dialog').filter({ has: p.locator('.sc-learn-list, .sc-learn-lesson') });
const card = (p: Page, title: string) => learn(p).locator('.sc-learn-row', { hasText: title });
/** The one step that can be pressed, which carries the lesson's action. */
const action = (p: Page, verb: string) => learn(p).getByRole('button', { name: new RegExp(`^${verb}:`) });

test.beforeEach(async ({ page }) => {
  await noWelcomeWait(page);
  await page.setViewportSize({ width: 1440, height: 900 });
});

test('Learn is a quiet button beside the bell, and every lesson is in it', async ({ page }) => {
  slug = await setUpBrand(page, 'Learning Co');
  await welcome(page).locator('.sc-welcome-foot').getByRole('button', { name: 'Not now' }).click();
  await expect(learnButton(page)).toHaveText('Learn');
  await expect(page.locator('.sc-learn-btn + .sc-notif-btn')).toHaveCount(1);
  await learnButton(page).click();
  await expect(page).toHaveURL(/learn=lessons/);
  await expect(learn(page).locator('.sc-learn-name')).toHaveText([
    'Make your first shot',
    'Add your product',
    'Create a presenter',
    'Build a scene',
    'Refine a shot',
  ]);
  // where each stands, in a few words: a count of steps, never a time
  await expect(card(page, 'Create a presenter').locator('.sc-learn-status')).toHaveText('4 steps');
  // never a time: a word-boundary match, so a lesson may say "framing"
  await expect(learn(page)).not.toContainText(/\b(mins?|minutes?|hours?)\b/i);
  // pressed while open it shows it is the one open
  await expect(learnButton(page)).toHaveAttribute('data-on', 'true');

  // one lesson beside the list: its steps as outcomes, and the one step
  // that can be pressed, which is how it begins
  await card(page, 'Create a presenter').click();
  await expect(page).toHaveURL(/learn=presenter/);
  await expect(card(page, 'Create a presenter')).toHaveAttribute('aria-current', 'true');
  await expect(learn(page).locator('.sc-learn-step-name')).toHaveText([
    'Start a presenter',
    'Describe someone, or add photos',
    'Decide the face',
    'Save them',
  ]);
  await expect(learn(page).locator('button.sc-learn-step')).toHaveCount(1);
  await expect(action(page, 'Start')).toHaveAccessibleName('Start: Start a presenter');
  // choosing another lesson moves nothing: the picture and the steps hold their place
  const at = async () => [
    await learn(page).locator('.sc-learn-hero').boundingBox(),
    await learn(page).locator('.sc-learn-step').first().boundingBox(),
    await page.locator('.sc-learn').boundingBox(),
  ];
  const before = await at();
  await card(page, 'Refine a shot').click();
  await expect(learn(page).locator('.sc-learn-title')).toHaveText('Refine a shot');
  expect(await at()).toEqual(before);
  // a link to one lesson opens that lesson, and Escape closes it all
  await page.goto(`/${slug}?learn=scene`);
  await expect(learn(page).locator('.sc-learn-title')).toHaveText('Build a scene');
  await page.keyboard.press('Escape');
  await expect(learn(page)).toHaveCount(0);
  await expect(learnButton(page)).toBeFocused();
  expect((await guideRecord(page)).active).toBeNull();
});

test('a lesson begun in Learn is paused and continued as it was', async ({ page }) => {
  await page.goto(`/${slug}?learn=presenter`);
  await action(page, 'Start').click();
  await page.waitForURL('**/presenters/new**');
  await expect(page.locator('.sc-pstudio .sc-coach-title')).toHaveText('Describe someone, or start from photos', {
    timeout: 20_000,
  });
  const since = (await guideRecord(page)).active?.since;
  // closing the guide pauses the task rather than dropping it
  await page.locator('.sc-pstudio .sc-coach').getByRole('button', { name: 'Close guide' }).click();
  await expect(page.locator('.sc-pstudio .sc-coach')).toHaveCount(0);
  await expect.poll(async () => (await guideRecord(page)).active?.paused).toBe(true);

  // Learn says it is in hand
  await page.goto(`/${slug}`);
  await learnButton(page).click();
  await expect(card(page, 'Create a presenter').locator('.sc-learn-status')).toHaveText('Step 1 of 4');
  await card(page, 'Create a presenter').click();
  await expect(learn(page).locator('.sc-learn-step[aria-current="step"] .sc-learn-step-name')).toHaveText(
    'Start a presenter',
  );
  // continuing it keeps the window it began with
  await action(page, 'Continue').click();
  await page.waitForURL('**/presenters/new**');
  await expect(page.locator('.sc-pstudio .sc-coach-title')).toHaveText('Describe someone, or start from photos', {
    timeout: 20_000,
  });
  const going = (await guideRecord(page)).active;
  expect(going).toMatchObject({ task: 'presenter', since });
  expect(going?.paused).toBeUndefined();
});

test('a lesson done from Learn is done there, and can be done again', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto(`/${slug}?learn=scene`);
  await action(page, 'Start').click();
  await expect(page).toHaveURL(/new=scene/);
  await expect(coachTitle(page)).toHaveText('Build a scene');
  await page.getByPlaceholder('Name this place').fill('Quiet terrace');
  await page.getByPlaceholder('What matters in these references, and what to ignore').fill('Low sun on stone');
  await page.getByRole('button', { name: 'Create scene' }).click();
  await expect.poll(async () => (await guideRecord(page)).done.scene, { timeout: 60_000 }).toBeTruthy();
  await expect.poll(async () => (await guideRecord(page)).active, { timeout: 20_000 }).toBeNull();

  await page.goto(`/${slug}`);
  await learnButton(page).click();
  await expect(card(page, 'Build a scene').locator('.sc-learn-status')).toHaveText('Done');
  await card(page, 'Build a scene').click();
  await expect(learn(page).locator('.sc-learn-step[data-state="done"]')).toHaveCount(3);
  await expect(action(page, 'Start again')).toBeVisible();
});

test('refining with no shot says so, and its one action makes a shot first', async ({ page }) => {
  await page.goto(`/${slug}?learn=refine`);
  await expect(learn(page)).toContainText('Refining starts from a shot you have made.');
  // a lesson that cannot begin says so where the others say how long they are
  await expect(card(page, 'Refine a shot').locator('.sc-learn-status')).toHaveText('Needs a shot');
  await action(page, 'Make a shot first').click();
  await walkToCreate(page);
  await expect(coachTitle(page)).toHaveText('Choose a product');
  expect((await guideRecord(page)).active?.task).toBe('first-shot');
});

test('a first refine begun from Learn ends when it is done, and does not begin again', async ({ page }) => {
  test.setTimeout(90_000);
  // the first shot the last test began, made
  await page.goto(`/${slug}/create`);
  await coachCard(page).getByRole('button', { name: 'Start' }).click();
  await pickTheIngredients(page);
  await page.keyboard.type('on a quiet stone step');
  await page.keyboard.press('Enter');
  await expect(coachTitle(page)).toHaveText('Your first shot', { timeout: 40_000 });
  await coachCard(page).getByRole('button', { name: 'Done' }).click();
  await expect.poll(async () => (await guideRecord(page)).active).toBeNull();

  await page.goto(`/${slug}?learn=refine`);
  await action(page, 'Start').click();
  await page.waitForURL('**/shots/**');
  await expect(page.locator('.sc-ovl .sc-coach .sc-coach-title')).toHaveText('Change one thing');
  await page.locator('.sc-ovl .sc-brief-line').click();
  await page.keyboard.type('softer shadows');
  await page.getByRole('button', { name: 'Refine', exact: true }).click();
  await expect(page.locator('.sc-ovl .sc-coach .sc-coach-title')).toHaveText('Here is the change', { timeout: 40_000 });
  await page.locator('.sc-ovl .sc-coach').getByRole('button', { name: 'Done' }).click();
  await expect.poll(async () => (await guideRecord(page)).done.refine).toBeTruthy();
  // ended here, not begun here again: the composer is still reached for, and
  // the record's tick arrives after the task lets go
  await page.waitForTimeout(1500);
  expect((await guideRecord(page)).active).toBeNull();
  await expect(page.locator('.sc-ovl .sc-coach')).toHaveCount(0);
});

test('on a phone Learn is the sheet, and every lesson a row', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  // no room in a phone's bar for a word: Help, which sits there, carries Learn
  await page.goto(`/${slug}`);
  await expect(learnButton(page)).toHaveCount(0);
  await page.locator('.sc-topbar .sc-help-btn').click();
  await page.getByRole('menuitem', { name: 'Learn' }).click();
  await expect(page).toHaveURL(/learn=lessons/);
  await expect(learn(page).locator('.sc-learn-row')).toHaveCount(5);
  // the list alone: a phone opens one lesson at a time, over it
  await expect(learn(page).locator('.sc-learn-lesson')).toHaveCount(0);
  const columns = await learn(page)
    .locator('.sc-learn-body')
    .evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length);
  expect(columns).toBe(1);
  // the sheet holds one height for both levels, so its top edge does not jump
  const top = async () => Math.round((await page.locator('.sc-learn').boundingBox())?.y ?? 0);
  // measured once the sheet has come up, not while it slides in
  await page.waitForTimeout(400);
  const before = await top();
  await card(page, 'Refine a shot').click();
  await expect(learn(page).locator('.sc-learn-lesson')).toBeVisible();
  await page.waitForTimeout(200);
  expect(Math.abs((await top()) - before)).toBeLessThanOrEqual(1);
  // back lands on the row just read
  await learn(page).getByRole('button', { name: 'All lessons' }).click();
  await expect(card(page, 'Refine a shot')).toBeFocused();
  await expect(coachCard(page)).toHaveCount(0);
});
