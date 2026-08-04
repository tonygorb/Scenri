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
      SCENRI_PORT: String(PORT),
      SCENRI_HOME: process.env.SCENRI_E2E_HOME ?? join(tmpdir(), 'scenri-e2e'),
    },
  },
  projects: [
    // A setup project rather than globalSetup: it is an ordinary test, so it
    // provably runs after webServer is up and can use the request fixture.
    { name: 'setup', testMatch: /seed\.setup\.ts/, timeout: 60_000 },
    { name: 'chromium', use: { ...devices['Desktop Chrome'] }, dependencies: ['setup'] },
  ],
});
