#!/usr/bin/env node
/**
 * See the update flow exactly as a user does. Boots the real supervised
 * launcher on a scratch home against a mini registry that serves the current
 * source as 99.0.0, then opens the browser: the float announces, downloads in
 * the background, offers the one-click Update, and clicking it really restarts
 * into 99.0.0. Nothing touches your checkout, your library or your dev
 * server; Ctrl-C tears the whole thing down.
 *
 *   node packages/cli/test/update-demo.mjs
 *
 * Preconditions: a working npm, `pnpm build` done (studio dist exists).
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
const PORT = 4795;
const REG_PORT = 4796;

const fail = (msg) => {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
};

if (spawnSync('npm', ['--version'], { stdio: 'ignore' }).status !== 0) fail('npm is not working on this machine');
if (!existsSync(join(ROOT, 'apps', 'studio', 'dist', 'index.html'))) fail('run `pnpm build` first');

console.log('  assembling the current source as 99.0.0 (one moment)...');
execFileSync('pnpm', ['exec', 'tsup'], { cwd: CLI, stdio: 'ignore' });
execFileSync('node', [join(CLI, 'scripts', 'prepack.mjs')], { cwd: CLI, stdio: 'ignore' });
const work = mkdtempSync(join(tmpdir(), 'sc-updemo-'));
const pkgDir = join(work, 'pkg');
mkdirSync(pkgDir);
for (const part of ['dist', 'studio-dist', 'templates', 'LICENSE', 'NOTICE', 'README.md']) {
  cpSync(join(CLI, part), join(pkgDir, part), { recursive: true });
}
const manifest = JSON.parse(readFileSync(join(CLI, 'package.json'), 'utf8'));
manifest.version = '99.0.0';
manifest.scripts = {};
writeFileSync(join(pkgDir, 'package.json'), JSON.stringify(manifest, null, 2));
const tarball = join(pkgDir, execFileSync('npm', ['pack', '--loglevel=error'], { cwd: pkgDir }).toString().trim());

// The mini registry: this package at 99.0.0, everything else relayed upstream
// so npm resolves the real dependency tree during staging.
const name = manifest.name;
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
const registry = createServer((req, res) => {
  const url = req.url ?? '/';
  if (url === `/-/package/${name}/dist-tags`) return json(res, { latest: '99.0.0' });
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

const home = mkdtempSync(join(tmpdir(), 'sc-updemo-home-'));
const env = {
  ...process.env,
  SCENRI_HOME: home,
  SCENRI_PORT: String(PORT),
  SCENRI_NO_CONTENT_FETCH: '1',
  SCENRI_DEMO_ENGINE: '1',
  SCENRI_REGISTRY: `http://127.0.0.1:${REG_PORT}`,
};
delete env.SCENRI_NO_UPDATE_CHECK;
delete env.SCENRI_NO_OPEN; // the server opens the browser, like a real launch
const launcher = spawn('node', [join(CLI, 'dist', 'index.js')], { env, stdio: 'inherit' });

const api = async (path, init) => fetch(`http://127.0.0.1:${PORT}${path}`, init).then((r) => r.json());
for (let i = 0; i < 60; i++) {
  await new Promise((r) => setTimeout(r, 500));
  const up = await api('/api/version').then(
    () => true,
    () => false,
  );
  if (up) break;
}
await api('/api/brands', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ brand: { specVersion: '0.1', meta: { name: 'Demo' } } }),
}).catch(() => {});
await api('/api/update/check', { method: 'POST' }).catch(() => {});

console.log('');
console.log('  This is the user seat. Watch the bottom-left float:');
console.log('  downloading, then "Scenri 99.0.0 is ready", then click');
console.log('  Update and watch it come back as 99.0.0.');
console.log('  Settings, About shows the same states. Ctrl-C ends the demo');
console.log('  and removes every temporary file.');
console.log('');

const cleanup = () => {
  launcher.kill('SIGTERM');
  registry.close();
  setTimeout(() => {
    rmSync(work, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
    process.exit(0);
  }, 1500);
};
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
launcher.on('exit', (code, signal) => {
  // The exit-75 respawn is the launcher's own business; this fires only when
  // the whole supervised tree ends for real.
  if (signal || code !== null) {
    registry.close();
    rmSync(work, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});
