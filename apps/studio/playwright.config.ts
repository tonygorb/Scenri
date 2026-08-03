import { defineConfig, devices } from '@playwright/test';

/**
 * Runs against a real scenri server, because the whole point of this suite
 * is behaviour that only exists in a real browser: trusted clicks, focus and
 * the editing caret. Start one with `scenri studio` (or `pnpm dev`) on 4747.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 20_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.BT_URL ?? 'http://127.0.0.1:4747',
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
