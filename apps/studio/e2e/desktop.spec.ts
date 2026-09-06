import { test, expect, type Page } from '@playwright/test';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isolate } from './harness.js';

/**
 * The desktop launcher's two browser surfaces: the starting page a cold
 * double-click shows, and the Desktop shortcut and Quit rows in Settings >
 * About. The shared server runs from source, so About shows the source
 * sentence and no Add button here; adding is covered by the CLI suites and the
 * real-machine QA. Quit really stops this spec's server, so it goes last.
 */

isolate();

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const STARTING = pathToFileURL(join(ROOT, 'packages', 'cli', 'launcher', 'starting.html')).href;
const rows = (p: Page) => p.locator('.sc-set .sc-set-row');

test.describe
  .serial('the desktop launcher', () => {
    test('the starting page hands the browser to the studio once the server answers', async ({ page, baseURL }) => {
      await page.goto(`${STARTING}#${baseURL}/`);
      await expect(page).toHaveURL(new RegExp(`^${baseURL}/`), { timeout: 15_000 });
      await expect(page.locator('.sc-greet, .sc-wiz').first()).toBeVisible();
    });

    test('the starting page refuses to send anyone anywhere but loopback', async ({ page }) => {
      await page.goto(`${STARTING}#https://example.com/`);
      await expect(page.locator('h1')).toHaveText('Scenri did not start');
      await expect(page.locator('#text')).toContainText('opened by Scenri itself');
    });

    test('About explains the shortcut row from source and offers no button there', async ({ page, baseURL }) => {
      await page.goto(`${baseURL}/acme?settings=about`);
      const row = rows(page).filter({ hasText: 'Desktop shortcut' });
      await expect(row).toContainText('Running from source; nothing to put on a desktop.');
      await expect(row.locator('button')).toHaveCount(0);
    });

    test('Quit is a keyboard-reachable button behind a confirm, and it stops the server', async ({ page, baseURL }) => {
      await page.goto(`${baseURL}/acme?settings=about`);
      const button = rows(page).filter({ hasText: 'Quit' }).locator('button', { hasText: 'Quit Scenri' });
      await button.focus();
      await expect(button).toBeFocused();
      await page.keyboard.press('Enter');
      const dialog = page.getByRole('alertdialog');
      await expect(dialog).toBeVisible();
      await dialog.locator('button', { hasText: 'Quit Scenri' }).click();
      const overlay = page.locator('.sc-upd-stopped');
      await expect(overlay).toBeVisible();
      await expect(overlay).toContainText('Scenri has stopped');
      // Over the dialog it was asked from, not behind it: the card must win the
      // hit test at the centre of the screen, where Settings used to be.
      await expect
        .poll(() =>
          page.evaluate(() =>
            Boolean(document.elementFromPoint(innerWidth / 2, innerHeight / 2)?.closest('.sc-upd-stopped')),
          ),
        )
        .toBe(true);
      await expect
        .poll(
          async () => {
            try {
              return (await fetch(`${baseURL}/api/version`)).status;
            } catch {
              return 0;
            }
          },
          { timeout: 10_000 },
        )
        .toBe(0);
    });
  });
