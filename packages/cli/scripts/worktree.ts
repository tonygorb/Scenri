/**
 * Worktrees: one task, one branch, one checkout, with its own ports and library.
 *
 * The primary checkout stays on main and owns 4747, 5173 and ~/.scenri. Every
 * other checkout is a linked worktree under ../<primary>-worktrees/<slug>, and
 * this script gives each one a *lane*: a small integer that decides its ports
 * and points it at an in-tree library, so two checkouts can never share a
 * server, a database or a Desktop icon. The lane lives in the worktree's own
 * git dir (.git/worktrees/<name>/scenri-lane), so it dies with the worktree and
 * never appears in the tree.
 *
 *   pnpm worktree add <branch> [--empty]   create, bootstrap, copy the library
 *   pnpm worktree list                     every checkout, its lane, its state
 *   pnpm worktree remove <slug> [--force]  after the merge
 *   pnpm worktree run -- <command>         what `pnpm dev` and `pnpm dev:ui` go through
 *
 * `run` is a pure passthrough in the primary (.git is a directory). In a linked
 * worktree (.git is a `gitdir:` file) it forces the lane's variables and
 * refuses to start when the lane's port is already held, which is the guard
 * `serve.ts` does not have: on a busy port it adopts the other Scenri and exits
 * 0, and a checkout that "started" that way is serving someone else's branch.
 *
 * Runs under tsx like the other scripts here. Imported by the Playwright configs
 * for `laneEnv()`, so importing this file must never run a command.
 */
import { type SpawnSyncReturns, spawn, spawnSync } from 'node:child_process';
import {
  constants,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type BetterSqlite3 from 'better-sqlite3';

const here = dirname(fileURLToPath(import.meta.url));
/** The checkout this copy of the script lives in: the primary or a worktree. */
const REPO = resolve(here, '..', '..', '..');

/** Nine lanes: 4748..4756 sits between the owner's 4747 and the e2e band at 4757. */
export const LANES = 9;

/** What a lane forces on `pnpm dev`, `pnpm dev:ui` and Playwright in a linked worktree. */
export interface LaneEnv {
  SCENRI_PORT: string;
  SCENRI_API: string;
  SCENRI_UI_PORT: string;
  SCENRI_HOME: string;
  SCENRI_E2E_PORT: string;
  SCENRI_NO_DESKTOP: '1';
  SCENRI_NO_OPEN: '1';
}

/** Where a checkout's git state lives; `linked` is false in the primary. */
export interface GitDirs {
  linked: boolean;
  gitDir: string;
  commonDir: string;
}

/**
 * Ports sit in gaps the repo already leaves: the server band ends before the
 * e2e harness at 4757, the studio band starts above the owner's 5173, and e2e
 * moves to 6000+ so its four workers, updates.spec's fixtures (base + 10 .. + 86
 * with the free-port probe) and the next lane never meet.
 */
export function laneEnvFor(lane: number, home: string): LaneEnv {
  const port = 4747 + lane;
  return {
    SCENRI_PORT: String(port),
    SCENRI_API: `http://127.0.0.1:${port}`,
    SCENRI_UI_PORT: String(5173 + lane),
    SCENRI_HOME: home,
    SCENRI_E2E_PORT: String(6000 + 100 * lane),
    // A worktree never touches ~/.scenri/launcher or the Desktop icon
    // (desktop/refresh.ts runs on every start and has no dev guard), and never
    // opens a browser tab of its own.
    SCENRI_NO_DESKTOP: '1',
    SCENRI_NO_OPEN: '1',
  };
}

/** `feat/attach-picker` -> `feat-attach-picker`: the directory a branch lives in. */
export function slugOf(branch: string): string {
  return branch.replace(/\//g, '-');
}

/**
 * `installKind.ts` decides "dev" from a `/dist/` path segment, so a checkout
 * whose directory is literally named dist would look like a built install.
 */
export function assertSlug(slug: string): string {
  if (!/^[A-Za-z0-9._-]+$/.test(slug)) throw new Error(`"${slug}" is not a usable directory name`);
  if (slug === 'dist')
    throw new Error('a worktree cannot be called dist: installKind.ts would read it as a built install');
  return slug;
}

/**
 * In the primary `.git` is a directory and doubles as the common dir. In a
 * linked worktree `.git` is a one-line file, `gitdir: <common>/worktrees/<name>`,
 * and that dir carries a `commondir` file pointing back. No git process needed.
 */
export function gitDirs(root: string): GitDirs | null {
  const dotGit = join(root, '.git');
  let isDir: boolean;
  try {
    isDir = statSync(dotGit).isDirectory();
  } catch {
    return null;
  }
  if (isDir) return { linked: false, gitDir: dotGit, commonDir: dotGit };
  const m = /^gitdir:\s*(.+?)\s*$/m.exec(readFileSync(dotGit, 'utf8'));
  if (!m) return null;
  const gitDir = resolve(root, m[1]);
  let commonDir = dirname(dirname(gitDir));
  try {
    commonDir = resolve(gitDir, readFileSync(join(gitDir, 'commondir'), 'utf8').trim());
  } catch {
    /* older layouts have no commondir file; two levels up is where git puts it */
  }
  return { linked: true, gitDir, commonDir };
}

export function readLane(gitDir: string): number | null {
  try {
    const n = Number(readFileSync(join(gitDir, 'scenri-lane'), 'utf8').trim());
    return Number.isInteger(n) && n >= 1 && n <= LANES ? n : null;
  } catch {
    return null;
  }
}

/** Lanes held by every linked worktree of the repo whose common dir this is. */
export function usedLanes(commonDir: string): Set<number> {
  const dir = join(commonDir, 'worktrees');
  try {
    const lanes = readdirSync(dir).map((name) => readLane(join(dir, name)));
    return new Set(lanes.filter((n): n is number => n !== null));
  } catch {
    return new Set();
  }
}

export function lowestFreeLane(used: Set<number>): number {
  for (let n = 1; n <= LANES; n++) if (!used.has(n)) return n;
  throw new Error(`all ${LANES} lanes are taken; remove a worktree first (pnpm worktree list)`);
}

/**
 * The lane of a linked worktree, assigned on first use if it has none, so a
 * checkout made with plain `git worktree add` (or by an agent's own worktree
 * tool) is isolated the first time anything here runs in it. Null in the
 * primary.
 */
export function ensureLane(root: string): number | null {
  const g = gitDirs(root);
  if (!g?.linked) return null;
  let lane = readLane(g.gitDir);
  if (lane === null) {
    lane = lowestFreeLane(usedLanes(g.commonDir));
    writeFileSync(join(g.gitDir, 'scenri-lane'), `${lane}\n`);
  }
  return lane;
}

/**
 * The lane's variables for a checkout, or an empty object in the primary and on
 * any error. The Playwright configs import this, and CI is a plain clone, so it
 * must never throw.
 */
export function laneEnv(root: string = REPO): Partial<LaneEnv> {
  try {
    const lane = ensureLane(root);
    if (lane === null) return {};
    return laneEnvFor(lane, join(root, '.scenri-home'));
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------- commands

function fail(msg: string): never {
  console.error(`worktree: ${msg}`);
  process.exit(1);
}

function git(
  cwd: string,
  args: string[],
  opts: { allowFail?: boolean; inherit?: boolean } = {},
): SpawnSyncReturns<string> {
  const r = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: opts.inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'],
  });
  if (r.status !== 0 && !opts.allowFail) fail(`git ${args.join(' ')} failed${r.stderr ? `:\n${r.stderr.trim()}` : ''}`);
  return r;
}

function pnpm(cwd: string, args: string[], opts: { allowFail?: boolean } = {}): number | null {
  const r = spawnSync('pnpm', args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0 && !opts.allowFail) fail(`pnpm ${args.join(' ')} failed in ${cwd}`);
  return r.status;
}

function portBusy(port: number): Promise<boolean> {
  return new Promise((done) => {
    const probe = createServer();
    probe.once('error', () => done(true));
    probe.listen(port, '127.0.0.1', () => probe.close(() => done(false)));
  });
}

/** PIDs listening on a port, LISTEN state only: a browser client also "has" the port. */
function pidsOn(port: number): string {
  const r = spawnSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim().split('\n').filter(Boolean).join(', ') : '';
}

/** The primary checkout and the sibling directory the worktrees live in. */
function layout(): { primary: string; worktrees: string } {
  const g = gitDirs(REPO);
  if (!g) return fail(`${REPO} is not a git checkout`);
  const primary = dirname(g.commonDir);
  return { primary, worktrees: join(dirname(primary), `${basename(primary)}-worktrees`) };
}

/** Link the primary's local-only material into a worktree, where git would leave nothing. */
function link(target: string, at: string): void {
  try {
    lstatSync(at);
    return;
  } catch {
    /* nothing there yet */
  }
  try {
    symlinkSync(realpathSync(target), at);
  } catch {
    /* the primary has no such thing; a fresh clone would not either */
  }
}

/** ~/.scenri/content is a 95 MB read-only cache; share it instead of downloading it per worktree. */
function shareContent(home: string): void {
  const content = join(homedir(), '.scenri', 'content');
  if (existsSync(join(content, 'meta.json'))) link(content, join(home, 'content'));
}

/**
 * A consistent snapshot of the owner's library. Never `openDb()`: that would
 * migrate the live database and run the crash sweep that marks its running
 * generations as errors. A read-only connection and VACUUM INTO copy the WAL
 * as well; images and thumbs are APFS clones, so the copy is instant and free.
 */
function copyLibrary(src: string, dst: string, checkout: string): boolean {
  const db = join(src, 'scenri.db');
  if (!existsSync(db)) {
    console.log(`worktree: no library at ${src}, starting empty`);
    return false;
  }
  const require = createRequire(join(checkout, 'packages', 'cli', 'package.json'));
  const Database = require('better-sqlite3') as typeof BetterSqlite3;
  const source = new Database(db, { readonly: true });
  try {
    source.prepare('VACUUM INTO ?').run(join(dst, 'scenri.db'));
  } finally {
    source.close();
  }
  for (const dir of ['images', 'thumbs']) {
    if (existsSync(join(src, dir))) {
      cpSync(join(src, dir), join(dst, dir), { recursive: true, mode: constants.COPYFILE_FICLONE });
    }
  }
  return true;
}

function describeLane(lane: number, path: string): string {
  const env = laneEnvFor(lane, join(path, '.scenri-home'));
  return [
    `  lane     ${lane}`,
    `  server   http://127.0.0.1:${env.SCENRI_PORT}   (pnpm dev)`,
    `  studio   http://127.0.0.1:${env.SCENRI_UI_PORT}   (pnpm dev:ui)`,
    `  e2e      ${env.SCENRI_E2E_PORT}+`,
    `  library  ${env.SCENRI_HOME}`,
  ].join('\n');
}

async function add(argv: string[]): Promise<void> {
  const branch = argv.find((a) => !a.startsWith('--'));
  if (!branch) return fail('usage: pnpm worktree add <branch> [--empty]');
  const empty = argv.includes('--empty');
  const slug = assertSlug(slugOf(branch));
  const { primary, worktrees } = layout();
  const path = join(worktrees, slug);
  if (existsSync(path)) return fail(`${path} already exists`);
  mkdirSync(worktrees, { recursive: true });

  if (git(primary, ['fetch', 'origin', '--quiet'], { allowFail: true }).status !== 0) {
    console.error('worktree: could not fetch origin, branching from the local main');
  }
  const has = (ref: string) =>
    git(primary, ['rev-parse', '--verify', '--quiet', ref], { allowFail: true }).status === 0;
  const base = has('refs/remotes/origin/main') ? 'origin/main' : 'main';
  if (has(`refs/heads/${branch}`)) {
    git(primary, ['worktree', 'add', path, branch], { inherit: true });
  } else if (has(`refs/remotes/origin/${branch}`)) {
    git(primary, ['worktree', 'add', '--track', '-b', branch, path, `origin/${branch}`], { inherit: true });
  } else {
    // --no-track: without it the new branch tracks origin/main and `git pull`
    // would merge main into the task branch.
    git(primary, ['worktree', 'add', '--no-track', '-b', branch, path, base], { inherit: true });
  }

  const lane = ensureLane(path);
  if (lane === null) return fail(`${path} did not come up as a linked worktree`);
  link(join(primary, '.claude'), join(path, '.claude'));
  link(join(primary, 'docs', 'design'), join(path, 'docs', 'design'));

  if (pnpm(path, ['install', '--frozen-lockfile'], { allowFail: true }) !== 0) {
    console.error(
      'worktree: the lockfile on this branch differs from node_modules; installing without --frozen-lockfile',
    );
    pnpm(path, ['install']);
  }
  pnpm(path, ['build']);

  const home = join(path, '.scenri-home');
  mkdirSync(home, { recursive: true, mode: 0o700 });
  shareContent(home);
  const copied = empty ? false : copyLibrary(join(homedir(), '.scenri'), home, path);

  console.log(`\nworktree ready\n  path     ${path}\n  branch   ${branch}\n${describeLane(lane, path)}`);
  console.log(`  contents ${copied ? 'a copy of ~/.scenri (db, images, thumbs)' : 'empty'}`);
  console.log(`\nnext: cd ${path}   (or open it as its own editor window or agent session)\n`);
}

async function remove(argv: string[]): Promise<void> {
  const slug = argv.find((a) => !a.startsWith('--'));
  if (!slug) return fail('usage: pnpm worktree remove <slug> [--force]');
  const force = argv.includes('--force');
  const { primary, worktrees } = layout();
  const path = join(worktrees, slug);
  if (!existsSync(path)) return fail(`${path} does not exist (pnpm worktree list)`);
  if (resolve(path) === resolve(REPO))
    return fail('run remove from another checkout, not from inside the one being removed');

  const dirty = git(path, ['status', '--porcelain']).stdout.trim();
  if (dirty && !force)
    return fail(`${slug} has uncommitted work; commit or push it, or pass --force to discard:\n${dirty}`);

  const g = gitDirs(path);
  const lane = g ? readLane(g.gitDir) : null;
  if (lane !== null) {
    for (const port of [4747 + lane, 5173 + lane]) {
      if (await portBusy(port))
        return fail(`port ${port} is still listening (pid ${pidsOn(port) || '?'}); stop that server first`);
    }
  }

  const branch = git(path, ['branch', '--show-current']).stdout.trim();
  git(primary, ['worktree', 'remove', ...(force ? ['--force'] : []), path], { inherit: true });
  const del = git(primary, ['branch', '-d', branch], { allowFail: true });
  if (del.status === 0) {
    console.log(`worktree: removed ${slug} and deleted branch ${branch}`);
  } else {
    console.log(`worktree: removed ${slug}; branch ${branch} kept: ${del.stderr.trim()}`);
    console.log(`  a squash-merged branch needs -D. Confirm first: gh pr view ${branch} --json state,mergedAt`);
  }
}

async function list(): Promise<void> {
  const { primary } = layout();
  const out = git(primary, ['worktree', 'list', '--porcelain']).stdout;
  const rows: { path: string; branch: string; lane: string; dirty: string; up: string }[] = [];
  for (const block of out.trim().split('\n\n')) {
    const lines = block.split('\n');
    const path = lines[0].replace(/^worktree /, '');
    const branch = (lines.find((l) => l.startsWith('branch ')) ?? 'branch (detached)').replace(
      /^branch (refs\/heads\/)?/,
      '',
    );
    const g = gitDirs(path);
    const lane = g?.linked ? readLane(g.gitDir) : null;
    const dirty = git(path, ['status', '--porcelain'], { allowFail: true }).stdout.trim() ? 'dirty' : 'clean';
    const ports = lane === null ? [4747, 5173] : [4747 + lane, 5173 + lane];
    const up: number[] = [];
    for (const p of ports) if (await portBusy(p)) up.push(p);
    rows.push({
      path,
      branch,
      lane: lane === null ? (g?.linked ? '-' : 'primary') : String(lane),
      dirty,
      up: up.join(' ') || '-',
    });
  }
  const w = (k: 'lane' | 'branch' | 'up') => Math.max(...rows.map((r) => r[k].length));
  for (const r of rows) {
    console.log(
      `${r.lane.padEnd(w('lane'))}  ${r.branch.padEnd(w('branch'))}  ${r.dirty}  listening: ${r.up.padEnd(w('up'))}  ${r.path}`,
    );
  }
}

async function run(argv: string[]): Promise<void> {
  const cmd = argv[0] === '--' ? argv.slice(1) : argv;
  if (cmd.length === 0) return fail('usage: pnpm worktree run -- <command...>');
  const g = gitDirs(REPO);
  if (!g?.linked) return exec(cmd, process.env);

  const lane = ensureLane(REPO);
  if (lane === null) return exec(cmd, process.env);
  const home = join(REPO, '.scenri-home');
  const env = laneEnvFor(lane, home);
  const ui = cmd.some((a) => /@scenri\/studio|vite/.test(a));
  const port = Number(ui ? env.SCENRI_UI_PORT : env.SCENRI_PORT);
  if (await portBusy(port)) {
    return fail(
      `port ${port} is already listening (pid ${pidsOn(port) || '?'}), and starting anyway would adopt that server and exit 0.\n` +
        `  Stop it, or if it is this worktree's own server, you are already running.`,
    );
  }
  mkdirSync(home, { recursive: true, mode: 0o700 });
  shareContent(home);
  for (const [k, v] of Object.entries(env)) {
    if (process.env[k] !== undefined && process.env[k] !== v)
      console.error(`worktree: ${k}=${process.env[k]} overridden by the lane (${v})`);
  }
  console.error(
    `worktree: lane ${lane}, server http://127.0.0.1:${env.SCENRI_PORT}, studio http://127.0.0.1:${env.SCENRI_UI_PORT}, library ${home}`,
  );
  return exec(cmd, { ...process.env, ...env });
}

function exec(cmd: string[], env: NodeJS.ProcessEnv): void {
  const child = spawn(cmd[0], cmd.slice(1), { stdio: 'inherit', env, shell: process.platform === 'win32' });
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.on(sig, () => child.kill(sig));
  child.on('error', (err) => fail(`could not start ${cmd[0]}: ${err.message}`));
  child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
}

const USAGE = `usage:
  pnpm worktree add <branch> [--empty]     new worktree beside the primary, bootstrapped, library copied
  pnpm worktree list                       every checkout with its lane, branch, state and live ports
  pnpm worktree remove <slug> [--force]    after the merge; refuses dirty trees and live servers
  pnpm worktree run -- <command...>        the wrapper behind pnpm dev and pnpm dev:ui`;

async function main(argv: string[]): Promise<void> {
  const [command, ...rest] = argv;
  switch (command) {
    case 'add':
      return add(rest);
    case 'remove':
      return remove(rest);
    case 'list':
      return list();
    case 'run':
      return run(rest);
    default:
      console.error(USAGE);
      process.exit(command ? 1 : 0);
  }
}

const invokedDirectly = (() => {
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();
if (invokedDirectly) main(process.argv.slice(2)).catch((err: Error) => fail(err.message));
