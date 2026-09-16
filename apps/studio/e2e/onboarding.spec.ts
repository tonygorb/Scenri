import { test, expect, type Page } from '@playwright/test';
import { isolate } from './harness.js';
import { learned, noWelcomeWait, setUpBrand, tourCard, tourTitle, welcome } from './firstUse.js';

/**
 * First use, end to end, on a home that was new at its first boot: the welcome,
 * the Home tour stop by stop, the Create tour moving on as the shot is made,
 * and the refine row after it lands. What someone has learned belongs to the
 * install, so these run in order on one library.
 */
isolate({ brand: false, env: { SCENRI_NO_GUIDE: '0' } });
test.describe.configure({ mode: 'serial' });
test.beforeEach(({ page }) => noWelcomeWait(page));

const SLUG = 'first-shot';
const line = (p: Page) => p.locator('.sc-brief-line').first();

test('setup, the welcome, and the Home tour stop by stop', async ({ page }) => {
  await setUpBrand(page, 'First Shot');
  await expect(welcome(page)).toBeVisible();
  await expect(welcome(page).getByText('Welcome to')).toBeVisible();
  await expect(welcome(page).locator('.sc-welcome-pics img')).toHaveCount(3);
  await welcome(page).getByRole('button', { name: 'Take the tour' }).click();

  await expect(tourTitle(page)).toHaveText('Start here');
  await expect(page.locator('.sc-tour-count')).toHaveText('1 of 3');
  await page.locator('.sc-tour-next').click();
  await expect(tourTitle(page)).toHaveText('Or start from an example');
  await page.locator('.sc-tour-next').click();
  await expect(tourTitle(page)).toHaveText('Your shots live in Create');
  await expect(page.locator('.sc-tour-next')).toHaveText('Done');
  await page.locator('.sc-tour-next').click();
  await expect(tourCard(page)).toHaveCount(0);
  await expect.poll(() => learned(page)).toEqual(['welcome', 'tour-home']);
});

test('the Create tour moves on as the shot is made, and the refine row follows the first shot', async ({ page }) => {
  await page.goto(`/${SLUG}/create`);
  await expect(tourTitle(page)).toHaveText('Add what goes in the shot');
  await expect(page.locator('.sc-tour-body')).toHaveText(
    'Press + for a product, a presenter or a scene, or type $, @ or / in the prompt.',
  );

  // Pressing the + is the step; the panel it opens hides the tour until it closes.
  await page.locator('[data-tour="create.add"]').click();
  await expect(page.locator('.sc-attachpanel')).toBeVisible();
  await expect(tourCard(page)).toHaveCount(0);
  await page.locator('.sc-ap-close').click();
  await expect(tourTitle(page)).toHaveText('Say what you want');

  await line(page).click();
  await page.keyboard.type('A glass bottle on wet slate');
  await expect(tourTitle(page)).toHaveText('Make it');

  const answered = page.waitForResponse((r) => r.url().endsWith('/api/nodes') && r.request().method() === 'POST');
  await page.locator('[data-tour="create.generate"]').click();
  await answered;
  await expect(tourCard(page)).toHaveCount(0);
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
