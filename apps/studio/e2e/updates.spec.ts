import { test, expect, type Page } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The update lifecycle, driven end to end against a real server and a fixture
 * npm registry. The shared e2e server runs with the check disabled, so this
 * spec boots its own scenri (tsx, from source) with SCENRI_REGISTRY pointed at
 * a tiny local registry whose answer the tests control. Selects by the sc-
 * class names the app ships, like every other spec.
 */

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));

class Fixture {
  server!: ChildProcess;
  registry!: Server;
  home!: string;
  port: number;
  regPort: number;
  latest: string;
  down = false;

  constructor(port: number, regPort: number, latest: string) {
    this.port = port;
    this.regPort = regPort;
    this.latest = latest;
  }

  base(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  async start(): Promise<void> {
    this.registry = createServer((req, res) => {
      if (this.down) {
        res.statusCode = 500;
        res.end('{}');
        return;
      }
      if (req.url?.includes('/-/package/')) {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ latest: this.latest }));
        return;
      }
      res.statusCode = 404;
      res.end('{}');
    });
    await new Promise<void>((r) => this.registry.listen(this.regPort, '127.0.0.1', r));

    this.home = mkdtempSync(join(tmpdir(), 'sc-e2e-upd-'));
    this.server = spawn('pnpm', ['exec', 'tsx', 'packages/cli/src/index.ts', 'serve'], {
      cwd: ROOT,
      stdio: 'ignore',
      env: {
        ...process.env,
        SCENRI_PORT: String(this.port),
        SCENRI_HOST: '127.0.0.1',
        SCENRI_HOME: this.home,
        SCENRI_NO_OPEN: '1',
        SCENRI_DEMO_ENGINE: '1',
        SCENRI_NO_UPDATE_CHECK: '0',
        SCENRI_REGISTRY: `http://127.0.0.1:${this.regPort}`,
      },
    });
    // up when /api/version answers
    for (let i = 0; i < 100; i++) {
      try {
        const r = await fetch(`${this.base()}/api/version`);
        if (r.ok) break;
      } catch {
        /* not yet */
      }
      await new Promise((r) => setTimeout(r, 300));
    }
    const made = await fetch(`${this.base()}/api/brands`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ brand: { specVersion: '0.1', meta: { name: 'Acme' } } }),
    });
    if (!made.ok) throw new Error(`brand seed failed: ${made.status}`);
  }

  /**
   * A server that has not actually let go of the library races the rmSync that
   * takes it away, and loses: sqlite is still flushing its WAL, so the
   * directory refills between the walk and the rmdir and Node reports
   * ENOTEMPTY. SIGTERM alone cannot promise that, because the timeout used to
   * resolve whether or not the process had gone. Escalate to SIGKILL like
   * harness.ts does, and let rmSync retry the last of it.
   */
  async stop(): Promise<void> {
    if (this.server.exitCode === null) {
      this.server.kill('SIGTERM');
      await new Promise<void>((r) => {
        this.server.once('exit', () => r());
        setTimeout(() => {
          this.server.kill('SIGKILL');
          r();
        }, 4000).unref();
      });
    }
    await new Promise<void>((r) => this.registry.close(() => r()));
    rmSync(this.home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

const float = (p: Page) => p.locator('.sc-upd-float');
const dot = (p: Page) => p.locator('.sc-org-btn .sc-upd-dot');
const aboutRows = (p: Page) => p.locator('.sc-set .sc-set-row');

test.describe
  .serial('an update is available', () => {
    const fx = new Fixture(4767, 4768, '0.99.0');
    test.beforeAll(async () => {
      await fx.start();
    });
    test.afterAll(async () => {
      await fx.stop();
    });

    test('the float announces it: one sentence, Not now, Update — plus dot and menu row', async ({ page }) => {
      await page.goto(`${fx.base()}/`);
      await expect(float(page)).toBeVisible();
      await expect(float(page)).toContainText('A new update is available');
      await expect(float(page).locator('.sc-btn')).toHaveText(['Update']);
      await expect(float(page).locator('.sc-upd-float-later')).toHaveText('Not now');
      await expect(dot(page)).toBeVisible();

      await page.locator('.sc-org-btn').click();
      await expect(page.locator('.sc-menu-item[data-update]')).toContainText('Update available · 0.99.0');
      await page.keyboard.press('Escape');
    });

    test("Settings → About opens the canonical What's new dialog", async ({ page }) => {
      // straight to the brand path: the / redirect drops query params
      await page.goto(`${fx.base()}/acme?settings=about`);
      await expect(page.locator('.sc-set .sc-tag-gold')).toHaveText('0.99.0 available');

      // what is in the version you do NOT have is one link, not a second
      // renderer: the notes that ship inside a build describe that build
      await expect(
        aboutRows(page).filter({ hasText: 'Updates' }).locator('a[href*="releases/tag/v0.99.0"]'),
      ).toHaveText("See what's in 0.99.0");

      // the row is permanent now — it is about the version you are running,
      // not the one on offer, so it does not come and go with the update check
      const row = aboutRows(page).filter({ hasText: "What's new" });
      await row.locator('button', { hasText: 'Show' }).click();
      await expect(page.locator('.sc-wn')).toBeVisible();
      // the surface is the title; the version is a quiet fact under it
      await expect(page.getByRole('dialog')).toHaveAccessibleName("What's new");
      await page.keyboard.press('Escape');
      await expect(page.locator('.sc-wn')).toHaveCount(0);

      // running from source in this spec, so the update row is git guidance
      await expect(aboutRows(page).filter({ hasText: 'Update' }).first()).toBeVisible();
    });

    test('Not now holds for this session, and asks again next launch', async ({ page, browser }) => {
      await page.goto(`${fx.base()}/`);
      await float(page).locator('.sc-upd-float-later').click();
      await expect(float(page)).toHaveCount(0);
      await expect(dot(page)).toHaveCount(0);

      await page.reload();
      await expect(page.locator('.sc-greet')).toBeVisible();
      await expect(float(page)).toHaveCount(0);

      // the menu row stays: declined is quiet, not gone
      await page.locator('.sc-org-btn').click();
      await expect(page.locator('.sc-menu-item[data-update]')).toBeVisible();
      await page.keyboard.press('Escape');

      // a fresh session is a fresh launch, and the offer comes back. "Not now"
      // is a pause, not a permanent silence — only updating ends it.
      const next = await browser.newContext();
      const fresh = await next.newPage();
      await fresh.goto(`${fx.base()}/`);
      await expect(fresh.locator('.sc-upd-float')).toBeVisible();
      await next.close();
    });
  });

test.describe
  .serial('the registry cannot be reached', () => {
    const fx = new Fixture(4769, 4770, '0.99.0');
    test.beforeAll(async () => {
      fx.down = true;
      await fx.start();
    });
    test.afterAll(async () => {
      await fx.stop();
    });

    test('the app stays quiet and About says so only when asked', async ({ page }) => {
      await page.goto(`${fx.base()}/`);
      await expect(page.locator('.sc-greet')).toBeVisible();
      await expect(float(page)).toHaveCount(0);

      // straight to the brand path: the / redirect drops query params
      await page.goto(`${fx.base()}/acme?settings=about`);
      await page.locator('.sc-set button', { hasText: 'Check for updates' }).first().click();
      await expect(page.locator('.sc-set .sc-tag', { hasText: "couldn't reach npm" })).toBeVisible();
    });
  });
