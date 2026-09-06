import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RESTART_EXIT_CODE, runLauncher } from '../src/launcher.js';
import { entryOf, versionsDir } from '../src/update/versionsDir.js';

const PKG = 'scenri';
let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'sc-launch-'));
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

function plant(version: string) {
  const root = join(versionsDir(home), version, 'node_modules', PKG);
  mkdirSync(join(root, 'dist'), { recursive: true });
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: PKG, version }));
  writeFileSync(join(root, 'dist', 'index.js'), '// staged');
}

type Exit = { code: number | null; signal?: NodeJS.Signals | null };

/** A spawn stub that hands out scripted children and records what launched. */
function scriptedSpawn(script: Array<Exit | 'hang'>) {
  const launched: { entry: string; env: Record<string, string | undefined> }[] = [];
  const children: any[] = [];
  const spawnImpl = (_cmd: string, args: string[], opts: { env: Record<string, string | undefined> }) => {
    const child = new EventEmitter() as any;
    child.kill = (sig: NodeJS.Signals) => child.emit('exit', null, sig);
    children.push(child);
    launched.push({ entry: args[0], env: opts.env });
    const step = script[launched.length - 1] ?? 'hang';
    if (step !== 'hang') setImmediate(() => child.emit('exit', step.code, step.signal ?? null));
    return child;
  };
  return { spawnImpl, launched, children };
}

const base = (over: Partial<Parameters<typeof runLauncher>[0]> = {}) => ({
  home,
  pkg: PKG,
  ownVersion: '0.1.0',
  ownEntry: '/own/dist/index.js',
  log: () => {},
  onSignal: () => {},
  ...over,
});

describe('runLauncher', () => {
  it('serves its own build when nothing newer is staged, and passes the protocol env', async () => {
    const s = scriptedSpawn([{ code: 0 }]);
    const code = await runLauncher(base({ spawnImpl: s.spawnImpl }));
    expect(code).toBe(0);
    expect(s.launched).toHaveLength(1);
    expect(s.launched[0].entry).toBe('/own/dist/index.js');
    expect(s.launched[0].env.SCENRI_SUPERVISED).toBe('1');
    expect(s.launched[0].env.SCENRI_LAUNCHER_PROTOCOL).toBe('1');
    expect(s.launched[0].env.SCENRI_LAUNCHER_VERSION).toBe('0.1.0');
  });

  it('prefers the newest staged version above its own', async () => {
    plant('0.2.0');
    plant('0.1.5');
    const s = scriptedSpawn([{ code: 0 }]);
    await runLauncher(base({ spawnImpl: s.spawnImpl }));
    expect(s.launched[0].entry).toBe(entryOf(home, PKG, '0.2.0'));
  });

  it('never launches a staged version older than itself', async () => {
    plant('0.0.9');
    const s = scriptedSpawn([{ code: 0 }]);
    await runLauncher(base({ spawnImpl: s.spawnImpl }));
    expect(s.launched[0].entry).toBe('/own/dist/index.js');
  });

  it('exit 75 re-resolves newest and respawns: the update restart', async () => {
    let t = 0;
    const s = scriptedSpawn([{ code: RESTART_EXIT_CODE }, { code: 0 }]);
    const spawnAndStage = (cmd: string, args: string[], opts: any) => {
      const child = s.spawnImpl(cmd, args, opts);
      if (s.launched.length === 1) plant('0.2.0'); // staged while the old version was serving
      return child;
    };
    const code = await runLauncher(base({ spawnImpl: spawnAndStage, now: () => (t += 30_000) }));
    expect(code).toBe(0);
    expect(s.launched.map((l) => l.entry)).toEqual(['/own/dist/index.js', entryOf(home, PKG, '0.2.0')]);
  });

  it('propagates a plain failure without respawning', async () => {
    const s = scriptedSpawn([{ code: 3 }]);
    const code = await runLauncher(base({ spawnImpl: s.spawnImpl }));
    expect(code).toBe(3);
    expect(s.launched).toHaveLength(1);
  });

  it('a forwarded signal ends the loop with no respawn', async () => {
    let sendSignal: ((sig: NodeJS.Signals) => void) | undefined;
    const s = scriptedSpawn(['hang']);
    const codeP = runLauncher(
      base({
        spawnImpl: s.spawnImpl,
        onSignal: (f: (sig: NodeJS.Signals) => void) => {
          sendSignal = f;
        },
      }),
    );
    await new Promise((r) => setImmediate(r));
    sendSignal?.('SIGTERM');
    expect(await codeP).toBe(0);
    expect(s.launched).toHaveLength(1);
  });

  it('a newest version that dies at boot falls through once to the build that works', async () => {
    plant('0.2.0');
    let t = 0;
    const s = scriptedSpawn([{ code: 1 }, { code: 0 }]);
    const lines: string[] = [];
    const code = await runLauncher(
      base({ spawnImpl: s.spawnImpl, now: () => (t += 1000), log: (l: string) => lines.push(l) }),
    );
    expect(code).toBe(0);
    expect(s.launched.map((l) => l.entry)).toEqual([entryOf(home, PKG, '0.2.0'), '/own/dist/index.js']);
    expect(lines.join('\n')).toContain('0.2.0');
  });

  it('stops a crash loop and names the recovery commands', async () => {
    const s = scriptedSpawn([
      { code: RESTART_EXIT_CODE },
      { code: RESTART_EXIT_CODE },
      { code: RESTART_EXIT_CODE },
      { code: RESTART_EXIT_CODE },
    ]);
    const lines: string[] = [];
    let t = 0;
    const code = await runLauncher(
      base({ spawnImpl: s.spawnImpl, now: () => (t += 1000), log: (l: string) => lines.push(l) }),
    );
    expect(code).toBe(1);
    expect(s.launched.length).toBeLessThanOrEqual(3);
    expect(lines.join('\n')).toContain('rm -rf');
  });
});
