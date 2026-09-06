/**
 * The two commands behind the desktop icon. `desktop` adds, repairs or removes
 * it from a terminal; `open` is what the icon's bootstrap runs. Both return an
 * exit code for index.ts, like the update command.
 */
import { execFile, spawn } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { type InstallKind, detectInstallKind } from '../installKind.js';
import { readMeta } from '../meta.js';
import { compareSemver, defaultHome, entryOf, listStaged, newestStaged } from '../update/versionsDir.js';
import { adoptRunningInstall, type VerifyImpl } from './adopt.js';
import { openInBrowser } from './browser.js';
import { showDialog } from './dialog.js';
import { type InstallDeps, type InstallResult, installDesktop, removeDesktop } from './install.js';
import { appendLog } from './log.js';
import { openScenri } from './open.js';
import { type RunImpl, launcherDir, logsDir } from './paths.js';

/** The package's launcher/ dir sits beside dist/, in a checkout and in the tarball alike. */
export const assetsDirFor = (ownEntry: string): string => join(dirname(ownEntry), '..', 'launcher');

export const runExecFile: RunImpl = (cmd, args, opts) =>
  new Promise((resolve, reject) => {
    execFile(
      cmd,
      args,
      { env: { ...process.env, ...(opts?.env ?? {}) }, windowsHide: true, encoding: 'utf8', timeout: 30_000 },
      (err, stdout) => (err ? reject(err) : resolve(stdout)),
    );
  });

export function installDeps(ownEntry: string): InstallDeps {
  return {
    platform: process.platform,
    homedir: homedir(),
    home: defaultHome(),
    execPath: process.execPath,
    env: process.env,
    version: readMeta().version,
    assetsDir: assetsDirFor(ownEntry),
    runImpl: runExecFile,
  };
}

export async function runDesktopCommand(opts: { remove: boolean }, ownEntry: string): Promise<number> {
  if (opts.remove) {
    const deps = installDeps(ownEntry);
    const res = await removeDesktop(deps);
    console.log(res.removed ? `  Removed Scenri from your desktop (${res.path}).` : '  Nothing to remove.');
    if (res.message) console.log(`  ${res.message}`);
    await rememberDecline(deps.home);
    return 0;
  }
  return (await addToDesktop(ownEntry)).ok ? 0 : 1;
}

/**
 * Add or repair the icon: adopt the running build into app/versions first
 * when it runs from the npx cache or a global install, then write the
 * launcher. Shared by the command and the first-run offer, so both say the
 * same things.
 */
export async function addToDesktop(
  ownEntry: string,
  say: (line: string) => void = console.log,
  over: Partial<InstallDeps & { installKind: InstallKind; pkg: string; verifyImpl: VerifyImpl }> = {},
): Promise<InstallResult> {
  const deps: InstallDeps = { ...installDeps(ownEntry), ...over };
  const pkg = over.pkg ?? readMeta().name;
  const installKind = over.installKind ?? detectInstallKind(ownEntry, deps.home);
  if (installKind === 'dev') {
    const message = 'Running from a source checkout; there is no installed build to put on a desktop.';
    say(`  ${message}`);
    return { ok: false, reason: 'unsupported', message };
  }
  const adopted = await adoptRunningInstall({
    home: deps.home,
    pkg,
    version: deps.version,
    ownEntry,
    installKind,
    verifyImpl: over.verifyImpl,
  });
  if (adopted.adopted) {
    say(`  keeping a copy of Scenri ${deps.version} in ${join(deps.home, 'app')} so the icon works offline`);
  }
  // An icon with nothing runnable behind it would say "app files are missing"
  // on its first click. Better no icon and one sentence now.
  if (!newestStaged(deps.home, pkg)) {
    const message =
      'Scenri could not keep a runnable copy of this build for the icon. Run npx scenri once in a terminal, then try again.';
    say(`  ${message}`);
    return { ok: false, reason: 'failed', message };
  }
  const res = await installDesktop(deps);
  if (res.ok) {
    say(`  Added Scenri to your desktop: ${res.path}`);
    say('  Next time, double-click it; no terminal needed.');
  } else {
    say(`  ${res.message}`);
  }
  return res;
}

/** After an explicit remove the next run must not ask again. Best effort: the setting lives in the library. */
async function rememberDecline(home: string): Promise<void> {
  try {
    const { createCore } = await import('@scenri/core');
    const core = createCore(home);
    try {
      core.store.setSetting('desktop.prompt', 'declined');
    } finally {
      core.close();
    }
  } catch {
    /* no library yet, or a newer one: the prompt gate falls back to the record */
  }
}

export async function runOpenCommand(ownEntry: string): Promise<number> {
  const meta = readMeta();
  const home = defaultHome();
  const support = launcherDir(homedir());
  const logs = logsDir(home);
  const serverLogPath = join(logs, 'scenri.log');
  const platform = process.platform;
  const previous = listStaged(home, meta.name)
    .filter((v) => compareSemver(v, meta.version) < 0)
    .reverse()
    .map((v) => entryOf(home, meta.name, v));
  return openScenri({
    home,
    pkg: meta.name,
    version: meta.version,
    ownEntry,
    env: process.env,
    execPath: process.execPath,
    probe: async (url, timeoutMs) => {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
        return res.ok ? ((await res.json()) as { name?: string; version?: string }) : null;
      } catch {
        return null;
      }
    },
    spawnImpl: spawn,
    openBrowser: (url) => openInBrowser(url, platform, process.env),
    showDialog: (message) => showDialog(platform, message, process.env),
    log: (line) => appendLog(join(logs, 'launcher.log'), line),
    now: Date.now,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    lockPath: join(support, 'open.lock'),
    pidAlive,
    serverLogPath,
    readLogTail: () => tail(serverLogPath),
    startingTemplate: join(assetsDirFor(ownEntry), 'starting.html'),
    startingPage: join(support, 'starting.html'),
    previousEntries: previous,
  });
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as { code?: string }).code === 'EPERM';
  }
}

function tail(path: string, bytes = 4096): string {
  try {
    const size = statSync(path).size;
    const buf = readFileSync(path);
    return buf.subarray(Math.max(0, size - bytes)).toString('utf8');
  } catch {
    return '';
  }
}

export const supportInstalled = (): boolean => existsSync(join(launcherDir(homedir()), 'launcher.json'));
