import { defineConfig, devices } from '@playwright/test';
import { laneEnv } from '../../packages/cli/scripts/worktree.js';

/**
 * What's New pictures (`pnpm capture:whatsnew`), shot from the real built
 * studio on an empty home, one Scenri per file through e2e/harness.ts, the
 * way the suite runs. Its own port band, 90 above the lane's e2e base, so a
 * capture can run beside the suite. Only `capture/*.capture.ts` match, so the
 * e2e and CI configs never pick these up. Build first: the CLI serves `dist`.
 */
process.env.SCENRI_E2E_PORT = String(Number(laneEnv().SCENRI_E2E_PORT ?? 4757) + 90);

export default defineConfig({
  testDir: './capture',
  testMatch: /\.capture\.ts$/,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    ...devices['Desktop Chrome'],
    // 16:10, the picture's own shape, at twice the pixels it is shown at
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    colorScheme: 'dark',
    contextOptions: { reducedMotion: 'reduce' },
    locale: 'en-GB',
    timezoneId: 'UTC',
    trace: 'off',
    screenshot: 'off',
  },
});
