/**
 * `pnpm cold-start`: a brand-new Scenri with no library, on this machine,
 * without touching the real one.
 *
 * Packs this checkout the way npm publishes it (the fifteen-picture starter
 * wall, not the checkout's 110), installs it under .scenri-cold/pkg, and
 * starts it the way `npx scenri` starts, the supervising launcher opening the
 * browser, on its own empty home (.scenri-cold/home) and its own port. Every
 * inherited SCENRI_* is dropped first, so a lane's settings cannot leak in,
 * and the home is refused if it is, holds or sits inside ~/.scenri, or
 * reaches anything through a link (cold-home.mts).
 *
 *   --brand            make one brand first, so the browser lands on Home at once
 *   --resume           keep the home from the last run (restart, resume, warm start)
 *   --throttle <mbps>  serve the library from this machine at that rate
 *   --fail <n>         ...with n of its files always failing (404, reset, short, corrupt)
 *   --flaky <n>        ...with n of its files failing once, then fine
 *   --cut <seconds>    ...with the network gone that long, five seconds in
 *   --archive <zip>    the archive to serve (default: the content repo's dist, else a checked copy)
 *   --no-open          start without opening a browser
 *   --no-build         reuse the packed install from the last run as it is
 *   --measure <label>  headless: time the first run into .scenri-cold/results/<label>.json
 *   --kill-at <pct>    with --measure and a local archive: stop Scenri once that share is served
 *   --k <n>            requests in flight at once (the bench; default the app's own)
 *
 * Stop with Ctrl-C (the whole process tree goes), or Shut down in the studio.
 */
import { spawn, spawnSync, execFileSync, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONTENT_SHA256, resolveContentUrl } from '../src/content/fetch.js';
import { freshHome, refuseHome } from './cold-home.mjs';
import { zipEntries } from './zip-entries.mjs';
import { npm, packFixture } from '../test/pack-fixture.mjs';
import { startArchiveServer } from '../test/archive-server.mjs';
import { pickPort } from '../test/perf/lib/server.mjs';

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = join(CLI, '..', '..');
const COLD = join(ROOT, '.scenri-cold');
const HOME = join(COLD, 'home');
const PKG = join(COLD, 'pkg');
const LOCK = join(COLD, 'run.json');
const REAL_HOME = join(homedir(), '.scenri');

// ---- arguments
const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(`--${name}`);
const value = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const opts = {
  brand: flag('brand'),
  resume: flag('resume'),
  throttle: Number(value('throttle') ?? 0),
  fail: Number(value('fail') ?? 0),
  flaky: Number(value('flaky') ?? 0),
  cut: Number(value('cut') ?? 0),
  archive: value('archive'),
  open: !flag('no-open') && !flag('measure'),
  measure: value('measure'),
  killAt: Number(value('kill-at') ?? 0),
  k: value('k'),
};
const local = opts.throttle > 0 || opts.fail > 0 || opts.flaky > 0 || opts.cut > 0 || Boolean(opts.archive);
const say = (line: string) => console.log(`cold-start: ${line}`);
const die = (line: string): never => {
  console.error(`cold-start: ${line}`);
  process.exit(1);
};

// ---- one instance at a time
mkdirSync(COLD, { recursive: true });
if (existsSync(LOCK)) {
  const held = JSON.parse(readFileSync(LOCK, 'utf8')) as { pid: number; port: number };
  let alive = false;
  try {
    process.kill(held.pid, 0);
    alive = true;
  } catch {
    /* gone */
  }
  if (alive) die(`already running on :${held.port} (pid ${held.pid}); stop it first`);
  unlinkSync(LOCK);
}

// ---- the published shape, installed the way npm installs it
function runPnpm(args: string[]) {
  const js = process.env.npm_execpath;
  if (js && /pnpm/.test(js)) execFileSync(process.execPath, [js, ...args], { cwd: ROOT, stdio: 'inherit' });
  else execFileSync('pnpm', args, { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' });
}
function installPublishedShape(): string {
  if (flag('no-build')) {
    const installed = join(PKG, 'node_modules', 'scenri', 'dist', 'index.js');
    if (existsSync(installed)) return installed;
    die('nothing installed yet: run once without --no-build');
  }
  say('building the studio and packing this checkout as npm would publish it');
  runPnpm(['build']);
  const work = join(COLD, 'work');
  if (existsSync(work)) for (const d of readdirSync(work)) rmSync(join(work, d), { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  const version = JSON.parse(readFileSync(join(CLI, 'package.json'), 'utf8')).version as string;
  const { tarball, manifest } = packFixture(version, { root: work, prefix: 'pack-' });
  const sum = createHash('sha256').update(readFileSync(tarball)).digest('hex');
  const stamp = join(PKG, '.tarball-sha256');
  const entry = join(PKG, 'node_modules', manifest.name, 'dist', 'index.js');
  if (existsSync(entry) && existsSync(stamp) && readFileSync(stamp, 'utf8') === sum) {
    say('the packed build is unchanged; keeping the installed copy');
    return entry;
  }
  say('installing the packed build (npm, first time takes a minute)');
  rmSync(PKG, { recursive: true, force: true });
  mkdirSync(PKG, { recursive: true });
  writeFileSync(join(PKG, 'package.json'), '{ "private": true }\n');
  npm(['install', '--no-audit', '--no-fund', '--loglevel=error', tarball], { cwd: PKG, stdio: 'inherit' });
  writeFileSync(stamp, sum);
  return entry;
}

// ---- the library archive, for the local modes and for measuring
async function archiveBytes(): Promise<Buffer> {
  const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
  if (opts.archive) return readFileSync(opts.archive);
  for (const p of [
    join(ROOT, '..', 'scenri-content', 'dist', 'scenri-content.zip'),
    join(ROOT, '..', '..', 'scenri-content', 'dist', 'scenri-content.zip'),
    join(COLD, 'archive', 'scenri-content.zip'),
  ]) {
    if (existsSync(p)) {
      const b = readFileSync(p);
      if (sha(b) === CONTENT_SHA256) return b;
    }
  }
  say('fetching one checked copy of the library archive for local serving');
  const res = await fetch(resolveContentUrl({}));
  if (!res.ok) die(`the archive answered ${res.status}`);
  const b = Buffer.from(await res.arrayBuffer());
  if (sha(b) !== CONTENT_SHA256) die('the downloaded archive does not match the pinned sha256');
  mkdirSync(join(COLD, 'archive'), { recursive: true });
  writeFileSync(join(COLD, 'archive', 'scenri-content.zip'), b);
  return b;
}

/** Files spread across the archive, a wall hero among them, to go wrong in the chosen ways. */
function faultsFor(bytes: Buffer, n: number, times?: number) {
  const files = zipEntries(bytes).filter((e) => e.name.endsWith('.jpg'));
  const kinds = ['404', 'reset', 'short', 'corrupt'];
  const hero = files.findIndex((e) => e.name.startsWith('previews/showcase/'));
  const picks = [hero, ...Array.from({ length: n - 1 }, (_, i) => Math.floor(((i + 1) * files.length) / n))];
  return picks.slice(0, n).map((i, k) => ({
    name: files[i].name,
    start: files[i].dataOffset,
    end: files[i].dataOffset + files[i].compressedSize,
    kind: kinds[k % kinds.length],
    ...(times ? { times } : {}),
  }));
}

// ---- stopping the whole tree
function stopTree(child: ChildProcess) {
  if (child.exitCode !== null || !child.pid) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    return;
  }
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    /* already gone */
  }
  setTimeout(() => {
    try {
      process.kill(-(child.pid as number), 'SIGKILL');
    } catch {
      /* gone */
    }
  }, 8000).unref();
}

// ---- go
const why = refuseHome(HOME, COLD, REAL_HOME);
if (why) die(`refusing the cold-start home: ${why}`);
const entry = installPublishedShape();
// The shape check: the installed package carries exactly the starter wall,
// never the checkout's 110 (read from the package itself: the download starts
// at listen and Home's pictures come first, so the live wall races it).
const bundled = join(dirname(entry), '..', 'templates', 'previews', 'showcase');
const carried = existsSync(bundled) ? readdirSync(bundled).filter((f) => f.endsWith('.jpg')).length : 0;
if (carried !== 15) die(`the packed build carries ${carried} wall pictures, not the published 15`);
if (!opts.resume) freshHome(HOME, COLD, REAL_HOME);
else if (!existsSync(HOME)) die('nothing to resume: run without --resume first');

let archive: Awaited<ReturnType<typeof startArchiveServer>> | null = null;
const needBytes = local || Boolean(opts.measure);
const bytes = needBytes ? await archiveBytes() : null;
if (local && bytes) {
  const faults = [
    ...(opts.fail ? faultsFor(bytes, opts.fail) : []),
    ...(opts.flaky ? faultsFor(bytes, opts.flaky, 1) : []),
  ];
  archive = await startArchiveServer({
    bytes,
    mbps: opts.throttle,
    faults,
    cut: opts.cut ? { afterMs: 5000, forMs: opts.cut * 1000 } : null,
  });
  say(
    `serving the library from ${archive.url}${opts.throttle ? ` at ${opts.throttle} Mbps` : ''}` +
      `${faults.length ? `, ${faults.length} failing: ${faults.map((f) => `${f.name} (${f.kind}${f.times ? ', once' : ''})`).join(', ')}` : ''}` +
      `${opts.cut ? `, no network for ${opts.cut}s from 5s in` : ''}`,
  );
}

const port = await pickPort(4798);
const env: Record<string, string> = {};
for (const [k, v] of Object.entries(process.env)) if (!k.startsWith('SCENRI_') && v !== undefined) env[k] = v;
Object.assign(env, {
  SCENRI_HOME: HOME,
  SCENRI_PORT: String(port),
  SCENRI_HOST: '127.0.0.1',
  SCENRI_NO_DESKTOP: '1',
  SCENRI_NO_UPDATE_CHECK: '1',
  ...(opts.open && !opts.brand ? {} : { SCENRI_NO_OPEN: '1' }),
  ...(archive ? { SCENRI_CONTENT_URL: archive.url } : {}),
  ...(opts.k ? { SCENRI_CONTENT_CONCURRENCY: opts.k } : {}),
});

const url = `http://127.0.0.1:${port}/`;
const t0 = Date.now();
const log = createWriteStream(join(COLD, 'server.log'), { flags: opts.resume ? 'a' : 'w' });
const child = spawn(process.execPath, [entry], {
  env,
  stdio: ['ignore', 'pipe', 'pipe'],
  detached: process.platform !== 'win32',
  windowsHide: true,
});
for (const stream of [child.stdout, child.stderr]) {
  stream?.on('data', (d: Buffer) => {
    log.write(d);
    if (!opts.measure) for (const l of d.toString().split('\n')) if (l.trim()) console.log(`  | ${l}`);
  });
}
writeFileSync(LOCK, JSON.stringify({ pid: child.pid, helper: process.pid, port, startedAt: new Date().toISOString() }));
let stopping = false;
const finish = async (code: number) => {
  if (stopping) return;
  stopping = true;
  stopTree(child);
  await archive?.close();
  try {
    unlinkSync(LOCK);
  } catch {
    /* gone */
  }
  process.exit(code);
};
process.on('SIGINT', () => void finish(0));
process.on('SIGTERM', () => void finish(0));
child.on('exit', (code) => {
  say(`Scenri stopped (exit ${code})`);
  // a measured run decides for itself when it is over (it may stop Scenri on purpose)
  if (!opts.measure) void finish(0);
});

const api = async (path: string, init?: RequestInit) => fetch(`http://127.0.0.1:${port}${path}`, init);
// once Scenri is spawned, a failure stops it too, rather than leaving it running with the lock held
const fail = async (line: string) => {
  console.error(`cold-start: ${line}`);
  await finish(1);
};
let t1 = 0;
for (let i = 0; i < 600 && !t1; i++) {
  try {
    const v = (await (await api('/api/version')).json()) as { name?: string; home?: string };
    if (v.name === 'scenri') {
      if (v.home && v.home !== HOME) await fail(`the server on :${port} serves ${v.home}, not the cold home`);
      t1 = Date.now();
    }
  } catch {
    /* not up yet */
  }
  if (!t1) await new Promise((r) => setTimeout(r, 100));
}
if (!t1) await fail('Scenri did not start within a minute (see .scenri-cold/server.log)');

let brandId: string | null = null;
if (opts.brand || opts.measure) {
  const existing = (await (await api('/api/brands')).json()) as { id: string }[];
  brandId = existing[0]?.id ?? null;
  if (!brandId) {
    const made = await api('/api/brands', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ brand: { specVersion: '0.1', meta: { name: 'Cold start' } } }),
    });
    if (!made.ok) await fail(`could not make the brand: ${made.status} ${await made.text()}`);
    brandId = ((await made.json()) as { id: string }).id;
  }
}

console.log('');
say(`Scenri is up at ${url} (${((t1 - t0) / 1000).toFixed(1)} s)`);
say(`home: ${HOME}  (a throwaway library; your ~/.scenri is not used)`);
say("a shot made here uses this Mac's Codex login and saved keys for real; stop with Ctrl-C");
if (opts.open && opts.brand) {
  const { default: open } = await import('open');
  await open(url);
}

if (opts.measure) {
  const { measure } = await import('./cold-measure.mjs');
  const code = await measure({
    label: opts.measure,
    url,
    port,
    home: HOME,
    brandId,
    bytes,
    t0,
    t1,
    child,
    archive,
    killAt: opts.killAt,
    packageRoot: join(dirname(entry), '..'),
    results: join(COLD, 'results'),
    studioRequire: createRequire(join(ROOT, 'apps', 'studio', 'package.json')),
    mode: {
      local,
      throttle: opts.throttle,
      fail: opts.fail,
      flaky: opts.flaky,
      cut: opts.cut,
      resume: opts.resume,
      k: opts.k ?? 'default',
    },
  });
  await finish(code);
}
