import { execSync } from 'node:child_process';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * Two artifacts from one source tree.
 *
 *   vite build              __SC_ALPHA__ false  ->  npm publish              ->  npx scenri
 *   vite build --mode alpha __SC_ALPHA__ true   ->  npm publish --tag alpha  ->  npx scenri@alpha
 *
 * The public build must contain no feedback code at all: `define` turns the
 * flag into the literal `false`, so `if (__SC_ALPHA__)` is `if (false)` and
 * esbuild drops the branch and everything only it reaches. The issue URL is
 * blanked the same way, so the public bundle cannot even name the repo.
 */
export default defineConfig(({ mode, command }) => {
  // `command === 'serve'` is the dev server, where the layer should always be
  // present: dev is where it gets built and looked at. Only a production
  // `vite build` without --mode alpha strips it, which is the artifact that
  // actually ships to npm.
  const alpha = mode === 'alpha' || command === 'serve';
  // A tarball has no .git. An unknown build id is better than a failed build.
  let head = 'unknown';
  try {
    head = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    /* not a checkout */
  }

  return {
    plugins: [react()],
    server: { proxy: { '/api': 'http://127.0.0.1:4747' } },
    build: { chunkSizeWarningLimit: 900 },
    define: {
      __SC_ALPHA__: JSON.stringify(alpha),
      __SC_ISSUE_URL__: JSON.stringify(alpha ? (process.env.SC_ISSUE_URL ?? '') : ''),
      __SC_BUILD__: JSON.stringify(alpha ? `${head}-alpha` : head),
    },
  };
});
