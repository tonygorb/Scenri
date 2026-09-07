import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, delimiter, dirname } from 'node:path';
import { openScenri, type OpenDeps, type StartingServer } from '../src/desktop/open.js';

/**
 * `scenri open` is what the desktop icon runs: reuse a running Scenri, or
 * start the supervising launcher detached, wait for it to answer, and put the
 * studio in the browser. Everything that touches the world is injected, so
 * these tests drive it with a virtual clock and scripted children.
 */

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'sc-open-'));
  mkdirSync(join(root, 'launcher'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

type Spawned = { cmd: string; args: string[]; opts: Record<string, unknown> };

function harness(opts: {
  running?: boolean;
  /** The probe count at which the server starts answering. */
  readyAfter?: number;
  /** The supervisor exits with this code, this many virtual ms after spawn. */
  childExit?: { code: number; afterMs: number };
  fallbackCode?: number;
  env?: NodeJS.ProcessEnv;
  page?: boolean;
  /** Virtual ms after the start at which the browser has fetched the page; null: never. */
  fetchedAfter?: number | null;
  /** The page server itself cannot start. */
  pageError?: boolean;
  previousEntries?: string[];
  logTail?: string;
  alivePids?: number[];
  /** null leaves the command's own default in force. */
  timeoutMs?: number | null;
  /** Which spawn fails to start at all (an 'error' event, never an exit). */
  spawnError?: 'supervisor' | 'fallback';
}) {
  const state = {
    t: 0,
    probes: [] as string[],
    spawns: [] as Spawned[],
    opened: [] as string[],
    dialogs: [] as string[],
    logs: [] as string[],
    served: null as string | null,
    pageClosed: false,
    pageClosedWhenFallbackExited: null as boolean | null,
  };
  const pending: { at: number; fire: () => void }[] = [];
  const fire = () => {
    for (const p of pending.filter((p) => p.at <= state.t)) {
      pending.splice(pending.indexOf(p), 1);
      p.fire();
    }
  };
  const template = join(root, 'template.html');
  if (opts.page !== false) writeFileSync(template, '<meta name="scenri-studio" content="">\n<!-- page -->');
  const PAGE_URL = 'http://127.0.0.1:41234/';
  const startingServer = async (html: string): Promise<StartingServer> => {
    if (opts.pageError) throw new Error('listen EADDRNOTAVAIL');
    state.served = html;
    const fetched = () => opts.fetchedAfter !== null && state.t >= (opts.fetchedAfter ?? 0);
    return {
      url: PAGE_URL,
      wasFetched: fetched,
      userAgent: () => (fetched() ? 'TestBrowser/1.0' : null),
      close: () => {
        state.pageClosed = true;
      },
    };
  };
  let nextPid = 100;
  const deps: OpenDeps = {
    home: join(root, 'home'),
    pkg: 'scenri',
    version: '0.8.4',
    ownEntry: '/v/0.8.4/node_modules/scenri/dist/index.js',
    env: opts.env ?? {},
    execPath: '/opt/homebrew/bin/node',
    probe: async (url) => {
      state.probes.push(url);
      const ready = opts.running || (opts.readyAfter !== undefined && state.probes.length >= opts.readyAfter);
      return ready ? { name: 'scenri', version: '0.8.4' } : null;
    },
    spawnImpl: (cmd, args, o) => {
      const child = new EventEmitter() as EventEmitter & { pid: number; unref: () => void };
      child.pid = nextPid++;
      child.unref = () => undefined;
      state.spawns.push({ cmd, args, opts: o as Record<string, unknown> });
      const failing = args[1] === 'open' ? 'fallback' : 'supervisor';
      if (opts.spawnError === failing) {
        // The supervisor's error lands in virtual time like its exits do; the
        // fallback is awaited directly, so a real turn of the loop delivers it.
        const err = new Error(`spawn ${cmd} EACCES`);
        if (failing === 'fallback') setImmediate(() => child.emit('error', err));
        else pending.push({ at: state.t, fire: () => child.emit('error', err) });
      } else if (args[1] === 'open') {
        // the fallback child: answers on the next turn with its own exit code
        setImmediate(() => {
          state.pageClosedWhenFallbackExited = state.pageClosed;
          child.emit('exit', opts.fallbackCode ?? 0, null);
        });
      } else if (opts.childExit) {
        const { code, afterMs } = opts.childExit;
        pending.push({ at: state.t + afterMs, fire: () => child.emit('exit', code, null) });
      }
      return child;
    },
    openBrowser: async (url) => {
      state.opened.push(url);
    },
    showDialog: async (message) => {
      state.dialogs.push(message);
    },
    log: (line) => {
      state.logs.push(line);
    },
    now: () => state.t,
    sleep: async (ms) => {
      state.t += ms;
      fire();
    },
    lockPath: join(root, 'open.lock'),
    pidAlive: (pid) => opts.alivePids?.includes(pid) ?? false,
    serverLogPath: join(root, 'home', 'logs', 'scenri.log'),
    readLogTail: () => opts.logTail ?? '',
    startingTemplate: opts.page === false ? null : template,
    startingServer,
    previousEntries: opts.previousEntries ?? [],
    readyTimeoutMs: opts.timeoutMs === null ? undefined : (opts.timeoutMs ?? 90_000),
    pollMs: 250,
  };
  return { deps, state, PAGE_URL };
}

describe('scenri open', () => {
  it('opens the studio and starts nothing when Scenri already answers', async () => {
    const { deps, state } = harness({ running: true });
    expect(await openScenri(deps)).toBe(0);
    expect(state.probes).toEqual(['http://127.0.0.1:4747/api/version']);
    expect(state.spawns).toEqual([]);
    expect(state.opened).toEqual(['http://127.0.0.1:4747/']);
    expect(state.dialogs).toEqual([]);
  });

  it('starts the supervisor detached and hidden, shows the starting page at once, and opens nothing else once ready', async () => {
    const { deps, state, PAGE_URL } = harness({ readyAfter: 4 });
    expect(await openScenri(deps)).toBe(0);
    expect(state.spawns).toHaveLength(1);
    const [s] = state.spawns;
    expect(s.cmd).toBe('/opt/homebrew/bin/node');
    expect(s.args).toEqual(['/v/0.8.4/node_modules/scenri/dist/index.js']);
    expect(s.opts.detached).toBe(true);
    expect(s.opts.windowsHide).toBe(true);
    expect(s.opts.shell).toBeUndefined();
    const env = s.opts.env as Record<string, string>;
    expect(env.SCENRI_NO_OPEN).toBe('1');
    expect(env.SCENRI_HEADLESS).toBe('1');
    // npm lives beside node for nvm, Homebrew, Volta and the installer; a
    // Finder PATH has none of them, and findNpm() looks on PATH first.
    expect(env.PATH?.split(delimiter)[0]).toBe(dirname('/opt/homebrew/bin/node'));
    const stdio = s.opts.stdio as unknown[];
    expect(stdio[0]).toBe('ignore');
    expect(typeof stdio[1]).toBe('number');
    expect(stdio[2]).toBe(stdio[1]);
    expect(existsSync(deps.serverLogPath)).toBe(true);
    // The page reaches the browser over loopback http, so it lands in the
    // default browser and not in whatever owns .html; the studio URL rides
    // inside it, because a fragment would not survive the opener anyway.
    expect(state.opened).toEqual([PAGE_URL]);
    expect(state.served).toContain('<meta name="scenri-studio" content="http://127.0.0.1:4747/">');
    expect(state.served).toContain('<!-- page -->');
    expect(state.probes.length).toBe(4);
    expect(state.logs).toContain(`open: serving the starting page at ${PAGE_URL}`);
    expect(state.logs.some((l) => /ready in \d+ms/.test(l))).toBe(true);
    expect(state.logs).toContain('open: the browser fetched the starting page (TestBrowser/1.0)');
    expect(state.pageClosed).toBe(true);
  });

  it('opens the studio itself when no browser came for the page within the grace period', async () => {
    const { deps, state, PAGE_URL } = harness({ readyAfter: 4, fetchedAfter: null });
    // probe 1 is the pre-start check; the 4th probe answers after two sleeps
    const ready = 2 * 250;
    expect(await openScenri(deps)).toBe(0);
    expect(state.opened).toEqual([PAGE_URL, 'http://127.0.0.1:4747/']);
    expect(state.t).toBeGreaterThanOrEqual(ready + 15_000);
    expect(state.t).toBeLessThan(ready + 16_000);
    expect(state.logs).toContain('open: the browser never fetched the starting page, opening the studio directly');
    expect(state.pageClosed).toBe(true);
  });

  it('waits for the browser to fetch the page rather than for a fixed time', async () => {
    const { deps, state } = harness({ readyAfter: 4, fetchedAfter: 1500 });
    expect(await openScenri(deps)).toBe(0);
    expect(state.probes.length).toBe(4);
    expect(state.t).toBe(1500);
    expect(state.opened).toHaveLength(1);
  });

  it('shows the studio after readiness when the page server itself cannot start', async () => {
    const { deps, state } = harness({ readyAfter: 3, pageError: true });
    expect(await openScenri(deps)).toBe(0);
    expect(state.opened).toEqual(['http://127.0.0.1:4747/']);
    expect(state.logs.some((l) => /could not show the starting page.*EADDRNOTAVAIL/.test(l))).toBe(true);
  });

  it('closes the page server when the start fails', async () => {
    const { deps, state } = harness({ childExit: { code: 1, afterMs: 500 } });
    expect(await openScenri(deps)).toBe(1);
    expect(state.pageClosed).toBe(true);
  });

  it('opens the studio itself after readiness when there is no starting page to show', async () => {
    const { deps, state } = harness({ readyAfter: 3, page: false });
    expect(await openScenri(deps)).toBe(0);
    expect(state.opened).toEqual(['http://127.0.0.1:4747/']);
  });

  it('respects SCENRI_PORT for the probe, the page and the server', async () => {
    const { deps, state } = harness({ readyAfter: 2, env: { SCENRI_PORT: '4800' } });
    expect(await openScenri(deps)).toBe(0);
    expect(state.probes[0]).toBe('http://127.0.0.1:4800/api/version');
    expect(state.served).toContain('content="http://127.0.0.1:4800/"');
    expect((state.spawns[0].opts.env as Record<string, string>).SCENRI_PORT).toBe('4800');
  });

  it('opens no browser at all under SCENRI_NO_OPEN', async () => {
    const { deps, state } = harness({ readyAfter: 2, env: { SCENRI_NO_OPEN: '1' } });
    expect(await openScenri(deps)).toBe(0);
    expect(state.opened).toEqual([]);
  });

  it('explains a port held by another app when the server dies saying so', async () => {
    const { deps, state } = harness({
      childExit: { code: 1, afterMs: 600 },
      logTail: '\n  Port 4747 is in use by another app.\n  Start Scenri on a different port:\n',
    });
    expect(await openScenri(deps)).toBe(1);
    expect(state.dialogs).toHaveLength(1);
    expect(state.dialogs[0]).toContain('Port 4747 is in use by another app');
    expect(state.dialogs[0]).toContain('SCENRI_PORT=4748 npx scenri');
    // support reads the log, not the screen: the sentence shown is the sentence logged
    expect(state.logs.some((l) => l.includes('dialog: Port 4747 is in use by another app'))).toBe(true);
  });

  it('passes a newer-library refusal through in its own words', async () => {
    const { deps, state } = harness({
      childExit: { code: 1, afterMs: 300 },
      logTail:
        'This library was written by a newer Scenri (schema 3; this build understands 2). Update and retry: npx scenri@latest',
    });
    expect(await openScenri(deps)).toBe(1);
    expect(state.dialogs[0]).toContain('written by a newer Scenri');
  });

  it('says Node changed when the server dies on a native module, in the words the server already uses', async () => {
    // Seen on a real Desktop: the recorded node was gone, the fallback found a
    // node of another major, and better-sqlite3 refused to load.
    const { deps, state } = harness({
      childExit: { code: 1, afterMs: 500 },
      logTail:
        '  Scenri could not start: a native component failed to load.\n  This usually means Node changed since this copy of Scenri was installed.\n',
    });
    expect(await openScenri(deps)).toBe(1);
    expect(state.dialogs[0]).toContain('Node.js changed');
    expect(state.dialogs[0]).toContain('npx scenri@latest');
  });

  it('names the address in a dialog when the browser itself cannot be opened', async () => {
    // The server is fine; only the last step failed. Silence here would look
    // exactly like a launcher that did nothing.
    const running = harness({ running: true });
    running.deps.openBrowser = async () => {
      throw new Error('no opener');
    };
    expect(await openScenri(running.deps)).toBe(0);
    expect(running.state.dialogs).toHaveLength(1);
    expect(running.state.dialogs[0]).toContain('http://127.0.0.1:4747/');
    expect(running.state.logs.some((l) => l.includes('browser'))).toBe(true);

    const cold = harness({ readyAfter: 3, page: false });
    cold.deps.openBrowser = async () => {
      throw new Error('no opener');
    };
    expect(await openScenri(cold.deps)).toBe(0);
    expect(cold.state.dialogs[0]).toContain('http://127.0.0.1:4747/');
  });

  it('gives up with a plain sentence when the server never answers', async () => {
    const { deps, state } = harness({ timeoutMs: 2_000 });
    expect(await openScenri(deps)).toBe(1);
    expect(state.dialogs).toEqual([
      'Scenri is taking too long to start. Open Terminal and run npx scenri to see what it is doing.',
    ]);
  });

  it('falls back to the previous version once when this one dies young', async () => {
    const prev = '/v/0.8.3/node_modules/scenri/dist/index.js';
    const { deps, state } = harness({ childExit: { code: 1, afterMs: 500 }, previousEntries: [prev], fallbackCode: 0 });
    expect(await openScenri(deps)).toBe(0);
    expect(state.spawns).toHaveLength(2);
    expect(state.spawns[1].args).toEqual([prev, 'open']);
    const env = state.spawns[1].opts.env as Record<string, string>;
    expect(env.SCENRI_DESKTOP_FALLBACK).toBe('0.8.4');
    // the page is already up and polling; the fallback must not open a second tab
    expect(env.SCENRI_NO_OPEN).toBe('1');
    expect(state.dialogs).toEqual([]);
    // and the page stays served until the fallback has had its say
    expect(state.pageClosedWhenFallbackExited).toBe(false);
    expect(state.pageClosed).toBe(true);
  });

  it('does not fall back from a fallback, and does not fall back after a slow death', async () => {
    const prev = '/v/0.8.3/node_modules/scenri/dist/index.js';
    const a = harness({
      childExit: { code: 1, afterMs: 500 },
      previousEntries: [prev],
      env: { SCENRI_DESKTOP_FALLBACK: '0.8.5' },
    });
    expect(await openScenri(a.deps)).toBe(1);
    expect(a.state.spawns).toHaveLength(1);
    expect(a.state.dialogs).toHaveLength(1);
    const b = harness({ childExit: { code: 1, afterMs: 30_000 }, previousEntries: [prev] });
    expect(await openScenri(b.deps)).toBe(1);
    expect(b.state.spawns).toHaveLength(1);
  });

  it('steps aside while another launch holds a fresh lock, and ignores a stale one', async () => {
    const fresh = harness({ readyAfter: 2, alivePids: [4242] });
    writeFileSync(fresh.deps.lockPath, JSON.stringify({ pid: 4242, at: 0 }));
    expect(await openScenri(fresh.deps)).toBe(0);
    expect(fresh.state.spawns).toEqual([]);
    expect(fresh.state.opened).toEqual([]);

    const stale = harness({ readyAfter: 2, alivePids: [] });
    writeFileSync(stale.deps.lockPath, JSON.stringify({ pid: 4242, at: 0 }));
    expect(await openScenri(stale.deps)).toBe(0);
    expect(stale.state.spawns).toHaveLength(1);
    expect(existsSync(stale.deps.lockPath)).toBe(false);
  });

  it('writes the lock while it works and clears it after', async () => {
    const { deps, state } = harness({ readyAfter: 3 });
    let seen: string | null = null;
    deps.probe = (async (url: string) => {
      state.probes.push(url);
      seen ??= existsSync(deps.lockPath) ? readFileSync(deps.lockPath, 'utf8') : null;
      return state.probes.length >= 3 ? { name: 'scenri', version: '0.8.4' } : null;
    }) as OpenDeps['probe'];
    await openScenri(deps);
    expect(seen).not.toBeNull();
    expect(JSON.parse(String(seen)).pid).toBe(process.pid);
    expect(existsSync(deps.lockPath)).toBe(false);
  });

  it('names itself, its node and its platform on the first log line, so a log alone says what ran', async () => {
    const { deps, state } = harness({ running: true });
    await openScenri(deps);
    expect(state.logs[0]).toMatch(
      /^open: invoked by 0\.8\.4 \(\/opt\/homebrew\/bin\/node, node v\d+\.\d+\.\d+, \w+, cwd .+\) for port 4747$/,
    );
  });

  it('says so and returns 1 when the supervisor cannot even be started', async () => {
    const { deps, state } = harness({ spawnError: 'supervisor' });
    expect(await openScenri(deps)).toBe(1);
    expect(state.logs.join('\n')).toMatch(/could not start the supervisor.*EACCES/);
    expect(state.dialogs).toHaveLength(1);
    expect(state.dialogs[0]).toMatch(/Scenri could not start/);
    expect(existsSync(deps.lockPath)).toBe(false);
  });

  it('returns 1 instead of hanging when the fallback version cannot be started', async () => {
    const { deps, state } = harness({
      childExit: { code: 1, afterMs: 500 },
      previousEntries: ['/v/0.8.3/node_modules/scenri/dist/index.js'],
      spawnError: 'fallback',
    });
    expect(await openScenri(deps)).toBe(1);
    expect(state.spawns).toHaveLength(2);
    expect(state.logs.join('\n')).toMatch(/could not start the fallback.*EACCES/);
  });

  it('starts the fallback version without a console window of its own', async () => {
    const { deps, state } = harness({
      childExit: { code: 1, afterMs: 500 },
      previousEntries: ['/v/0.8.3/node_modules/scenri/dist/index.js'],
    });
    await openScenri(deps);
    expect(state.spawns[1].args[1]).toBe('open');
    expect(state.spawns[1].opts.windowsHide).toBe(true);
  });

  it('still opens the browser from under another launch\u2019s lock when Scenri already answers', async () => {
    const { deps, state } = harness({ running: true, alivePids: [4242] });
    writeFileSync(deps.lockPath, JSON.stringify({ pid: 4242, at: 0 }));
    expect(await openScenri(deps)).toBe(0);
    expect(state.opened).toEqual(['http://127.0.0.1:4747/']);
    expect(state.spawns).toHaveLength(0);
    expect(JSON.parse(readFileSync(deps.lockPath, 'utf8')).pid).toBe(4242);
  });

  it('waits three minutes by default before calling a start too slow: a first Defender scan is not a failure', async () => {
    const { deps, state } = harness({ timeoutMs: null });
    expect(await openScenri(deps)).toBe(1);
    expect(state.t).toBeGreaterThanOrEqual(180_000);
    expect(state.t).toBeLessThan(181_000);
    expect(state.dialogs[0]).toMatch(/taking too long/);
  });
});
