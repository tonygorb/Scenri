import { test, expect, type Page } from '@playwright/test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isolate } from './harness.js';

/**
 * The desktop launcher's two browser surfaces: the starting page a cold
 * double-click shows, and the Desktop shortcut and Quit rows in Settings >
 * About. The shared server runs from source, so About shows the source
 * sentence and no Add button here; adding is covered by the CLI suites and the
 * real-machine QA. Shutting down really stops this spec's server, so it goes last.
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

    test('the page scenri open writes carries the studio URL in its meta, no fragment needed', async ({
      page,
      baseURL,
    }) => {
      // The same substitution open.ts makes; open(1) would drop a fragment.
      const rendered = readFileSync(fileURLToPath(STARTING), 'utf8').replace(
        '<meta name="scenri-studio" content="">',
        `<meta name="scenri-studio" content="${baseURL}/">`,
      );
      const dir = mkdtempSync(join(tmpdir(), 'sc-starting-'));
      const file = join(dir, 'starting.html');
      writeFileSync(file, rendered);
      try {
        await page.goto(pathToFileURL(file).href);
        await expect(page).toHaveURL(new RegExp(`^${baseURL}/`), { timeout: 15_000 });
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
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

    test('Shut down lives at the bottom of the brand menu, behind a confirm, stops the server and closes the tab', async ({
      page,
      baseURL,
    }) => {
      await page.goto(`${baseURL}/acme?settings=about`);
      // machine-level, so it is not a Settings row any more
      await expect(rows(page).filter({ hasText: /Quit|Shut down/ })).toHaveCount(0);
      // a fresh page rather than Escape: on the CI runner the closing dialog's
      // scroll layer still sat over the menu button when the click came
      await page.goto(`${baseURL}/acme`);
      await page.locator('.sc-org-btn').click();
      const item = page.locator('.sc-menu-item[data-quit]');
      await expect(item).toContainText('Shut down Scenri');
      // last thing in the menu: the way out sits at the bottom, under a hairline
      await expect(page.locator('.sc-menu-item').last()).toHaveAttribute('data-quit', '');
      await item.click();
      const dialog = page.getByRole('alertdialog');
      await expect(dialog).toBeVisible();
      await dialog.locator('button', { hasText: 'Shut down Scenri' }).click();
      // the tab goes away when the browser allows a page to close itself, and
      // is emptied to a blank page otherwise; either way nothing of Scenri is left
      await Promise.race([page.waitForEvent('close'), page.waitForURL('about:blank', { timeout: 10_000 })]);
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
