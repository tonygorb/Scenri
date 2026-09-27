import { test, expect } from '@playwright/test';
import { isolate } from './harness.js';

/**
 * The other half of Shut down (desktop.spec.ts has the first): a tab that has
 * not moved inside the studio since it opened, as the desktop icon's and npx's
 * tabs start, may be closed by its own page (the HTML standard's
 * "script-closable": one entry of session history). Scenri closes it, but only
 * once the server is gone. A file of its own: the test stops the file's server.
 */
isolate();

test('a tab with one entry closes itself once Scenri has stopped', async ({ page, baseURL }) => {
  const brands = await (await page.request.get('/api/brands')).json();
  // the way the desktop icon's starting page hands over: location.replace, one entry
  await page.evaluate((to) => location.replace(to), `${baseURL}/${brands[0].slug}`);
  await page.waitForURL(`**/${brands[0].slug}`);
  await expect(page.locator('.sc-org-btn')).toBeVisible();
  expect(await page.evaluate(() => history.length)).toBe(1);
  await page.locator('.sc-org-btn').click();
  await page.locator('.sc-menu-item[data-quit]').click();
  const closed = page.waitForEvent('close', { timeout: 20_000 });
  await page.getByRole('alertdialog').locator('button', { hasText: 'Shut down Scenri' }).click();
  await closed;
  // and the server really is gone: the tab never closes over a Scenri still running
  const answer = await fetch(`${baseURL}/api/version`).then(
    (r) => r.status,
    () => 0,
  );
  expect(answer).toBe(0);
});
