import { defineConfig, devices } from '@playwright/test';
import { laneEnv } from '../../packages/cli/scripts/worktree.js';

/**
 * What's New pictures (`pnpm capture:whatsnew`), shot from the real built
 * studio on an empty home, one Scenri per file through e2e/harness.ts, the
 * way the suite runs. Its own port band, 90 above the lane's e2e base, so a
 * capture can run beside the suite. Only `capture/*.capture.ts` match, so the
 * e2e and CI configs never pick these up. Build first: the CLI serves `dist`.
 *
 * Every picture is taken in a 1920x1080 window (16:9) and written at
 * 1920x1080: the whole window, or a component isolated from it on a clear
 * canvas (capture/shoot.ts). The window is drawn at three device pixels to the
 * CSS pixel, so a whole window is downscaled into the file and an isolated
 * component is enlarged at most to those three pixels, never past them: every
 * edge of it stays as sharp as the app draws it.
 */
process.env.SCENRI_E2E_PORT = String(Number(laneEnv().SCENRI_E2E_PORT ?? 4757) + 90);

export default defineConfig({
  testDir: './capture',
  testMatch: /\.capture\.ts$/,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    ...devices['Desktop Chrome'],
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 3,
    colorScheme: 'dark',
    contextOptions: { reducedMotion: 'reduce' },
    locale: 'en-GB',
    timezoneId: 'UTC',
    trace: 'off',
    screenshot: 'off',
  },
});
