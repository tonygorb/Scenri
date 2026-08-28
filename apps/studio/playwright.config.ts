import { defineConfig, devices } from '@playwright/test';

/**
 * Runs against a real Scenri server, because the whole point of this suite is
 * behaviour that only exists in a real browser: trusted clicks, focus and the
 * editing caret.
 *
 * There is deliberately no `webServer` here. A shared server means a shared
 * library, and a shared library is what made specs pass alone and fail in the
 * run. Each spec file starts its own Scenri on an empty home instead — see
 * `e2e/harness.ts` — so the suite can never read or write the library you
 * actually use, and can never quietly pass because the spec before it happened
 * to leave the right data behind. That is also why the suite parallelises
 * safely: the isolation is per file, not per run.
 *
 * The studio has to be built first: the CLI serves prebuilt `dist` and never
 * builds. `pnpm build`, then `pnpm --filter @scenri/studio test:e2e`.
 */
const PORT = Number(process.env.SCENRI_E2E_PORT ?? 4757);
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  timeout: 20_000,
  // 10s, not the 5s default: the assertions here wait on a real app booting
  // and painting, and on a loaded runner (a shared CI box, a dev machine with
  // servers beside the suite) a first paint measured over 5s has failed runs
  // whose code was fine. The per-test timeout above still bounds a real hang.
  expect: { timeout: 10_000 },
  // One retry on CI turns a runner hiccup into "flaky" instead of a red run
  // (the report still names it, so a pattern stays visible). Locally zero:
  // a developer machine should feel a real regression on the first run.
  retries: process.env.CI ? 1 : 0,
  // One file at a time per worker. `fullyParallel: false` is the part that
  // matters and it stays: a file's tests share that file's seeded library, so
  // they must run in order. The workers are independent of that, because
  // `e2e/harness.ts` gives each one its own port and each file its own home.
  // Each worker is a whole Scenri process, not a browser tab, so this is
  // deliberately below the core count: 4 on a developer machine, 2 on a CI
  // runner that is already running three shards of this file at once.
  fullyParallel: false,
  workers: Number(process.env.SCENRI_E2E_WORKERS ?? (process.env.CI ? 2 : 4)),
  reporter: [['list']],
  use: {
    baseURL: BASE_URL,
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
  },
  projects: [
    // the touch cases below assert rules that only exist under pointer:coarse,
    // so a mouse must not be asked to satisfy them
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      testIgnore: /mobile\.spec\.ts/,
    },
    // The composer row is the one piece of chrome that has to survive a hand's
    // width, so it gets real devices rather than a resized desktop: a phone
    // reports pointer:coarse, and the touch rules hang off that.
    { name: 'mobile', use: { ...devices['Pixel 5'] }, testMatch: /mobile\.spec\.ts/ },
    {
      name: 'tablet',
      use: { ...devices['iPad Mini landscape'] },
      testMatch: /mobile\.spec\.ts/,
      // An iPad is WebKit, and WebKit on a Linux runner is the slowest thing
      // here by some way — a cold `page.goto` has been measured at 9s where
      // chromium takes 1s. The 20s default left no room for that and failed a
      // navigation rather than an assertion, which says nothing about the app.
      timeout: 45_000,
    },
  ],
});
