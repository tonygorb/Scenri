import { defineConfig } from 'tsup';

/**
 * No `@scenri/*` workspace package is published, so the CLI has to carry them:
 * `noExternal` inlines the source of every one it imports into this bundle.
 * (`@scenri/studio` is the exception, because it is not imported: it is a
 * separate vite build copied in as `studio-dist` by scripts/prepack.mjs.)
 * Everything that comes from npm stays external and is installed normally,
 * which matters most for `better-sqlite3` and `sharp`, whose native binaries
 * cannot be bundled at all.
 *
 * Note that inlining those packages promotes *their* npm dependencies into this
 * package's own dependencies. Keep `package.json` in step: ajv, ajv-formats and
 * cheerio arrive with @scenri/brand, node-html-parser with @scenri/catalog, and
 * better-sqlite3 with @scenri/core.
 */
export default defineConfig({
  // Two entries with splitting: the bin chunk keeps only argv handling and
  // node builtins, so `scenri --version` (and later the launcher) never loads
  // fastify or a native module. serve.ts is the heavy chunk, reached through
  // a dynamic import — `dist/index.js serve` is the frozen launcher contract.
  entry: ['src/index.ts', 'src/serve.ts'],
  outDir: 'dist',
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  noExternal: [/^@scenri\//],
  clean: true,
  // Local debugging only. These maps embed `sourcesContent` for everything
  // `noExternal` inlines above, which is every @scenri/* package, so shipping
  // them publishes the private source tree. `files` in package.json negates
  // `dist/**/*.map` and test/packSurface.test.ts fails if that negation goes.
  sourcemap: true,
  // src/index.ts already carries the shebang; keep it executable after bundling.
  banner: {},
  splitting: true,
  treeshake: true,
});
