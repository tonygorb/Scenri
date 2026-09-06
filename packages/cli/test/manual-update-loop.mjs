#!/usr/bin/env node
/**
 * The whole update loop, live, against real artifacts: the launcher
 * supervising (the dispatch regression gate), a release published mid-run
 * that the periodic schedule discovers with no click and no client request,
 * background auto-staging (a real npm install plus the verify hop), exit-75
 * restart, the new version answering, and the library surviving all of it.
 * CI runs this in the update-loop job on updater-relevant changes; it also
 * stays hand-runnable:
 *
 *   node packages/cli/test/manual-update-loop.mjs
 *
 * Preconditions: a working npm, `pnpm build` done (studio dist exists).
 * The fixture registry serves this package at 99.0.0; every other request is
 * relayed to registry.npmjs.org so the real dependencies resolve.
 */
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = join(CLI, '..', '..');
const PORT = 4791;
const REG_PORT = 4792;

const fail = (msg) => {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
};
const ok = (msg) => console.log(`ok: ${msg}`);

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

// -- 2. a fixture registry: this package at 99.0.0, everything else relayed
// upstream so npm can resolve the real dependency tree. Dependency tarball
// URLs inside upstream packuments point straight at npmjs, so only metadata
// flows through the relay.
const name = manifest.name;
const currentVersion = JSON.parse(readFileSync(join(CLI, 'package.json'), 'utf8')).version;
const bytes = readFileSync(tarball);
const dist = {
  tarball: `http://127.0.0.1:${REG_PORT}/${name}/-/${name}-99.0.0.tgz`,
  shasum: createHash('sha1').update(bytes).digest('hex'),
  integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
};
const packument = { name, 'dist-tags': { latest: '99.0.0' }, versions: { '99.0.0': { ...manifest, dist } } };
const json = (res, body) => {
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(body));
};
// Mutable on purpose: the release is "published" mid-run by flipping this,
// which is the exact long-running-instance scenario the loop exists to prove.
let latestTag = currentVersion;
const registry = createServer((req, res) => {
  const url = req.url ?? '/';
  if (url === `/-/package/${name}/dist-tags`) return json(res, { latest: latestTag });
  if (url === `/${name}`) return json(res, packument);
  if (url === `/${name}/-/${name}-99.0.0.tgz`) {
    res.setHeader('content-type', 'application/octet-stream');
    return res.end(bytes);
  }
  fetch(`https://registry.npmjs.org${url}`, { headers: { accept: req.headers.accept ?? '*/*' } })
    .then(async (r) => {
      res.statusCode = r.status;
      const t = r.headers.get('content-type');
      if (t) res.setHeader('content-type', t);
      res.end(Buffer.from(await r.arrayBuffer()));
    })
    .catch(() => {
      res.statusCode = 502;
      res.end('{}');
    });
});
await new Promise((r) => registry.listen(REG_PORT, '127.0.0.1', r));
ok(`fixture registry on :${REG_PORT}`);

// -- 3. boot the launcher on a scratch home, check pointed at the fixture
const home = mkdtempSync(join(tmpdir(), 'sc-loop-home-'));
const env = {
  ...process.env,
  SCENRI_HOME: home,
  SCENRI_PORT: String(PORT),
  SCENRI_NO_OPEN: '1',
  SCENRI_NO_CONTENT_FETCH: '1',
  SCENRI_NO_DESKTOP: '1',
  SCENRI_DEMO_ENGINE: '1',
  SCENRI_REGISTRY: `http://127.0.0.1:${REG_PORT}`,
  // Harness cadence: the real schedule at test speed. Clamps do not apply off
  // the public registry, which this fixture is.
  SCENRI_UPDATE_TICK_MS: '1000',
  SCENRI_UPDATE_INTERVAL_MS: '2000',
};
delete env.SCENRI_NO_UPDATE_CHECK;
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
if (!before.supervised) fail('expected the launcher to supervise (the argv/symlink dispatch regression)');

// -- 4. put real user data in the home; it must survive the update untouched
const seeded = await api('/api/brands', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ brand: { specVersion: '0.1', meta: { name: 'Acme' } } }),
});
if (seeded.status >= 300) fail(`brand seed failed: ${seeded.status}`);
ok('seeded a brand');

// -- 5. the long-running-instance scenario: no update exists yet, the server
// keeps running, a release is published, and the periodic schedule discovers
// it by itself — no forced check, no client request during the window.
await new Promise((r) => setTimeout(r, 12_000)); // past the 10s boot check
const quiet = (await api('/api/update/status')).body;
if (quiet?.available || quiet?.phase !== 'idle') {
  fail(`false positive before the release existed: ${JSON.stringify(quiet)}`);
}
ok(`no update while the registry serves ${currentVersion}`);

latestTag = '99.0.0'; // the release is published while Scenri keeps running
ok('registry now serves 99.0.0');

// Total client silence: whatever the server knows at the end of this window,
// only its own schedule can have learned. Staging a real npm install takes
// longer than the window, so the first status answer proving phase left idle
// is proof the timer discovered and acted alone.
await new Promise((r) => setTimeout(r, 20_000));
const discovered = (await api('/api/update/status')).body;
if (discovered?.phase === 'idle' && discovered?.stagedVersion === null) {
  fail(`the schedule never discovered the release: ${JSON.stringify(discovered)}`);
}
ok(`the schedule discovered it alone (phase=${discovered.phase})`);

let readied = discovered?.phase === 'ready' ? discovered : null;
const stageDeadline = Date.now() + 240_000;
while (!readied && Date.now() < stageDeadline) {
  await new Promise((r) => setTimeout(r, 1500));
  const s = (await api('/api/update/status')).body;
  if (s?.phase === 'ready') {
    readied = s;
    break;
  }
  if (s?.phase === 'error') fail(`staging failed: ${s.error}`);
}
if (!readied) fail('auto-staging never reached ready');
if (readied.stagedVersion !== '99.0.0') fail(`staged the wrong version: ${readied.stagedVersion}`);
ok('auto-staged 99.0.0 (real npm install + verify hop, no check click, no apply call)');

// -- 6. one-click restart: exit 75, launcher respawns the staged version
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

// -- 7. the library came through
const brands = await api('/api/brands');
if (!Array.isArray(brands.body) || !brands.body.some((b) => b.slug === 'acme')) {
  fail(`the seeded brand did not survive the update: ${JSON.stringify(brands.body)}`);
}
ok('user data survived the update');

launcher.kill('SIGTERM');
await new Promise((r) => launcher.once('exit', r));
await new Promise((r) => registry.close(r));
rmSync(work, { recursive: true, force: true });
rmSync(home, { recursive: true, force: true });
ok('full update loop passed');
