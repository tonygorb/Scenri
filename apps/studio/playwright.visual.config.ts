import { defineConfig, devices } from '@playwright/test';

/**
 * Visual-regression harness for the CSS restructure (docs/migrations/css-restructure/).
 *
 * Separate config on purpose: the normal e2e projects glob `./e2e`, this one
 * globs `./visual`, so neither run ever picks up the other's specs. Same
 * server contract as e2e: each spec file boots its own scenri on 4757 via
 * e2e/harness.ts, so there is deliberately no `webServer` here either, and the
 * studio must be built first (`pnpm build`).
 *
 * Baselines live in visual/__screenshots__/ — gitignored, darwin-local, never
 * regenerated mid-migration: the golden set is captured once from the
 * pre-restructure CSS and every chunk compares against it.
 */
export default defineConfig({
  testDir: './visual',
  timeout: 30_000,
  expect: {
    timeout: 10_000,
    toHaveScreenshot: {
      // Finishes CSS animations and transitions before the shot; the infinite
      // sc-shimmer loop would never settle otherwise. JS-driven time is frozen
      // separately via page.clock in visual/shared.ts.
      animations: 'disabled',
      // Pixel-perfect is the whole point. Any per-shot exception must be
      // documented in docs/migrations/css-restructure/surface-matrix.md.
      maxDiffPixels: 0,
    },
  },
  snapshotDir: './visual/__screenshots__',
  snapshotPathTemplate: '{snapshotDir}/{projectName}/{arg}{ext}',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${process.env.SCENRI_E2E_PORT ?? 4757}`,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'visual-desktop',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1512, height: 982 },
        deviceScaleFactor: 1,
      },
      testIgnore: /phone\.spec\.ts/,
    },
    {
      name: 'visual-phone',
      use: {
        ...devices['Pixel 5'],
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 1,
      },
      testMatch: /phone\.spec\.ts/,
    },
  ],
});
