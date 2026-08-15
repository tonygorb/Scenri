#!/usr/bin/env node
/**
 * The whole update loop, live, against real artifacts — launcher, staging,
 * verify, exit-75 restart, new version answering. Not part of the default CI
 * run (it packs and installs for real); run it by hand or nightly:
 *
 *   node packages/cli/test/manual-update-loop.mjs
 *
 * Preconditions: a working npm, `pnpm build` done (studio dist exists).
 */
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = join(CLI, '..', '..');
const PORT = 4791;

const fail = (msg) => {
  console.error(`✗ ${msg}`);
  process.exit(1);
};
const ok = (msg) => console.log(`✓ ${msg}`);

if (spawnSync('npm', ['--version'], { stdio: 'ignore' }).status !== 0) {
  console.log('npm is not working on this machine — the loop test needs it. Skipping, not failing.');
  process.exit(0);
}
if (!existsSync(join(ROOT, 'apps', 'studio', 'dist', 'index.html'))) fail('run `pnpm build` first');

// -- 1. assemble the current source as version 99.0.0 and pack it
execFileSync('pnpm', ['exec', 'tsup'], { cwd: CLI, stdio: 'ignore' });
execFileSync('node', [join(CLI, 'scripts', 'prepack.mjs')], { cwd: CLI, stdio: 'ignore' });
const work = mkdtempSync(join(tmpdir(), 'sc-loop-'));
const pkgDir = join(work, 'pkg');
mkdirSync(pkgDir);
for (const part of ['dist', 'studio-dist', 'templates', 'LICENSE', 'NOTICE', 'README.md']) {
  cpSync(join(CLI, part), join(pkgDir, part), { recursive: true });
}
const manifest = JSON.parse(readFileSync(join(CLI, 'package.json'), 'utf8'));
manifest.version = '99.0.0';
manifest.scripts = {}; // no prepack in the copy: it is already assembled
writeFileSync(join(pkgDir, 'package.json'), JSON.stringify(manifest, null, 2));
const tarball = join(pkgDir, execFileSync('npm', ['pack', '--loglevel=error'], { cwd: pkgDir }).toString().trim());
ok(`packed ${tarball}`);

// -- 2. boot the launcher on a scratch home
const home = mkdtempSync(join(tmpdir(), 'sc-loop-home-'));
const env = {
  ...process.env,
  SCENRI_HOME: home,
  SCENRI_PORT: String(PORT),
  SCENRI_NO_OPEN: '1',
  SCENRI_NO_UPDATE_CHECK: '1',
  SCENRI_DEMO_ENGINE: '1',
};
const launcher = spawn('node', [join(CLI, 'dist', 'index.js')], { env, stdio: 'inherit' });
const api = async (path, init) => {
  const res = await fetch(`http://127.0.0.1:${PORT}${path}`, init);
  return { status: res.status, body: await res.json().catch(() => null) };
};
let up = false;
for (let i = 0; i < 60 && !up; i++) {
  await new Promise((r) => setTimeout(r, 500));
  up = await api('/api/version').then(
    (r) => r.status === 200,
    () => false,
  );
}
if (!up) fail('server never came up');
const before = (await api('/api/version')).body;
ok(`serving ${before.version} (supervised=${before.supervised})`);
if (!before.supervised) fail('expected the launcher to supervise');

// -- 3. stage 99.0.0 from the tarball (real npm install + real verify hop)
const staged = spawnSync('node', [join(CLI, 'dist', 'index.js'), 'update', '--from', tarball], {
  env,
  stdio: 'inherit',
});
if (staged.status !== 0) fail('staging failed');
ok('staged 99.0.0');

// -- 4. one-click restart: exit 75 → launcher respawns the staged version
const restart = await api('/api/update/restart', { method: 'POST' });
if (restart.status !== 200) fail(`restart refused: ${JSON.stringify(restart.body)}`);
let after = null;
for (let i = 0; i < 60; i++) {
  await new Promise((r) => setTimeout(r, 500));
  const r = await api('/api/version').catch(() => null);
  if (r?.status === 200 && r.body.version === '99.0.0') {
    after = r.body;
    break;
  }
}
if (!after) fail('the new version never answered');
ok(`restarted into ${after.version} (installKind=${after.installKind})`);

launcher.kill('SIGTERM');
await new Promise((r) => launcher.once('exit', r));
rmSync(work, { recursive: true, force: true });
rmSync(home, { recursive: true, force: true });
ok('full update loop passed');
