import { test, expect, type Page } from '@playwright/test';
import { isolate } from './harness.js';
import {
  chips,
  coachCard,
  coachTitle,
  fromLearn,
  guideRecord,
  learnButton,
  noWelcomeWait,
  ownBrand,
  pickFromPicker,
  pickTheIngredients,
  readTheOpening,
  setUpBrand,
  startNew,
  walkTheWay,
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
    'Use it again',
    'Create a presenter',
    'Build a scene',
    'Refine a shot',
  ]);
  // where each stands, in a few words: a count of steps, never a time
  await expect(card(page, 'Create a presenter').locator('.sc-learn-status')).toHaveText('5 steps');
  await expect(card(page, 'Make your first shot').locator('.sc-learn-next')).toHaveText('Next');
  await expect(learn(page).locator('.sc-learn-next')).toHaveCount(1);
  // nothing of their own to use again yet, so that one says what it starts from
  await expect(card(page, 'Use it again').locator('.sc-learn-status')).toHaveText('Needs a product');
  // never a time: a word-boundary match, so a lesson may say "framing"
  await expect(learn(page)).not.toContainText(/\b(mins?|minutes?|hours?)\b/i);
  // pressed while open it shows it is the one open
  await expect(learnButton(page)).toHaveAttribute('data-on', 'true');

  // one lesson beside the list: its steps as outcomes, and the one step
  // that can be pressed, which is how it begins
  await card(page, 'Create a presenter').click();
  await expect(page).toHaveURL(/learn=presenter/);
  await expect(card(page, 'Create a presenter')).toHaveAttribute('aria-current', 'true');
  // the lesson's steps are the walk's own moments, one for one
  await expect(learn(page).locator('.sc-learn-step-name')).toHaveText([
    'Find where your presenters live',
    'Start a new one',
    'Describe someone, or add photos',
    'Decide the face',
    'Save them to the brand',
  ]);
  await expect(learn(page).locator('button.sc-learn-step')).toHaveCount(1);
  await expect(action(page, 'Start')).toHaveAccessibleName('Start: Find where your presenters live');
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
  await walkTheWay(page, 'presenters', 'Your presenters live here');
  await page.waitForURL('**/presenters');
  await startNew(page, 'Start a new presenter');
  await page.waitForURL('**/presenters/new**');
  await expect(page.locator('.sc-pstudio .sc-coach-title')).toHaveText('Describe someone, or start from photos', {
    timeout: 20_000,
  });
  const since = (await guideRecord(page)).active?.since;
  // closing the guide sets the lesson down rather than dropping it: nothing
  // is guiding, and the lesson keeps its own progress
  await page.locator('.sc-pstudio .sc-coach').getByRole('button', { name: 'Close guide' }).click();
  await expect(page.locator('.sc-pstudio .sc-coach')).toHaveCount(0);
  await expect.poll(async () => (await guideRecord(page)).progress.presenter?.paused).toBe(true);
  expect((await guideRecord(page)).active).toBeNull();

  // they have found the studio: Learn says Continue on the question in hand
  await page.goto(`/${slug}`);
  await learnButton(page).click();
  await expect(card(page, 'Create a presenter').locator('.sc-learn-status')).toHaveText('Step 3 of 5');
  // Next stays on the first lesson that is not done, not the later one in hand
  await expect(card(page, 'Make your first shot').locator('.sc-learn-next')).toHaveText('Next');
  await expect(card(page, 'Create a presenter').locator('.sc-learn-next')).toHaveCount(0);
  await card(page, 'Create a presenter').click();
  await expect(action(page, 'Continue')).toHaveAccessibleName('Continue: Describe someone, or add photos');
  // and taking it up again keeps the window it began with rather than
  // starting a new one: what the row says is not what the record holds
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
  await walkTheWay(page, 'scenes', 'Your scenes live here');
  await page.waitForURL('**/scenes');
  await startNew(page, 'Start a new scene');
  await expect(page).toHaveURL(/\/scenes\/new\/[a-f0-9]+$/);
  await expect(coachTitle(page)).toHaveText('Describe the place, or start from pictures');
  const line = page.locator('.sc-pstudio[data-kind="scene"] .sc-pstudio-foot textarea');
  await line.fill('A quiet stone terrace in low sun, the subject resting on the balustrade, mist lying low');
  await line.press('Enter');
  await page.getByRole('button', { name: 'Draw the scene' }).click();
  await page.getByRole('button', { name: 'Use this scene' }).click();
  await expect.poll(async () => (await guideRecord(page)).done.scene, { timeout: 60_000 }).toBeTruthy();
  await expect.poll(async () => (await guideRecord(page)).active, { timeout: 20_000 }).toBeNull();

  await page.goto(`/${slug}`);
  await learnButton(page).click();
  await expect(card(page, 'Build a scene').locator('.sc-learn-status')).toHaveText('Done');
  await card(page, 'Build a scene').click();
  await expect(learn(page).locator('.sc-learn-step[data-state="done"]')).toHaveCount(5);
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
  // nothing jumps: the first step is Create in the places, then the grid
  await expect(page).toHaveURL(new RegExp(`/${slug}$`));
  await walkTheWay(page, 'create', 'Your shots live in Create');
  await page.waitForURL('**/create**');
  await expect(coachTitle(page)).toHaveText('Choose a shot to change');
  await page.locator('.sc-feed .sc-cell-open').first().click();
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

test('refining also accepts Refine on the card, and both land on the same ask', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto(`/${slug}?learn=refine`);
  await action(page, 'Start again').click();
  await walkTheWay(page, 'create', 'Your shots live in Create');
  await page.waitForURL('**/create**');
  await expect(coachTitle(page)).toHaveText('Choose a shot to change');
  // a tile's tools show on hover, so reach for the tile first, as a person does
  const shot = page.locator('.sc-cell', { has: page.locator('.sc-cell-ctl.sc-cell-branch') }).first();
  await shot.hover();
  await shot.locator('.sc-cell-ctl.sc-cell-branch').click();
  await expect(page).not.toHaveURL(/\/shots\//);
  await expect(coachTitle(page)).toHaveText('Change one thing');
  await page.locator('[data-guide="compose"] .sc-brief-line').click();
  await page.keyboard.type('warmer light');
  await page.locator('[data-guide="compose.send"]').click();
  await expect(coachTitle(page)).toHaveText('Here is the change', { timeout: 40_000 });
  await coachCard(page).getByRole('button', { name: 'Done' }).click();
  await expect.poll(async () => (await guideRecord(page)).active).toBeNull();
});

test('using a saved product again is its own walk: the product, a place, the words', async ({ page }) => {
  test.setTimeout(90_000);
  // a brand of its own holding one product, which is what this lesson starts
  // from, opened the way anyone opens it: from the bar, on the page they are on
  const own = await ownBrand(page, 'Second Time');
  await page.goto(`/${own}`);
  await fromLearn(page, 'Use it again');
  await walkToCreate(page);

  // its own three asks, in its own order: what they saved, then somewhere else
  await expect(coachTitle(page)).toHaveText('Add the product you saved');
  await expect(coachCard(page).locator('.sc-coach-count')).toContainText('2 of 5');
  await page.locator('[data-guide="compose.add"]').click();
  await pickFromPicker(page, 'Product');
  await expect(coachTitle(page)).toHaveText('Put it somewhere else');
  await pickFromPicker(page, 'Scene');
  await expect(coachTitle(page)).toHaveText('Say how to shoot it, then make it');
  await page.keyboard.type('on a cold morning');
  await page.keyboard.press('Enter');

  // and it ends on the two pictures, not on one
  await expect(coachTitle(page)).toHaveText(/Making your shot|The same product, twice/, { timeout: 30_000 });
  await expect(coachTitle(page)).toHaveText('The same product, twice', { timeout: 40_000 });
  await coachCard(page).getByRole('button', { name: 'Done' }).click();
  await expect.poll(async () => (await guideRecord(page)).lessons.reuse).toBeTruthy();
});

test('a lesson part done stays part done when another is taken up', async ({ page }) => {
  test.setTimeout(90_000);
  const own = await ownBrand(page, 'Both At Once');
  await page.goto(`/${own}/create`);
  await readTheOpening(page);
  await pickTheIngredients(page);
  // five of the six: what you sell, who shows it, where, and the words
  await expect(coachTitle(page)).toHaveText('Say how to shoot it, then make it');
  await page.goto(`/${own}`);
  await learnButton(page).click();
  await expect(card(page, 'Make your first shot').locator('.sc-learn-status')).toHaveText('Step 5 of 6');

  // take up another lesson: the first keeps everything but the screen
  await card(page, 'Add your product').click();
  await action(page, 'Start').click();
  await expect(coachTitle(page)).toHaveText('Your products live here');
  await expect(page).not.toHaveURL(/new=product/);
  // Learn in the bar is under the coach catch; the address is how anyone
  // opens it without dismissing the walk
  await page.goto(`/${own}?learn=lessons`);
  await expect(card(page, 'Make your first shot').locator('.sc-learn-status')).toHaveText('Step 5 of 6');
  // the one just taken up is standing on its first step, so it reads as not
  // begun while its window is kept all the same (the record, at the end)
  await expect(card(page, 'Add your product').locator('.sc-learn-status')).toHaveText('3 steps');

  // and it is continued, not begun again: they have already walked Create,
  // so Continue restores that page and the ask they were on
  await card(page, 'Make your first shot').click();
  await expect(action(page, 'Continue')).toBeVisible();
  await action(page, 'Continue').click();
  await page.waitForURL('**/create**');
  await expect(coachTitle(page)).toHaveText('Say how to shoot it, then make it');
  await expect(chips(page)).toHaveCount(3);

  // each lesson holds its own progress, and one of them is guiding: this file
  // has left a presenter part done too, which is the point rather than a problem
  const record = await guideRecord(page);
  expect(Object.keys(record.progress)).toEqual(expect.arrayContaining(['first-shot', 'product']));
  expect(record.progress['first-shot']?.paused).toBeUndefined();
  expect(record.progress.product?.paused).toBe(true);
  expect(record.active?.task).toBe('first-shot');
});

test('on a phone Learn is the sheet, and every lesson a row', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  // no room in a phone's bar for a word: Help, the corner float, carries Learn
  await page.goto(`/${slug}`);
  await expect(learnButton(page)).toHaveCount(0);
  await page.locator('.sc-help-float .sc-help-btn').click();
  await page.getByRole('menuitem', { name: 'Learn' }).click();
  await expect(page).toHaveURL(/learn=lessons/);
  await expect(learn(page).locator('.sc-learn-row')).toHaveCount(6);
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
