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
import { closeSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { delimiter, dirname } from 'node:path';
import { openLogFd } from './log.js';
import type { StartingServer } from './startingPage.js';

export type { StartingServer } from './startingPage.js';

export interface SpawnedChild {
  pid?: number;
  unref(): void;
  on(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
  on(event: 'error', listener: (err: Error) => void): unknown;
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
  /** Serves the rendered page over loopback http for the seconds the start takes. */
  startingServer?: (html: string) => Promise<StartingServer>;
  /** Older valid versions' entries, newest first, for the quick-death fallback. */
  previousEntries: string[];
  readyTimeoutMs?: number;
  pollMs?: number;
}

/** A second double-click inside this window joins the first instead of racing it. */
const LOCK_FRESH_MS = 60_000;
/** A cold first start on a laptop, Defender's first-touch scan of node_modules included. */
const READY_TIMEOUT_MS = 180_000;
/** How long a browser gets to come for the page once the studio is up, before the studio is opened for it. */
const PAGE_FETCH_GRACE_MS = 15_000;
/** The supervisor's own rule: a version that dies this fast is broken, not slow. */
const QUICK_DEATH_MS = 10_000;

const NATIVE_MARKERS = ['NODE_MODULE_VERSION', 'Could not locate the bindings file', 'ERR_DLOPEN_FAILED'];

/** The last step, and the one a person actually sees: a browser that will not open gets the address in a dialog. */
async function showBrowser(deps: OpenDeps, url: string): Promise<void> {
  try {
    await deps.openBrowser(url);
  } catch (err) {
    deps.log(`open: the browser could not be opened (${err instanceof Error ? err.message : String(err)})`);
    const message = `Scenri is running at ${url} but the browser could not be opened. Open that address in your browser.`;
    deps.log(`open: dialog: ${message}`);
    await deps.showDialog(message);
  }
}

export async function openScenri(deps: OpenDeps): Promise<number> {
  const port = Number(deps.env.SCENRI_PORT || 4747);
  const url = `http://127.0.0.1:${port}/`;
  const noOpen = deps.env.SCENRI_NO_OPEN === '1';
  // Everything a log alone has to say about what ran: the version, the node
  // the icon chose, and where it stood.
  deps.log(
    `open: invoked by ${deps.version} (${deps.execPath}, node ${process.version}, ${process.platform}, cwd ${process.cwd()}) for port ${port}`,
  );

  let page: StartingServer | null = null;
  if (!takeLock(deps)) {
    // A second click during a launch joins it. When the server is already
    // answering, joining means the browser; only a start still in progress
    // has nothing to show yet.
    const running = await deps.probe(`${url}api/version`, 2000);
    if (running?.name === deps.pkg) {
      deps.log('open: another launch is in progress and Scenri already answers, opening the browser');
      if (!noOpen) await showBrowser(deps, url);
      return 0;
    }
    deps.log('open: another launch is in progress, stepping aside');
    return 0;
  }
  try {
    const running = await deps.probe(`${url}api/version`, 2000);
    if (running?.name === deps.pkg) {
      deps.log(`open: Scenri ${running.version ?? ''} already running, opening the browser`);
      if (!noOpen) await showBrowser(deps, url);
      return 0;
    }

    const fd = openLogFd(deps.serverLogPath);
    const started = deps.now();
    let exit: { code: number | null } | null = null;
    let spawnError: Error | null = null;
    let child: SpawnedChild;
    try {
      child = deps.spawnImpl(deps.execPath, [deps.ownEntry], {
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
    } catch (err) {
      closeSync(fd);
      return await couldNotStart(deps, err);
    }
    child.unref();
    closeSync(fd);
    // A node that cannot be executed at all arrives as an event, not an exit;
    // unhandled it would take this process down with it.
    child.on('error', (err) => {
      spawnError = err;
      exit = { code: null };
    });
    child.on('exit', (code) => {
      exit = { code };
    });
    deps.log(`open: started the supervisor, pid ${child.pid ?? 'unknown'}, log ${deps.serverLogPath}`);

    let shown = false;
    if (!noOpen && deps.startingTemplate && existsSync(deps.startingTemplate) && deps.startingServer) {
      // Served over loopback http for the seconds a cold start takes: an http
      // URL lands in the default browser on every OS, where a file would land
      // in whatever owns .html and, on Windows, lose its fragment on the way.
      // The studio URL rides inside the page all the same, in its one meta.
      try {
        page = await deps.startingServer(renderStartingPage(readFileSync(deps.startingTemplate, 'utf8'), url));
        deps.log(`open: serving the starting page at ${page.url}`);
        await deps.openBrowser(page.url);
        shown = true;
        deps.log('open: showing the starting page');
      } catch (err) {
        deps.log(`open: could not show the starting page (${err instanceof Error ? err.message : String(err)})`);
      }
    }

    const deadline = started + (deps.readyTimeoutMs ?? READY_TIMEOUT_MS);
    for (;;) {
      const info = await deps.probe(`${url}api/version`, 1000);
      if (info?.name === deps.pkg) {
        deps.log(`open: ready in ${deps.now() - started}ms`);
        if (!noOpen) await handOver(deps, url, shown ? page : null);
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

    if (spawnError) return await couldNotStart(deps, spawnError);
    const lived = deps.now() - started;
    deps.log(`open: the server exited with ${(exit as { code: number | null }).code} after ${lived}ms`);
    const previous = deps.previousEntries[0];
    if (lived < QUICK_DEATH_MS && previous && !deps.env.SCENRI_DESKTOP_FALLBACK) {
      deps.log(`open: falling back to ${previous}`);
      releaseLock(deps.lockPath);
      const fallback = deps.spawnImpl(deps.execPath, [previous, 'open'], {
        stdio: 'inherit',
        // This process has no console; without the hint Windows would give
        // the fallback a visible one.
        windowsHide: true,
        env: {
          ...deps.env,
          SCENRI_DESKTOP_FALLBACK: deps.version,
          // the page is already up and polling; a second tab would be noise
          ...(shown ? { SCENRI_NO_OPEN: '1' } : {}),
        },
      });
      return await new Promise<number>((resolve) => {
        fallback.on('error', (err) => {
          deps.log(`open: could not start the fallback (${err.message})`);
          resolve(1);
        });
        fallback.on('exit', (code) => resolve(code ?? 1));
      });
    }
    const message = explain(deps.readLogTail(), port);
    deps.log(`open: dialog: ${message}`);
    await deps.showDialog(message);
    return 1;
  } finally {
    // After the fallback too: its server is what the page is polling for.
    page?.close();
    releaseLock(deps.lockPath);
  }
}

/**
 * The page redirects itself the moment the studio answers, so a browser that
 * fetched it needs nothing more. One that never came within the grace period
 * (a helper that lied about succeeding, a browser that took too long) gets the
 * studio opened for it, which is the same call as having had no page at all.
 */
async function handOver(deps: OpenDeps, url: string, page: StartingServer | null): Promise<void> {
  if (!page) return showBrowser(deps, url);
  const until = deps.now() + PAGE_FETCH_GRACE_MS;
  while (!page.wasFetched() && deps.now() < until) await deps.sleep(deps.pollMs ?? 250);
  if (page.wasFetched()) {
    deps.log(`open: the browser fetched the starting page (${page.userAgent() ?? 'unknown browser'})`);
    return;
  }
  deps.log('open: the browser never fetched the starting page, opening the studio directly');
  await showBrowser(deps, url);
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
  if (tail.includes('a native component failed to load') || NATIVE_MARKERS.some((m) => tail.includes(m))) {
    return 'Node.js changed since Scenri was installed. Open Terminal and run: npx scenri@latest';
  }
  return 'Scenri could not start. Open Terminal and run npx scenri to see why.';
}

/** The supervisor never became a process: the node itself is the problem, so no fallback and one sentence. */
async function couldNotStart(deps: OpenDeps, err: unknown): Promise<number> {
  const reason = err instanceof Error ? err.message : String(err);
  deps.log(`open: could not start the supervisor (${reason})`);
  const message = `Scenri could not start (${reason}). Open Terminal and run npx scenri to see why.`;
  deps.log(`open: dialog: ${message}`);
  await deps.showDialog(message);
  return 1;
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
