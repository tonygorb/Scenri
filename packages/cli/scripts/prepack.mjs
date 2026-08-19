#!/usr/bin/env node
/**
 * Assemble everything `npx scenri` needs into this package.
 *
 * Two things live outside the package in the monorepo and have to be copied in
 * before publishing, because `files` cannot reach above the package root:
 *
 *   apps/studio/dist  ->  studio-dist   the built SPA the server serves
 *   templates         ->  templates     the scene presets and their previews
 *
 * Both destinations match the "published" branch that `defaultScenesDir()` and
 * the studio path resolver already look for, so nothing at runtime changes.
 */
import { cpSync, existsSync, rmSync, mkdirSync, chmodSync, statSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const pkg = join(here, '..');
const repo = join(pkg, '..', '..');

const fail = (msg) => {
  console.error(`prepack: ${msg}`);
  process.exit(1);
};

// 1. the bundle
console.log('prepack: building the CLI bundle');
execFileSync('pnpm', ['exec', 'tsup'], { cwd: pkg, stdio: 'inherit' });

const entry = join(pkg, 'dist', 'index.js');
if (!existsSync(entry)) fail('tsup produced no dist/index.js');
// npm preserves the mode bit, and without it `npx scenri` cannot exec.
chmodSync(entry, 0o755);

// 2. the studio bundle
const studioSrc = join(repo, 'apps', 'studio', 'dist');
if (!existsSync(studioSrc)) fail('apps/studio/dist is missing. Run `pnpm build` at the repo root first.');
if (!existsSync(join(studioSrc, 'index.html'))) fail('apps/studio/dist has no index.html');
const studioDest = join(pkg, 'studio-dist');
rmSync(studioDest, { recursive: true, force: true });
cpSync(studioSrc, studioDest, { recursive: true });
console.log('prepack: copied the studio bundle');

// 3. the library: every catalog entry and its thumbnail, nothing heavy. The
//    reference galleries, product shots, presenter identity sets and the
//    showcase heroes beyond the starter wall ship separately as the content
//    archive (fetched once at runtime, see src/content/fetch.ts), so the
//    tarball stays npx-sized while the app still lists the whole library
//    offline from first launch.
//
//    The starter wall: the top of each showcase category by curated order, so
//    an offline Home is a real wall, not a placeholder grid.
const STARTER_SHOWCASE = new Set([
  'voss-rowe-runner-volcanic-ash',
  'orla-priya-fjord-ferry',
  'orchard-oat-orchard-burst',
  'aurelia-serum-succulent-dew',
  'birchwood-salt-flat',
  'solstice-aviators-screen-print',
  'verity-pearls-suspended-silk',
  'ashwell-kin-lamp-elin-lamplight',
  'marrow-vale-halite-ledge',
  'basalt-snells-window',
  'moss-larkin-chair-travertine-atrium',
  'cairn-sun-stick-agave-noon',
  'wen-meridian-trailhead',
  'almanac-canvas-theo-billboard',
  'calder-snow-loft',
]);

const scenesSrc = join(repo, 'templates');
if (!existsSync(scenesSrc)) fail('templates/ is missing');
const scenesDest = join(pkg, 'templates');
rmSync(scenesDest, { recursive: true, force: true });
mkdirSync(scenesDest, { recursive: true });

const jpgsOf = (dir) =>
  existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.jpg') && statSync(join(dir, f)).isFile()) : [];
const copyInto = (srcDir, destDir, files) => {
  if (!files.length) return;
  mkdirSync(destDir, { recursive: true });
  for (const f of files) cpSync(join(srcDir, f), join(destDir, f));
};

// catalog JSON, complete: looks at the root, then the three subcatalogs
copyInto(
  scenesSrc,
  scenesDest,
  readdirSync(scenesSrc).filter((f) => f.endsWith('.json')),
);
for (const sub of ['presenters', 'showcase', 'demo-products']) {
  copyInto(
    join(scenesSrc, sub),
    join(scenesDest, sub),
    readdirSync(join(scenesSrc, sub)).filter((f) => f.endsWith('.json')),
  );
}
// thumbnails, complete: the flat look cards and the flat presenter cards
copyInto(join(scenesSrc, 'previews'), join(scenesDest, 'previews'), jpgsOf(join(scenesSrc, 'previews')));
copyInto(
  join(scenesSrc, 'previews', 'presenters'),
  join(scenesDest, 'previews', 'presenters'),
  jpgsOf(join(scenesSrc, 'previews', 'presenters')),
);
// the starter wall heroes only
copyInto(
  join(scenesSrc, 'previews', 'showcase'),
  join(scenesDest, 'previews', 'showcase'),
  jpgsOf(join(scenesSrc, 'previews', 'showcase')).filter((f) => STARTER_SHOWCASE.has(f.replace(/\.jpg$/, ''))),
);
console.log('prepack: copied the catalog and starter imagery');

// 4. legal files, which `files` also cannot reach above the package root for.
//    A missing one is a broken release, not a skippable nicety: the tarball
//    inlines @scenri/brand (Apache-2.0) into dist, so that license text has to
//    travel with it (Apache-2.0 section 4a), alongside the app's own.
const LEGAL = [
  ['LICENSE', 'LICENSE'],
  ['NOTICE', 'NOTICE'],
  ['README.md', 'README.md'],
  [join('docs', 'ASSETS-LICENSE.md'), 'ASSETS-LICENSE.md'],
  [join('packages', 'brand-spec', 'LICENSE'), 'LICENSE-APACHE-2.0-brand-spec'],
];
for (const [src, dest] of LEGAL) {
  const from = join(repo, src);
  if (!existsSync(from)) fail(`legal file missing: ${src}`);
  cpSync(from, join(pkg, dest));
}

const mb = (p) => (execFileSync('du', ['-sk', p]).toString().trim().split(/\s+/)[0] / 1024).toFixed(1);
console.log(
  `prepack: ready. dist ${statSync(entry).size} bytes, studio-dist ${mb(studioDest)} MB, templates ${mb(scenesDest)} MB`,
);
