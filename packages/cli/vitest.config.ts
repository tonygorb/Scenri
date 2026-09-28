import { defineConfig } from 'vitest/config';

/**
 * How long a test here may take on Windows. Many of these tests write for
 * real: a presenter set drawn sixty-five times, a catalog import of forty
 * products and a hundred and twenty pictures, a server drained on the way
 * out. The Windows CI runner does that disk and sqlite work 25 to 240 times
 * slower than a Mac (measured 2026-09-28: 827 ms here, 20 s there), so
 * vitest's own 5 s and 10 s defaults failed a different test on nearly every
 * Windows run, whichever one had no budget of its own that day. The files
 * that did (30 s and 60 s per describe) are the suite already paying this
 * cost one file at a time. Elsewhere the defaults stand, so a hung test
 * still fails fast on a Mac or Linux.
 */
const windows = process.platform === 'win32';

export default defineConfig({
  test: {
    testTimeout: windows ? 60_000 : 5_000,
    hookTimeout: windows ? 60_000 : 10_000,
  },
});
