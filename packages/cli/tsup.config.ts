import { defineConfig } from 'tsup';

/**
 * The nine `@scenri/*` workspace packages are never published, so the CLI has to
 * carry them: `noExternal` inlines their source into this bundle. Everything
 * that comes from npm stays external and is installed normally, which matters
 * most for `better-sqlite3` and `sharp`, whose native binaries cannot be
 * bundled at all.
 *
 * Note that inlining those packages promotes *their* npm dependencies into this
 * package's own dependencies. Keep `package.json` in step: ajv, ajv-formats and
 * cheerio arrive with @scenri/brand, node-html-parser with @scenri/catalog, and
 * better-sqlite3 with @scenri/core.
 */
export default defineConfig({
  entry: ['src/index.ts'],
  outDir: 'dist',
  format: ['esm'],
  platform: 'node',
  target: 'node20',
  noExternal: [/^@scenri\//],
  clean: true,
  sourcemap: true,
  // src/index.ts already carries the shebang; keep it executable after bundling.
  banner: {},
  splitting: false,
  treeshake: true,
});
