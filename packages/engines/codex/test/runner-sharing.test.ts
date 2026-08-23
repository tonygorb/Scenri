import { EventEmitter } from 'node:events';
import type { spawn } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import { createRunner, type CodexRunner } from '../src/run.js';
import { createCodexSetup } from '../src/setup.js';

/**
 * One process, one runner, one cached answer. The probe result is shared by
 * every caller for a short TTL so a single page load stops spawning the same
 * two child processes four times over — and invalidation points (setup
 * actions, the wizard's own check) get a fresh answer on purpose.
 */

class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  pid = 0;
  killed = false;
  kill = () => {
    this.killed = true;
    this.emit('exit', null, 'SIGTERM');
    return true;
  };
}

type Call = { cmd: string; args: string[]; child: FakeChild };

function scriptedSpawn(script: (call: Call) => void): { spawnImpl: typeof spawn; calls: Call[] } {
  const calls: Call[] = [];
  let nextPid = 4000;
  const spawnImpl = ((cmd: string, args: string[]) => {
    const call: Call = { cmd, args, child: new FakeChild() };
    call.child.pid = nextPid++;
    calls.push(call);
    setTimeout(() => script(call), 0);
    return call.child;
  }) as unknown as typeof spawn;
  return { spawnImpl, calls };
}

const healthy = (call: Call) => {
  if (call.args[0] === '--version') call.child.stdout.emit('data', 'codex-cli 0.149.0\n');
  call.child.emit('exit', 0, null);
};

describe('probe cache', () => {
  it('serves a second probe from the cache inside the TTL', async () => {
    const { spawnImpl, calls } = scriptedSpawn(healthy);
    const runner = createRunner({ spawnImpl, platform: 'linux', probeTtlMs: 60_000 });
    await expect(runner.probe()).resolves.toEqual({ ok: true });
    await expect(runner.probe()).resolves.toEqual({ ok: true });
    expect(calls).toHaveLength(2);
  });

  it('re-probes after invalidateProbe', async () => {
    const { spawnImpl, calls } = scriptedSpawn(healthy);
    const runner = createRunner({ spawnImpl, platform: 'linux', probeTtlMs: 60_000 });
    await runner.probe();
    runner.invalidateProbe();
    await runner.probe();
    expect(calls).toHaveLength(4);
  });

  it('a TTL of zero disables the cache entirely', async () => {
    const { spawnImpl, calls } = scriptedSpawn(healthy);
    const runner = createRunner({ spawnImpl, platform: 'linux', probeTtlMs: 0 });
    await runner.probe();
    await runner.probe();
    expect(calls).toHaveLength(4);
  });
});

describe('windows kill goes through taskkill', () => {
  const whereThenIdle = (call: Call) => {
    if (call.cmd === 'where.exe') call.child.emit('exit', 1, null);
    // everything else idles: the codex line hangs, taskkill idles harmlessly
  };

  it('kills the whole tree by pid when a run times out', async () => {
    const { spawnImpl, calls } = scriptedSpawn(whereThenIdle);
    const runner = createRunner({ spawnImpl, platform: 'win32', timeoutMs: 50 });
    await expect(runner.run(['exec', 'x'])).rejects.toThrow(/timed out/);
    const tk = calls.find((c) => c.cmd === 'taskkill');
    expect(tk).toBeDefined();
    const codexCall = calls.find((c) => c.cmd !== 'where.exe' && c.cmd !== 'taskkill');
    expect(tk?.args).toEqual(['/PID', String(codexCall?.child.pid), '/T', '/F']);
  });

  it('kills the whole tree by pid when a run is aborted', async () => {
    const { spawnImpl, calls } = scriptedSpawn(whereThenIdle);
    const runner = createRunner({ spawnImpl, platform: 'win32' });
    const ctrl = new AbortController();
    const p = runner.run(['exec', 'x'], ctrl.signal);
    setTimeout(() => ctrl.abort(), 20);
    await expect(p).rejects.toThrow(/aborted/);
    expect(calls.some((c) => c.cmd === 'taskkill')).toBe(true);
  });

  it('kills a hung probe child the same way', async () => {
    const { spawnImpl, calls } = scriptedSpawn(whereThenIdle);
    const runner = createRunner({ spawnImpl, platform: 'win32', probeTimeoutMs: 50 });
    await expect(runner.probe()).resolves.toMatchObject({ code: 'unverified' });
    expect(calls.some((c) => c.cmd === 'taskkill')).toBe(true);
  });

  it('never reaches for taskkill on posix', async () => {
    const { spawnImpl, calls } = scriptedSpawn(() => {});
    const runner = createRunner({ spawnImpl, platform: 'linux', timeoutMs: 50 });
    await expect(runner.run(['exec', 'x'])).rejects.toThrow(/timed out/);
    expect(calls.some((c) => c.cmd === 'taskkill')).toBe(false);
    expect(calls[0].child.killed).toBe(true);
  });
});

describe('setup invalidates the shared probe', () => {
  function fakeRunner(): CodexRunner & { invalidations: number } {
    const r = {
      invalidations: 0,
      run: vi.fn(async () => {}),
      withWorkDir: async <T>(fn: (dir: string) => Promise<T>) => fn('/tmp/x'),
      probe: vi.fn(async () => ({ ok: true }) as const),
      invalidateProbe() {
        r.invalidations++;
      },
    };
    return r as unknown as CodexRunner & { invalidations: number };
  }

  it('status() asks for a fresh probe, because it IS the check', async () => {
    const runner = fakeRunner();
    const setup = createCodexSetup({ runner });
    await setup.status();
    expect(runner.invalidations).toBe(1);
  });

  it('install() and login() invalidate before their post-action re-probe', async () => {
    const succeed = ((cmd: string) => {
      const child = new FakeChild();
      setTimeout(() => child.emit('exit', 0, null), 0);
      void cmd;
      return child;
    }) as unknown as typeof spawn;
    const runner = fakeRunner();
    const setup = createCodexSetup({ runner, spawnImpl: succeed });
    await setup.install();
    await setup.login();
    expect(runner.invalidations).toBeGreaterThanOrEqual(2);
  });
});
