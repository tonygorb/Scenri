/**
 * `scenri open`: what the desktop icon runs. Reuse a running Scenri, or start
 * the supervising launcher detached and hidden, wait until it answers, and put
 * the studio in the browser. The frozen bootstrap under ~/.scenri/launcher
 * only knows how to find the newest version and run `node <entry> open`; every
 * decision lives here, versioned with the app.
 *
 * Nothing here spawns a shell: every command is an executable plus an argv
 * array, and paths travel as arguments or environment, never as syntax.
 * Node builtins only, so it loads before anything native has a chance to fail.
 */
import type { SpawnOptions } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { delimiter, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openLogFd } from './log.js';

export interface SpawnedChild {
  pid?: number;
  unref(): void;
  on(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
}

export interface OpenDeps {
  /** The data home the server uses. */
  home: string;
  pkg: string;
  version: string;
  /** This build's dist/index.js; bare argv runs the supervising launcher. */
  ownEntry: string;
  env: NodeJS.ProcessEnv;
  execPath: string;
  /** GET /api/version as JSON, or null on any failure or timeout. */
  probe: (url: string, timeoutMs: number) => Promise<{ name?: string; version?: string } | null>;
  spawnImpl: (cmd: string, args: string[], opts: SpawnOptions) => SpawnedChild;
  openBrowser: (url: string) => Promise<void>;
  showDialog: (message: string) => Promise<void>;
  log: (line: string) => void;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  lockPath: string;
  pidAlive: (pid: number) => boolean;
  /** Where the detached server's stdout and stderr go. */
  serverLogPath: string;
  readLogTail: () => string;
  /** The package's starting.html template, or null when there is none to show. */
  startingTemplate: string | null;
  /** Where the rendered "Starting Scenri" page is written before it is opened. */
  startingPage: string;
  /** Older valid versions' entries, newest first, for the quick-death fallback. */
  previousEntries: string[];
  readyTimeoutMs?: number;
  pollMs?: number;
}

/** A second double-click inside this window joins the first instead of racing it. */
const LOCK_FRESH_MS = 60_000;
/** The supervisor's own rule: a version that dies this fast is broken, not slow. */
const QUICK_DEATH_MS = 10_000;

const NATIVE_MARKERS = ['NODE_MODULE_VERSION', 'Could not locate the bindings file', 'ERR_DLOPEN_FAILED'];

export async function openScenri(deps: OpenDeps): Promise<number> {
  const port = Number(deps.env.SCENRI_PORT || 4747);
  const url = `http://127.0.0.1:${port}/`;
  const noOpen = deps.env.SCENRI_NO_OPEN === '1';
  deps.log(`open: invoked by ${deps.version} for port ${port}`);

  if (!takeLock(deps)) {
    deps.log('open: another launch is in progress, stepping aside');
    return 0;
  }
  try {
    const running = await deps.probe(`${url}api/version`, 2000);
    if (running?.name === deps.pkg) {
      deps.log(`open: Scenri ${running.version ?? ''} already running, opening the browser`);
      if (!noOpen) await deps.openBrowser(url);
      return 0;
    }

    const fd = openLogFd(deps.serverLogPath);
    const child = deps.spawnImpl(deps.execPath, [deps.ownEntry], {
      detached: true,
      stdio: ['ignore', fd, fd],
      windowsHide: true,
      env: {
        ...deps.env,
        SCENRI_NO_OPEN: '1',
        SCENRI_HEADLESS: '1',
        // npm sits beside node for nvm, fnm, Volta, Homebrew and the installer,
        // and a Finder or Explorer PATH has none of them: without this the
        // server boots but one-click updates report no npm.
        PATH: [dirname(deps.execPath), deps.env.PATH].filter(Boolean).join(delimiter),
      },
    });
    child.unref();
    closeSync(fd);
    const started = deps.now();
    let exit: { code: number | null } | null = null;
    child.on('exit', (code) => {
      exit = { code };
    });
    deps.log(`open: started the supervisor, pid ${child.pid ?? 'unknown'}, log ${deps.serverLogPath}`);

    let shown = false;
    if (!noOpen && deps.startingTemplate && existsSync(deps.startingTemplate)) {
      // Rendered per launch: open(1) on macOS and Start-Process on Windows turn
      // a file URL into a path and drop its fragment, so the studio URL has to
      // travel inside the page. The only thing that changes is that one meta.
      try {
        mkdirSync(dirname(deps.startingPage), { recursive: true });
        writeFileSync(deps.startingPage, renderStartingPage(readFileSync(deps.startingTemplate, 'utf8'), url));
        await deps.openBrowser(pathToFileURL(deps.startingPage).href);
        shown = true;
        deps.log('open: showing the starting page');
      } catch (err) {
        deps.log(`open: could not show the starting page (${err instanceof Error ? err.message : String(err)})`);
      }
    }

    const deadline = started + (deps.readyTimeoutMs ?? 90_000);
    for (;;) {
      const info = await deps.probe(`${url}api/version`, 1000);
      if (info?.name === deps.pkg) {
        deps.log(`open: ready in ${deps.now() - started}ms`);
        if (!noOpen && !shown) await deps.openBrowser(url);
        return 0;
      }
      if (exit) break;
      if (deps.now() >= deadline) {
        const message = 'Scenri is taking too long to start. Open Terminal and run npx scenri to see what it is doing.';
        deps.log(`open: dialog: ${message}`);
        await deps.showDialog(message);
        return 1;
      }
      await deps.sleep(deps.pollMs ?? 250);
    }

    const lived = deps.now() - started;
    deps.log(`open: the server exited with ${(exit as { code: number | null }).code} after ${lived}ms`);
    const previous = deps.previousEntries[0];
    if (lived < QUICK_DEATH_MS && previous && !deps.env.SCENRI_DESKTOP_FALLBACK) {
      deps.log(`open: falling back to ${previous}`);
      releaseLock(deps.lockPath);
      const fallback = deps.spawnImpl(deps.execPath, [previous, 'open'], {
        stdio: 'inherit',
        env: {
          ...deps.env,
          SCENRI_DESKTOP_FALLBACK: deps.version,
          // the page is already up and polling; a second tab would be noise
          ...(shown ? { SCENRI_NO_OPEN: '1' } : {}),
        },
      });
      return await new Promise<number>((resolve) => fallback.on('exit', (code) => resolve(code ?? 1)));
    }
    const message = explain(deps.readLogTail(), port);
    deps.log(`open: dialog: ${message}`);
    await deps.showDialog(message);
    return 1;
  } finally {
    releaseLock(deps.lockPath);
  }
}

const STUDIO_URL = /^http:\/\/127\.0\.0\.1:\d{2,5}\/$/;
const STUDIO_META = '<meta name="scenri-studio" content="">';

/** The template with the studio URL in its meta. Only a loopback URL is ever written. */
export function renderStartingPage(template: string, url: string): string {
  if (!STUDIO_URL.test(url)) throw new Error(`not a studio URL: ${url}`);
  if (!template.includes(STUDIO_META)) throw new Error('starting page template has no scenri-studio meta');
  return template.replace(STUDIO_META, `<meta name="scenri-studio" content="${url}">`);
}

/** One plain sentence with the fix, from what the server printed on its way out. */
export function explain(tail: string, port: number): string {
  if (/Port \d+ is in use by another app/.test(tail)) {
    return `Port ${port} is in use by another app. Quit that app, or open Terminal and start Scenri on another port: SCENRI_PORT=${port + 1} npx scenri`;
  }
  const newer = tail.match(/This library was written by a newer Scenri[^\n]*/);
  if (newer) return newer[0];
  if (NATIVE_MARKERS.some((m) => tail.includes(m))) {
    return 'Scenri’s files do not match this Node.js. Open Terminal and run: npx scenri';
  }
  return 'Scenri could not start. Open Terminal and run npx scenri to see why.';
}

function takeLock(deps: OpenDeps): boolean {
  try {
    const held = JSON.parse(readFileSync(deps.lockPath, 'utf8')) as { pid?: number; at?: number };
    const fresh = typeof held.at === 'number' && deps.now() - held.at < LOCK_FRESH_MS;
    if (fresh && typeof held.pid === 'number' && held.pid !== process.pid && deps.pidAlive(held.pid)) return false;
  } catch {
    /* no lock, or not ours to read: take it */
  }
  try {
    writeFileSync(deps.lockPath, JSON.stringify({ pid: process.pid, at: deps.now() }));
  } catch {
    /* an unwritable launcher dir must not stop a launch */
  }
  return true;
}

function releaseLock(path: string): void {
  try {
    const held = JSON.parse(readFileSync(path, 'utf8')) as { pid?: number };
    if (held.pid === process.pid) rmSync(path, { force: true });
  } catch {
    /* already gone */
  }
}
