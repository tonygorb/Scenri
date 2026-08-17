import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * scenri 0.1.0 and 0.1.1 shipped `dist/*.js.map` to npm. Because tsup.config.ts
 * inlines every `@scenri/*` package (`noExternal`), those maps carried
 * `sourcesContent` for the whole private source tree: core, catalog, brand, all
 * five engines and this package, 54 files of readable TypeScript. Both versions
 * were unpublished on 2026-08-17 and their numbers are burned.
 *
 * The fix is one negated pattern in `files`. These tests exist so deleting it
 * fails the suite instead of leaking the source again on the next publish.
 */

const pkgDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
const distDir = join(pkgDir, 'dist');
const builtMaps = existsSync(distDir) ? readdirSync(distDir).filter((f) => f.endsWith('.map')) : [];

describe('the published package surface', () => {
  it('excludes source maps, and still ships the bundle they belong to', () => {
    expect(pkg.files).toContain('dist');
    expect(pkg.files).toContain('!dist/**/*.map');
  });

  // Only meaningful when a build exists to be excluded. publish.yml runs the
  // tests before `pnpm build`, so in CI there is nothing on disk to check and
  // asserting on an empty dist would pass for the wrong reason.
  it.skipIf(builtMaps.length === 0)('packs no map, and every chunk that is not one', () => {
    const out = execFileSync('npm', ['pack', '--dry-run', '--ignore-scripts', '--json'], {
      cwd: pkgDir,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const packed: string[] = JSON.parse(out)[0].files.map((f: { path: string }) => f.path);

    expect(packed.filter((f) => f.endsWith('.map'))).toEqual([]);
    expect(packed).toContain('dist/index.js');
    // The negation must not have swallowed the bundle: tsup emits one .js per .map.
    expect(packed.filter((f) => f.startsWith('dist/') && f.endsWith('.js')).length).toBe(builtMaps.length);
  });
});
