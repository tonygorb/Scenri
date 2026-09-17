import { test, expect, type Page } from '@playwright/test';
import { isolate } from './harness.js';
import {
  expectHeld,
  expectLetGo,
  learned,
  noWelcomeWait,
  pointsAt,
  setUpBrand,
  tourBack,
  tourCard,
  tourNext,
  tourTitle,
  welcome,
} from './firstUse.js';

/**
 * First use, end to end, on a home that was new at its first boot: the welcome,
 * the Home tour stop by stop and back again, the Create tour moving on as the
 * shot is made, and the refine row after it lands. What someone has learned
 * belongs to the install, so these run in order on one library.
 */
isolate({ brand: false, env: { SCENRI_NO_GUIDE: '0' } });
test.describe.configure({ mode: 'serial' });
test.beforeEach(({ page }) => noWelcomeWait(page));

const SLUG = 'first-shot';
const line = (p: Page) => p.locator('.sc-brief-line').first();

test('setup, the welcome, and the Home tour stop by stop, with Back', async ({ page }) => {
  await setUpBrand(page, 'First Shot');
  await expect(welcome(page)).toBeVisible();
  await expect(welcome(page).getByText('Welcome to')).toBeVisible();
  await expect(
    welcome(page).getByText('Product shots on brand, from your products, presenters, scenes and brand kit.'),
  ).toBeVisible();
  await expect(welcome(page).locator('.sc-welcome-pics img')).toHaveCount(3);
  await welcome(page).getByRole('button', { name: 'Take the tour' }).click();

  await expect(tourTitle(page)).toHaveText('Every shot starts as a brief');
  await expect(page.locator('.sc-tour-count')).toHaveText(/1\D+3/);
  await expect(tourBack(page)).toHaveCount(0);
  await pointsAt(page, '.sc-create-grid');
  await expectHeld(page);

  await tourNext(page).click();
  await expect(tourTitle(page)).toHaveText('Finished shots are recipes');
  await tourBack(page).click();
  await expect(tourTitle(page)).toHaveText('Every shot starts as a brief');
  await tourNext(page).click();
  await expect(tourTitle(page)).toHaveText('Finished shots are recipes');
  await tourNext(page).click();
  await expect(tourTitle(page)).toHaveText('Where your shots are kept');
  await pointsAt(page, '[data-tour="nav.create"]');
  await expect(tourNext(page)).toHaveText('Done');
  await tourNext(page).click();
  await expect(tourCard(page)).toHaveCount(0);
  await expectLetGo(page);
  await expect.poll(() => learned(page)).toEqual(['welcome', 'tour-home']);
});

test('the Create tour moves on as the shot is made, and the refine row follows the first shot', async ({ page }) => {
  await page.goto(`/${SLUG}/create`);
  await expect(tourTitle(page)).toHaveText('Bring in what stays the same');
  await pointsAt(page, '[data-tour="create.add"]');

  // Pressing the + is the step; the panel it opens hides the tour and lets the page go until it closes.
  await page.locator('[data-tour="create.add"]').click();
  await expect(page.locator('.sc-attachpanel')).toBeVisible();
  await expect(tourCard(page)).toHaveCount(0);
  await expectLetGo(page);
  await page.locator('.sc-ap-close').click();
  await expect(tourTitle(page)).toHaveText('Art-direct in words');

  // Writing in the window is the real composer; the lesson stays until it is read.
  await line(page).click();
  await page.keyboard.type('A glass bottle on wet slate');
  await expect(line(page)).toContainText('A glass bottle on wet slate');
  await expect(tourTitle(page)).toHaveText('Art-direct in words');
  await tourNext(page).click();
  await expect(tourTitle(page)).toHaveText('Make the shot, then refine it');

  const answered = page.waitForResponse((r) => r.url().endsWith('/api/nodes') && r.request().method() === 'POST');
  await page.locator('[data-tour="create.generate"]').click();
  await answered;
  await expect(tourCard(page)).toHaveCount(0);
  await expectLetGo(page);
  await expect.poll(() => learned(page)).toContain('tour-create');

  await expect(page.locator('.sc-cell-open').first()).toBeVisible({ timeout: 60_000 });
  await line(page).click();
  await expect(page.locator('.sc-banner[data-tone="hint"]')).toHaveText(
    'To refine a shot, open it and say what to change.',
  );
  await page.locator('.sc-cell-open').first().click();
  await page.waitForURL((u) => u.pathname.startsWith(`/${SLUG}/create/shots/`));
  await expect.poll(() => learned(page)).toContain('refine');
});

test('once learned, nothing speaks again, even after a reload', async ({ page }) => {
  await page.goto(`/${SLUG}/create`);
  await expect(page.locator('.sc-cell-open').first()).toBeVisible();
  await line(page).click();
  await page.waitForTimeout(600);
  await expect(page.locator('.sc-tour, .sc-welcome, .sc-banner[data-tone="hint"]')).toHaveCount(0);
  await page.goto(`/${SLUG}`);
  await page.waitForTimeout(600);
  await expect(page.locator('.sc-tour, .sc-welcome')).toHaveCount(0);
});
