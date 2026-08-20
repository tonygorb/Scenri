/**
 * The supervising launcher — the code that gets frozen in npx caches, so it
 * stays small, boring, and on node builtins only.
 *
 * Protocol v1, the frozen commitments (docs/updates.md):
 *   1. versions dir derivation: $SCENRI_HOME/app/versions/<v>/node_modules/<pkg>
 *   2. the child argv: node <entry> serve, where entry is dist/index.js
 *   3. child exit 75 (EX_TEMPFAIL) = respawn whatever is newest now
 *   4. SIGINT/SIGTERM are forwarded; a signalled exit never respawns
 *   5. env: SCENRI_SUPERVISED=1, SCENRI_LAUNCHER_PROTOCOL, SCENRI_LAUNCHER_VERSION
 * Any behavioural change bumps SCENRI_LAUNCHER_PROTOCOL, and the app refuses
 * one-click updates it cannot trust the supervisor to finish.
 */
import { spawn } from 'node:child_process';
import { compareSemver, entryOf, newestStaged } from './update/versionsDir.js';

export const RESTART_EXIT_CODE = 75; // EX_TEMPFAIL: "try again", which is exactly what a restart is
export const LAUNCHER_PROTOCOL = '1';

/** Three spawns inside a minute is a loop, not a lifecycle. */
const LOOP_WINDOW_MS = 60_000;
const LOOP_MAX_STARTS = 3;
/** A child gone within this is "died at boot", not "served and stopped". */
const QUICK_DEATH_MS = 10_000;

interface ChildLike {
  on(event: 'exit', fn: (code: number | null, signal: NodeJS.Signals | null) => void): void;
  kill(signal: NodeJS.Signals): boolean | undefined;
}

export interface LauncherSpawnOptions {
  stdio: 'inherit';
  env: Record<string, string | undefined>;
}

export interface LauncherDeps {
  home: string;
  pkg: string;
  ownVersion: string;
  ownEntry: string;
  spawnImpl?: (cmd: string, args: string[], opts: LauncherSpawnOptions) => ChildLike;
  onSignal?: (handler: (sig: NodeJS.Signals) => void) => void;
  log?: (line: string) => void;
  now?: () => number;
  env?: Record<string, string | undefined>;
}

export async function runLauncher(deps: LauncherDeps): Promise<number> {
  const spawnImpl =
    deps.spawnImpl ?? ((cmd, args, opts) => spawn(cmd, args, opts as Parameters<typeof spawn>[2]) as ChildLike);
  const log = deps.log ?? console.log;
  const now = deps.now ?? Date.now;
  const baseEnv = deps.env ?? process.env;

  let signalled: NodeJS.Signals | null = null;
  let child: ChildLike | null = null;
  const forward = (sig: NodeJS.Signals) => {
    signalled = sig;
    child?.kill(sig);
  };
  (
    deps.onSignal ??
    ((handler: (sig: NodeJS.Signals) => void) => {
      process.on('SIGINT', () => handler('SIGINT'));
      process.on('SIGTERM', () => handler('SIGTERM'));
    })
  )(forward);

  const starts: number[] = [];
  // One strike and a staged version is out for this run: fall through to the
  // build bundled with the launcher, which by definition once worked.
  let distrustStaged = false;

  for (;;) {
    const staged = distrustStaged ? null : newestStaged(deps.home, deps.pkg);
    const useStaged = staged !== null && compareSemver(staged, deps.ownVersion) > 0;
    const entry = useStaged ? entryOf(deps.home, deps.pkg, staged) : deps.ownEntry;

    const startedAt = now();
    starts.push(startedAt);
    while (starts.length > 0 && startedAt - starts[0] > LOOP_WINDOW_MS) starts.shift();
    if (starts.length > LOOP_MAX_STARTS) {
      log('  Scenri is restarting in a loop and has stopped trying.');
      log('  Recover with:  rm -rf ~/.scenri/app   (app versions only, your library is untouched)');
      log('  then start fresh:  npx scenri@latest');
      return 1;
    }

    child = spawnImpl(process.execPath, [entry, 'serve'], {
      stdio: 'inherit',
      env: {
        ...baseEnv,
        SCENRI_SUPERVISED: '1',
        SCENRI_LAUNCHER_PROTOCOL: LAUNCHER_PROTOCOL,
        SCENRI_LAUNCHER_VERSION: deps.ownVersion,
      },
    });

    const { code } = await new Promise<{ code: number | null }>((resolve) => {
      (child as ChildLike).on('exit', (exitCode) => resolve({ code: exitCode }));
    });

    if (signalled) return code ?? 0;
    if (code === RESTART_EXIT_CODE) continue;
    if (code !== 0 && useStaged && now() - startedAt < QUICK_DEATH_MS) {
      log(`  Scenri ${staged} failed to start. Falling back to ${deps.ownVersion}.`);
      log('  If this keeps happening:  rm -rf ~/.scenri/app');
      distrustStaged = true;
      continue;
    }
    return code ?? 1;
  }
}
