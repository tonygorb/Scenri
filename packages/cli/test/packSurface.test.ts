import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Scenri 0.1.0 and 0.1.1 shipped `dist/*.js.map` to npm. Because tsup.config.ts
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

/**
 * npm on Windows is npm.cmd, which execFile cannot run and which this package
 * refuses to run through a shell (see update/stage.ts). npm-cli.js sits beside
 * node.exe on every standard install and on the CI runner, so run that.
 */
const npmArgv = (): [string, string[]] => {
  if (process.platform !== 'win32') return ['npm', []];
  const cli = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  if (!existsSync(cli)) throw new Error(`npm-cli.js not found beside ${process.execPath}`);
  return [process.execPath, [cli]];
};

let packedCache: { files: string[]; size: number } | undefined;
const packed = (): { files: string[]; size: number } => {
  if (!packedCache) {
    const [npm, pre] = npmArgv();
    const out = execFileSync(npm, [...pre, 'pack', '--dry-run', '--ignore-scripts', '--json'], {
      cwd: pkgDir,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    // npm 11 returns an array of results; npm 12 returns an object keyed by
    // package name. Accept both, so the guard survives the runner's npm.
    type PackResult = { files: { path: string }[]; size: number };
    const parsed = JSON.parse(out) as PackResult[] | Record<string, PackResult>;
    const result = Array.isArray(parsed) ? parsed[0] : parsed[pkg.name as string];
    if (!result) throw new Error('npm pack --json returned no result for this package');
    packedCache = { files: result.files.map((f) => f.path), size: result.size };
  }
  return packedCache;
};
const packedFiles = (): string[] => packed().files;

describe('the published package surface', () => {
  it('excludes source maps, and still ships the bundle they belong to', () => {
    expect(pkg.files).toContain('dist');
    expect(pkg.files).toContain('!dist/**/*.map');
  });

  it('excludes junk and authoring scripts, and ships the assets license', () => {
    expect(pkg.files).toContain('!templates/**/.DS_Store');
    expect(pkg.files).toContain('!templates/previews/*.mjs');
    expect(pkg.files).toContain('ASSETS-LICENSE.md');
  });

  // The desktop launcher's icons and bootstrap live in launcher/ and are
  // committed, so the tarball can prove they pack without a staged tree.
  it('lists the desktop launcher assets in files', () => {
    expect(pkg.files).toContain('launcher');
  });

  // The tarball listing is the same on every OS, and npm pack on the Windows
  // runner has taken over half a minute, so the listing is proven on POSIX.
  it.skipIf(process.platform === 'win32')(
    'ships the desktop launcher assets',
    () => {
      const files = packedFiles();
      for (const f of [
        'launcher/launch.mjs',
        'launcher/starting.html',
        'launcher/Scenri.icns',
        'launcher/scenri.ico',
      ]) {
        expect(files).toContain(f);
      }
    },
    30_000,
  );

  // dist inlines @scenri/brand (Apache-2.0), so its license text must travel
  // in the tarball next to the app's own — Apache-2.0 section 4(a).
  it('ships the Apache license for the inlined brand-spec code, and the changelog', () => {
    expect(pkg.files).toContain('LICENSE-APACHE-2.0-brand-spec');
    expect(pkg.files).toContain('CHANGELOG.md');
  });

  // The starter wall is a hard-coded id list in a build script; a catalog
  // rename would silently empty it. Bind every id to a real showcase entry.
  it('every starter showcase id resolves to a catalog entry', () => {
    const script = readFileSync(join(pkgDir, 'scripts', 'prepack.mjs'), 'utf8');
    const block = script.match(/STARTER_SHOWCASE = new Set\(\[([\s\S]*?)\]\)/);
    expect(block).not.toBeNull();
    const ids = [...(block as RegExpMatchArray)[1].matchAll(/'([a-z0-9-]+)'/g)].map((m) => m[1]);
    expect(ids.length).toBeGreaterThanOrEqual(10);
    for (const id of ids) {
      expect(existsSync(join(pkgDir, '..', '..', 'templates', 'showcase', `${id}.json`)), id).toBe(true);
    }
  });

  // Only meaningful when a build exists to be excluded. publish.yml runs the
  // tests before `pnpm build`, so in CI there is nothing on disk to check and
  // asserting on an empty dist would pass for the wrong reason.
  // The dry-run walks the whole staging copy; 30s covers a cold disk.
  it.skipIf(builtMaps.length === 0)(
    'packs no map, and every chunk that is not one',
    () => {
      const files = packedFiles();
      expect(files.filter((f) => f.endsWith('.map'))).toEqual([]);
      expect(files).toContain('dist/index.js');
      // The negation must not have swallowed the bundle: tsup emits one .js per .map.
      expect(files.filter((f) => f.startsWith('dist/') && f.endsWith('.js')).length).toBe(builtMaps.length);
    },
    30_000,
  );

  // The templates staging copy only exists after a prepack run, so like the map
  // check this can only assert against what is on disk. A pre-split staging
  // copy (it still carries previews/sets) would fail the surface tests for the
  // right reason at the wrong time, so it skips like a missing one.
  const stagedTemplates = join(pkgDir, 'templates');
  const stagingIsSplit = existsSync(stagedTemplates) && !existsSync(join(stagedTemplates, 'previews', 'sets'));
  it.skipIf(!stagingIsSplit)(
    'packs no .DS_Store anywhere, no map outside dist, and no authoring script',
    () => {
      const files = packedFiles();
      expect(files.filter((f) => f.endsWith('.DS_Store'))).toEqual([]);
      expect(files.filter((f) => f.endsWith('.map'))).toEqual([]);
      expect(files.filter((f) => f.startsWith('templates/') && f.endsWith('.mjs'))).toEqual([]);
    },
    30_000,
  );

  // The split contract: the whole catalog with its thumbnails ships, the heavy
  // imagery does not, and the tarball stays npx-sized. The full library
  // arrives at runtime via the content archive (src/content/fetch.ts).
  it.skipIf(!stagingIsSplit)(
    'ships the whole catalog with thumbnails only, and stays under 15 MB',
    () => {
      const repoTemplates = join(pkgDir, '..', '..', 'templates');
      const files = packedFiles();
      const looks = readdirSync(repoTemplates).filter((f) => f.endsWith('.json'));
      expect(looks.length).toBeGreaterThan(0);
      for (const f of looks) {
        expect(files).toContain(`templates/${f}`);
        expect(files).toContain(`templates/previews/${f.replace(/\.json$/, '.jpg')}`);
      }
      // no reference galleries, no product shots, no presenter identity sets
      expect(files.filter((f) => /^templates\/previews\/(?!presenters\/|showcase\/)[a-z0-9-]+\//.test(f))).toEqual([]);
      expect(files.filter((f) => f.startsWith('templates/previews/demo-products/'))).toEqual([]);
      expect(files.filter((f) => /^templates\/previews\/presenters\/[a-z0-9-]+\/.+/.test(f))).toEqual([]);
      // the starter wall: a real but bounded set of showcase heroes
      const heroes = files.filter((f) => f.startsWith('templates/previews/showcase/'));
      expect(heroes.length).toBeGreaterThanOrEqual(10);
      expect(heroes.length).toBeLessThanOrEqual(20);
      expect(packed().size).toBeLessThan(15 * 1024 * 1024);
    },
    30_000,
  );

  // Legal files are staged by prepack; only a staged tree can prove they pack.
  const stagedApache = join(pkgDir, 'LICENSE-APACHE-2.0-brand-spec');
  it.skipIf(!existsSync(stagedApache))(
    'packs every legal file, and the Apache copy really is the Apache license',
    () => {
      const files = packedFiles();
      for (const f of ['LICENSE', 'LICENSE-APACHE-2.0-brand-spec', 'NOTICE', 'ASSETS-LICENSE.md', 'CHANGELOG.md']) {
        expect(files).toContain(f);
      }
      expect(readFileSync(stagedApache, 'utf8')).toContain('Apache License');
    },
    30_000,
  );
});
