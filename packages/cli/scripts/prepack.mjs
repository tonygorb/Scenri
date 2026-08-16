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
import { cpSync, existsSync, rmSync, mkdirSync, chmodSync, statSync } from 'node:fs';
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

// 3. the scenes
const scenesSrc = join(repo, 'templates');
if (!existsSync(scenesSrc)) fail('templates/ is missing');
const scenesDest = join(pkg, 'templates');
rmSync(scenesDest, { recursive: true, force: true });
mkdirSync(scenesDest, { recursive: true });
cpSync(scenesSrc, scenesDest, { recursive: true });
console.log('prepack: copied the scenes');

// 4. legal files, which `files` also cannot reach above the package root for
for (const f of ['LICENSE', 'NOTICE', 'README.md']) {
  const src = join(repo, f);
  if (existsSync(src)) cpSync(src, join(pkg, f));
}

const mb = (p) => (execFileSync('du', ['-sk', p]).toString().trim().split(/\s+/)[0] / 1024).toFixed(1);
console.log(
  `prepack: ready. dist ${statSync(entry).size} bytes, studio-dist ${mb(studioDest)} MB, templates ${mb(scenesDest)} MB`,
);
