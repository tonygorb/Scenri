import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

/**
 * Runs against a real scenri server, because the whole point of this suite is
 * behaviour that only exists in a real browser: trusted clicks, focus and the
 * editing caret.
 *
 * The server is started here rather than by hand, on a port and a home of its
 * own. That is deliberate: the suite must never read or write the library you
 * actually use, and it must never quietly pass because your `~/.scenri`
 * happens to hold the right brand. `seed.setup.ts` puts every fixture the
 * specs need into that empty home first.
 */
const PORT = Number(process.env.SCENRI_E2E_PORT ?? 4757);
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  timeout: 20_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: BASE_URL,
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'pnpm dev',
    cwd: '../..',
    url: `${BASE_URL}/api/engines`,
    // never adopt a running dev server: that one points at the real ~/.scenri
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      SCENRI_NO_OPEN: '1',
      // keep e2e on loopback so health checks do not need a LAN access token
      SCENRI_HOST: '127.0.0.1',
      SCENRI_PORT: String(PORT),
      SCENRI_HOME: process.env.SCENRI_E2E_HOME ?? join(tmpdir(), 'scenri-e2e'),
      // The seed needs one finished shot. The demo engine draws a placeholder
      // and costs nothing, and it is registered only because this says so.
      SCENRI_DEMO_ENGINE: '1',
      // The shared server must never reach the real npm registry.
      // updates.spec.ts spawns its own server against a fixture registry.
      SCENRI_NO_UPDATE_CHECK: '1',
    },
  },
  projects: [
    // A setup project rather than globalSetup: it is an ordinary test, so it
    // provably runs after webServer is up and can use the request fixture.
    { name: 'setup', testMatch: /seed\.setup\.ts/, timeout: 60_000 },
    // the touch cases below assert rules that only exist under pointer:coarse,
    // so a mouse must not be asked to satisfy them
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      testIgnore: /mobile\.spec\.ts/,
      dependencies: ['setup'],
    },
    // The composer row is the one piece of chrome that has to survive a hand's
    // width, so it gets real devices rather than a resized desktop: a phone
    // reports pointer:coarse, and the touch rules hang off that.
    { name: 'mobile', use: { ...devices['Pixel 5'] }, testMatch: /mobile\.spec\.ts/, dependencies: ['setup'] },
    {
      name: 'tablet',
      use: { ...devices['iPad Mini landscape'] },
      testMatch: /mobile\.spec\.ts/,
      dependencies: ['setup'],
    },
  ],
});
