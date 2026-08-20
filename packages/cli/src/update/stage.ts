/**
 * Staging: put a new Scenri on disk next to the running one, prove it works,
 * and only then let the launcher see it. npm does the fetching (and its
 * integrity checking); the verify hop actually loads the native modules under
 * the running node, so an ABI surprise fails here — at stage time, recoverable
 * — never at boot time.
 *
 * Shared by `scenri update` and the in-app apply route. Node builtins only.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { entryOf, isValidVersionDir, pruneStaged, stagingDir, versionsDir } from './versionsDir.js';

export type NpmArgv = string[];

/** npm on PATH first; the npm that launched us second; pnpm/bun shells never. */
export function findNpm(
  opts: {
    env?: Record<string, string | undefined>;
    canRun?: (argv: string[]) => boolean;
    /** Tests pin this so the contract does not fork with the CI host OS. */
    platform?: NodeJS.Platform;
  } = {},
): NpmArgv | null {
  const env = opts.env ?? process.env;
  const platform = opts.platform ?? process.platform;
  const canRun =
    opts.canRun ??
    ((argv: string[]) => {
      try {
        return spawnSync(argv[0], [...argv.slice(1), '--version'], { stdio: 'ignore', timeout: 10_000 }).status === 0;
      } catch {
        return false;
      }
    });
  // Bare `npm` is POSIX-only on purpose: on Windows it is npm.cmd, which only
  // runs through a shell (CVE-2024-27980), and a shell line is a command
  // injection surface. npm's real JS entry runs through our own node instead.
  if (platform !== 'win32' && canRun(['npm'])) return ['npm'];
  // npx scenri sets npm_execpath to npx-cli.js; npm-cli.js sits beside it.
  const ep = env.npm_execpath?.replace(/npx-cli\.js$/, 'npm-cli.js');
  if (ep && /npm-cli\.js$/.test(ep) && canRun([process.execPath, ep])) return [process.execPath, ep];
  if (platform === 'win32') {
    const cli = windowsNpmCli();
    if (cli && canRun([process.execPath, cli])) return [process.execPath, cli];
  }
  return null;
}

/** The npm-cli.js belonging to the npm.cmd on PATH, found without a shell:
 *  where.exe is a real executable, and the JS entry sits at a fixed spot
 *  beside the shim. */
function windowsNpmCli(): string | null {
  try {
    const out = spawnSync('where', ['npm'], { encoding: 'utf8', timeout: 10_000 });
    if (out.status !== 0 || !out.stdout) return null;
    for (const line of out.stdout.split(/\r?\n/)) {
      if (!/npm(\.cmd)?$/i.test(line.trim())) continue;
      const cli = join(dirname(line.trim()), 'node_modules', 'npm', 'bin', 'npm-cli.js');
      if (existsSync(cli)) return cli;
    }
  } catch {
    /* no where.exe, or an exotic PATH: the caller treats null as not found */
  }
  return null;
}

function run(argv: string[]): Promise<{ code: number; output: string }> {
  return new Promise((resolve) => {
    // Array arguments, never a shell: findNpm only hands out argvs that spawn
    // directly (bare npm on POSIX, or node running npm-cli.js everywhere).
    const child = spawn(argv[0], argv.slice(1), { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (d) => {
      output += d;
    });
    child.stderr.on('data', (d) => {
      output += d;
    });
    child.on('error', (err) => resolve({ code: 127, output: String(err) }));
    child.on('exit', (code) => resolve({ code: code ?? 1, output }));
  });
}

/** Spawn the staged entry's own `verify` and trust only a {"ok":true} answer. */
async function runVerify(entry: string): Promise<{ ok: boolean; version?: string; error?: string }> {
  const res = await run([process.execPath, entry, 'verify']);
  try {
    const lastJson = res.output
      .trim()
      .split('\n')
      .reverse()
      .find((l) => l.startsWith('{'));
    const parsed = JSON.parse(lastJson ?? '{}');
    if (parsed.ok === true) return { ok: true, version: parsed.version };
    return { ok: false, error: parsed.error ?? `verify exited ${res.code}` };
  } catch {
    return { ok: false, error: `verify answered nothing parseable (exit ${res.code})` };
  }
}

export interface StageOk {
  ok: true;
  version: string;
  entry: string;
}
export interface StageFail {
  ok: false;
  reason: 'no-npm' | 'install-failed' | 'invalid-package' | 'version-mismatch' | 'verify-failed';
  detail: string;
}

export async function stageVersion(deps: {
  home: string;
  pkg: string;
  /** Exactly one: a registry version, or a tarball/spec via --from. */
  source: { version?: string; from?: string };
  registry?: string;
  /** undefined = go find npm; null = there is none (tests, degraded UI). */
  npmArgv?: NpmArgv | null;
  runImpl?: (argv: string[]) => Promise<{ code: number; output: string }>;
  verifyImpl?: (entry: string) => Promise<{ ok: boolean; version?: string; error?: string }>;
  /** Versions pruning must never delete, above all the one currently running. */
  keep?: Set<string>;
  env?: Record<string, string | undefined>;
}): Promise<StageOk | StageFail> {
  const env = deps.env ?? process.env;
  const npmArgv = deps.npmArgv !== undefined ? deps.npmArgv : findNpm({ env });
  if (!npmArgv) {
    return { ok: false, reason: 'no-npm', detail: 'npm is not reachable from this process' };
  }
  const doRun = deps.runImpl ?? run;
  const doVerify = deps.verifyImpl ?? runVerify;
  const registry = deps.registry ?? env.SCENRI_REGISTRY;

  const workdir = join(stagingDir(deps.home), 'next');
  rmSync(workdir, { recursive: true, force: true });
  mkdirSync(workdir, { recursive: true });
  const discard = (fail: StageFail): StageFail => {
    rmSync(stagingDir(deps.home), { recursive: true, force: true });
    return fail;
  };

  const spec = deps.source.from ?? `${deps.pkg}@${deps.source.version}`;
  const installed = await doRun([
    ...npmArgv,
    'install',
    spec,
    '--prefix',
    workdir,
    '--omit=dev',
    '--no-audit',
    '--no-fund',
    '--loglevel=error',
    ...(registry ? ['--registry', registry] : []),
  ]);
  if (installed.code !== 0) {
    return discard({ ok: false, reason: 'install-failed', detail: installed.output.slice(-400) });
  }

  let manifest: { name?: string; version?: string };
  try {
    manifest = JSON.parse(readFileSync(join(workdir, 'node_modules', deps.pkg, 'package.json'), 'utf8'));
  } catch {
    return discard({ ok: false, reason: 'invalid-package', detail: `no ${deps.pkg} package.json in the install` });
  }
  if (manifest.name !== deps.pkg || !manifest.version) {
    return discard({ ok: false, reason: 'invalid-package', detail: `installed "${manifest.name}", not ${deps.pkg}` });
  }
  if (deps.source.version && manifest.version !== deps.source.version) {
    return discard({
      ok: false,
      reason: 'version-mismatch',
      detail: `asked for ${deps.source.version}, npm delivered ${manifest.version}`,
    });
  }
  const version = manifest.version;

  const verdict = await doVerify(join(workdir, 'node_modules', deps.pkg, 'dist', 'index.js'));
  if (!verdict.ok || verdict.version !== version) {
    return discard({
      ok: false,
      reason: 'verify-failed',
      detail: verdict.error ?? `verify answered ${verdict.version}, expected ${version}`,
    });
  }

  const target = join(versionsDir(deps.home), version);
  if (!isValidVersionDir(deps.home, deps.pkg, version)) {
    rmSync(target, { recursive: true, force: true });
    mkdirSync(dirname(target), { recursive: true });
    renameSync(workdir, target);
  }
  pruneStaged(deps.home, deps.pkg, new Set([version, ...(deps.keep ?? [])]));

  return { ok: true, version, entry: entryOf(deps.home, deps.pkg, version) };
}
