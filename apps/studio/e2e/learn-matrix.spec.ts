import { test, expect, type Page } from '@playwright/test';
import { isolate } from './harness.js';
import {
  coachCard,
  coachTitle,
  fromLearn,
  guideRecord,
  lessonRow,
  noWelcomeWait,
  ownBrand,
  pickTheIngredients,
  readTheOpening,
  setUpBrand,
  pointsAt,
  walkTheWay,
  welcome,
} from './firstUse.js';

/**
 * The remaining Learn/tutor matrix: start from the right page and the wrong
 * one, both refine entries already have their own file, Back on the way there,
 * resume vs Start again, and the same work done with the guide closed.
 */
isolate({ brand: false, env: { SCENRI_NO_GUIDE: '0', SCENRI_DEMO_BUILDS: '1', SCENRI_DEMO_REFS: '5' } });
test.describe.configure({ mode: 'serial' });

const learn = (p: Page) => p.getByRole('dialog').filter({ has: p.locator('.sc-learn-list, .sc-learn-lesson') });
const action = (p: Page, verb: string) => learn(p).getByRole('button', { name: new RegExp(`^${verb}:`) });

let slug = '';

test.beforeEach(async ({ page }) => {
  await noWelcomeWait(page);
  await page.setViewportSize({ width: 1440, height: 900 });
});

test('a brand with one shot is the start of the refine matrix', async ({ page }) => {
  test.setTimeout(90_000);
  slug = await setUpBrand(page, 'Matrix Co');
  await welcome(page).locator('.sc-welcome-foot').getByRole('button', { name: 'Not now' }).click();
  // a full goto remounts the studio; the decline has to be on the server
  // first or Create (a main page) asks the welcome again and Learn cannot
  // be reached
  await expect.poll(async () => (await guideRecord(page)).welcome).toBe('declined');
  await page.goto(`/${slug}/create`);
  await fromLearn(page, 'Make your first shot');
  await readTheOpening(page);
  await pickTheIngredients(page);
  await page.keyboard.type('on a quiet stone step');
  await page.keyboard.press('Enter');
  await expect(coachTitle(page)).toHaveText('Your first shot', { timeout: 40_000 });
  await coachCard(page).getByRole('button', { name: 'Done' }).click();
  await expect.poll(async () => (await guideRecord(page)).active).toBeNull();
});

test('refine begun on Create stays there and does not jump into a shot', async ({ page }) => {
  await page.goto(`/${slug}/create`);
  await fromLearn(page, 'Refine a shot');
  await expect(page).toHaveURL(new RegExp(`/${slug}/create`));
  await expect(page).not.toHaveURL(/\/shots\//);
  await expect(coachTitle(page)).toHaveText('Choose a shot to change');
});

test('refine begun on an open shot stays and asks for the change', async ({ page }) => {
  test.setTimeout(40_000);
  await page.request.post('/api/guide', { data: { finish: 'refine' } });
  await page.goto(`/${slug}/create`);
  await page.locator('.sc-feed .sc-cell-open').first().click();
  await page.waitForURL('**/shots/**');
  const here = new URL(page.url());
  here.searchParams.set('learn', 'refine');
  await page.goto(here.toString());
  // the overlay is a modal over the bar; the lesson is still the page's
  await page.locator('.sc-learn button.sc-learn-step').click({ force: true });
  await expect(page).toHaveURL(/\/shots\//);
  await expect(page.locator('.sc-ovl .sc-coach .sc-coach-title')).toHaveText('Change one thing', { timeout: 20_000 });
});

test('Back before choosing a shot asks for Create again', async ({ page }) => {
  test.setTimeout(40_000);
  await page.request.post('/api/guide', { data: { finish: 'refine' } });
  await page.goto(`/${slug}`);
  await fromLearn(page, 'Refine a shot');
  await walkTheWay(page, 'create', 'Your shots live in Create');
  await page.waitForURL('**/create**');
  await expect(coachTitle(page)).toHaveText('Choose a shot to change');
  await coachCard(page).getByRole('button', { name: 'Back' }).click();
  await page.waitForURL(new RegExp(`/${slug}/?$`));
  await expect(page).not.toHaveURL(/\/shots\//);
  await expect(coachTitle(page)).toHaveText('Your shots live in Create', { timeout: 20_000 });
});

test('closing refine mid-way and Continue restores Create, not a random shot', async ({ page }) => {
  test.setTimeout(40_000);
  await page.request.post('/api/guide', { data: { finish: 'refine' } });
  await page.goto(`/${slug}`);
  await fromLearn(page, 'Refine a shot');
  await walkTheWay(page, 'create', 'Your shots live in Create');
  await page.waitForURL('**/create**');
  await expect(coachTitle(page)).toHaveText('Choose a shot to change');
  await coachCard(page).getByRole('button', { name: 'Close guide' }).click();
  await expect(coachCard(page)).toHaveCount(0);
  await expect.poll(async () => (await guideRecord(page)).progress.refine?.paused).toBe(true);
  await page.goto(`/${slug}?learn=refine`);
  await action(page, 'Continue').click();
  await page.waitForURL('**/create**');
  await expect(page).not.toHaveURL(/\/shots\//);
  await expect(coachTitle(page)).toHaveText('Choose a shot to change');
});

test('Start again after a done refine walks Create again', async ({ page }) => {
  await page.request.post('/api/guide', { data: { finish: 'refine' } });
  await expect.poll(async () => (await guideRecord(page)).progress.refine).toBeUndefined();
  await page.goto(`/${slug}?learn=refine`);
  await learn(page).locator('button.sc-learn-step').click();
  await expect(page).toHaveURL(new RegExp(`/${slug}/?$`));
  await expect(page).not.toHaveURL(/\/shots\//);
  await expect(coachTitle(page)).toHaveText('Your shots live in Create');
});

test('a product begun on Products skips the way there and asks to start one', async ({ page }) => {
  const own = await ownBrand(page, 'Already There');
  await page.goto(`/${own}/products`);
  await fromLearn(page, 'Add your product');
  await expect(page).toHaveURL(/\/products/);
  await expect(page).not.toHaveURL(/new=product/);
  await expect(coachTitle(page)).toHaveText('Start a new product');
});

test('a product begun from Home never opens the dialog', async ({ page }) => {
  const own = await ownBrand(page, 'Walk Product');
  await page.goto(`/${own}`);
  await fromLearn(page, 'Add your product');
  await expect(page).toHaveURL(new RegExp(`/${own}$`));
  await expect(page).not.toHaveURL(/new=product/);
  await expect(coachTitle(page)).toHaveText('Your products live here');
});

test('the same product is added with the guide closed', async ({ page }) => {
  test.setTimeout(60_000);
  const own = await ownBrand(page, 'No Tutor Product');
  await page.goto(`/${own}`);
  await fromLearn(page, 'Add your product');
  await coachCard(page).getByRole('button', { name: 'Close guide' }).click();
  await expect(coachCard(page)).toHaveCount(0);
  await page.locator('[data-guide="nav.products"]:visible').first().click();
  await page.waitForURL('**/products');
  await page.locator('[data-guide="library.new"]:visible').first().click();
  await expect(page).toHaveURL(/new=product/);
  await page
    .locator('.sc-newdlg .sc-dropzone input[type="file"]')
    .first()
    .setInputFiles([
      {
        name: 'jug.png',
        mimeType: 'image/png',
        buffer: Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
          'base64',
        ),
      },
    ]);
  await page.getByPlaceholder('Name this product').fill('Ribbed jug');
  await page.getByRole('button', { name: 'Add product' }).click();
  await expect
    .poll(async () => {
      const brands = (await (await page.request.get('/api/brands')).json()) as { slug: string; id: string }[];
      const id = brands.find((b) => b.slug === own)?.id;
      const lib = (await (await page.request.get(`/api/brands/${id}/products-library`)).json()) as {
        products: { name: string }[];
      };
      return lib.products.some((p) => p.name === 'Ribbed jug');
    })
    .toBe(true);
  await expect(coachCard(page)).toHaveCount(0);
});

test('the same scene is added with the guide closed', async ({ page }) => {
  test.setTimeout(60_000);
  const own = await ownBrand(page, 'No Tutor Scene');
  await page.goto(`/${own}`);
  await page.locator('[data-guide="nav.scenes"]:visible').first().click();
  await page.waitForURL('**/scenes');
  await page.locator('[data-guide="library.new"]:visible').first().click();
  await expect(page).toHaveURL(/\/scenes\/new\/[a-f0-9]+$/);
  // a place said in full: the studio asks nothing more, reads it back, and draws on a press
  const studio = page.locator('.sc-pstudio[data-kind="scene"]');
  const line = studio.locator('.sc-pstudio-foot textarea');
  await line.fill('A cold hallway in hard side light, seen straight on, a bench against the wall');
  await line.press('Enter');
  await studio.getByRole('button', { name: 'Draw the scene' }).click({ timeout: 30_000 });
  await line.fill('Cold hallway');
  await line.press('Enter');
  await studio.getByRole('button', { name: 'Use this scene' }).click({ timeout: 30_000 });
  await expect
    .poll(async () => {
      const brands = (await (await page.request.get('/api/brands')).json()) as {
        json?: { scenes?: { name?: string }[] };
      }[];
      return brands.some((b) => (b.json?.scenes ?? []).some((s) => s.name === 'Cold hallway'));
    })
    .toBe(true);
});

test('Learn on 375 is the sheet, one lesson at a time', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const own = await ownBrand(page, 'Narrow Phone');
  await page.request.post('/api/guide', { data: { welcome: 'declined' } });
  await page.goto(`/${own}?learn=lessons`);
  await expect(learn(page).locator('.sc-learn-row')).toHaveCount(6);
  await expect(learn(page).locator('.sc-learn-lesson')).toHaveCount(0);
  await lessonRow(page, 'Refine a shot').click();
  await expect(learn(page).locator('.sc-learn-lesson')).toBeVisible();
  const columns = await learn(page)
    .locator('.sc-learn-body')
    .evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length);
  expect(columns).toBe(1);
});

for (const size of [
  { width: 390, height: 844 },
  { width: 1024, height: 768 },
]) {
  test(`at ${size.width} a library lesson still points at its own Add, for someone who already has one`, async ({
    page,
  }) => {
    // Under 1280 the library keeps its Add button in the bar's + menu; the
    // step that asks for it must bring it back, or the card has nothing to
    // point at and says nothing.
    await page.setViewportSize(size);
    const own = await ownBrand(page, `Has One ${size.width}`, 'product');
    await page.request.post('/api/guide', { data: { welcome: 'declined' } });
    await page.request.post('/api/guide', { data: { dismiss: 'product' } });
    await page.goto(`/${own}?learn=lessons`);
    await lessonRow(page, 'Add your product').click();
    await learn(page).locator('button.sc-learn-step').click();
    await walkTheWay(page, 'products', 'Your products live here');
    await page.waitForURL('**/products');
    await expect(coachTitle(page)).toHaveText('Start a new product', { timeout: 20_000 });
    await pointsAt(page, '[data-guide="library.new"]');
    await page.locator('[data-guide="library.new"]:visible').first().click();
    await expect(page).toHaveURL(/new=product/);
    await expect(page.locator('.sc-newdlg-layer .sc-coach .sc-coach-title')).toHaveText('Add your product');
    // the button goes back to the bar's menu once the step has moved on
    await page.locator('.sc-newdlg-layer').getByRole('button', { name: 'Close', exact: true }).first().click();
    await page.goto(`/${own}/products`);
    await coachCard(page)
      .getByRole('button', { name: 'Close guide' })
      .click()
      .catch(() => {});
    await expect(page.locator('[data-guide="library.new"]:visible')).toHaveCount(0);
  });
}

test('an alert during a live step stands above the curtain and can be closed, and the step still holds', async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem('scenri:toast-probe', '1'));
  const own = await ownBrand(page, 'Alert Over Step');
  await page.goto(`/${own}/create`);
  await readTheOpening(page);
  await expect(coachTitle(page)).toHaveText('Choose a product');
  await page.evaluate(() =>
    (window as unknown as { __scenriToast: (t: unknown) => void }).__scenriToast({
      kind: 'error',
      title: 'Could not import the store',
      detail: 'The store did not answer.',
    }),
  );
  const toast = page.locator('.sc-toast[data-kind="error"]');
  await expect(toast).toBeVisible();
  // drawn above the curtain: the topmost thing at its middle is the card itself
  expect(
    await toast.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return !!document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.closest('.sc-toast');
    }),
  ).toBe(true);
  await toast.locator('.sc-toast-x').click();
  await expect(toast).toHaveCount(0);
  await expect(coachTitle(page)).toHaveText('Choose a product');
  await page.locator('[data-guide="compose.add"]').click();
  await expect(page.locator('.sc-attachpanel')).toBeVisible();
});
