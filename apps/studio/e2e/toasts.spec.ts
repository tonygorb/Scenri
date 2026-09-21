import { test, expect, type Page } from '@playwright/test';
import { isolate } from './harness.js';
import { currentBrand } from './realtime.js';

/**
 * The toast stack as a person meets it: persistence, grouping, the cap.
 * Isolated unit tests own the timers. The no-toast-by-design case lives on
 * the presenter wall (presenter-realtime: duplicating does not toast).
 */

isolate();

type Probe = (t: { kind: 'info' | 'success' | 'warning' | 'error'; title: string; detail?: string }) => void;

async function probe(page: Page): Promise<void> {
  await page.addInitScript(() => localStorage.setItem('scenri:toast-probe', '1'));
}

async function push(page: Page, t: Parameters<Probe>[0]): Promise<void> {
  await page.evaluate((toast) => {
    const fn = (window as unknown as { __scenriToast?: Probe }).__scenriToast;
    if (!fn) throw new Error('toast probe is not mounted');
    fn(toast);
  }, t);
}

test('an error stays until it is dismissed; a success leaves on its own', async ({ page }) => {
  await probe(page);
  const brand = await currentBrand(page);
  await page.goto(`/${brand.slug}`);
  await expect(page.locator('.sc-toasts')).toBeAttached();

  await push(page, { kind: 'success', title: 'Archived' });
  await push(page, { kind: 'error', title: 'Could not save the brand' });
  await expect(page.locator('.sc-toast[data-kind="success"]')).toBeVisible();
  await expect(page.locator('.sc-toast[data-kind="error"]')).toBeVisible();

  await expect(page.locator('.sc-toast[data-kind="success"]')).toHaveCount(0, { timeout: 9000 });
  await expect(page.locator('.sc-toast[data-kind="error"]')).toBeVisible();

  await page.locator('.sc-toast[data-kind="error"] .sc-toast-x').click();
  await expect(page.locator('.sc-toast[data-kind="error"]')).toHaveCount(0);
});

test('identical events share one card; the stack never grows past three', async ({ page }) => {
  await probe(page);
  const brand = await currentBrand(page);
  await page.goto(`/${brand.slug}`);

  await push(page, { kind: 'warning', title: 'Only images can be attached here' });
  await push(page, { kind: 'warning', title: 'Only images can be attached here' });
  await push(page, { kind: 'warning', title: 'Only images can be attached here' });
  await expect(page.locator('.sc-toast')).toHaveCount(1);
  await expect(page.locator('.sc-toast-n')).toHaveText('×3');

  await push(page, { kind: 'info', title: 'Guide closed' });
  await push(page, { kind: 'info', title: 'Starting from this shot' });
  await push(page, { kind: 'info', title: 'That example is no longer available' });
  await expect(page.locator('.sc-toast')).toHaveCount(3);
  await expect(page.locator('.sc-toast', { hasText: 'Only images can be attached here' })).toHaveCount(0);
});
