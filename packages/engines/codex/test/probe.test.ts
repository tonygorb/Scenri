import { EventEmitter } from 'node:events';
import type { spawn } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { createRunner } from '../src/run.js';

/**
 * The probe's honesty contract. Every outcome that is not a verified exit code
 * maps to a state the setup UI can act on, and "I could not tell" is one of
 * them — a probe that cannot answer must never report ready, and must never
 * hang the request that asked.
 */

class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  killed = false;
  kill = () => {
    this.killed = true;
    this.emit('exit', null, 'SIGTERM');
    return true;
  };
}

type Call = { cmd: string; args: string[]; opts: Record<string, unknown>; child: FakeChild };

/** Route each spawned command to a scripted behavior; unscripted commands idle. */
function scriptedSpawn(script: (call: Call) => void): { spawnImpl: typeof spawn; calls: Call[] } {
  const calls: Call[] = [];
  const spawnImpl = ((cmd: string, args: string[], opts: Record<string, unknown>) => {
    const call: Call = { cmd, args, opts, child: new FakeChild() };
    calls.push(call);
    setTimeout(() => script(call), 0);
    return call.child;
  }) as unknown as typeof spawn;
  return { spawnImpl, calls };
}

const versionOf = (call: Call, version: string) => {
  call.child.stdout.emit('data', `codex-cli ${version}\r\n`);
  call.child.emit('exit', 0, null);
};

describe('probe verdicts', () => {
  it('reports unverified when --version hangs, kills the child, and never asks about login', async () => {
    const { spawnImpl, calls } = scriptedSpawn(() => {});
    const runner = createRunner({ spawnImpl, platform: 'linux', probeTimeoutMs: 50 });
    const avail = await runner.probe();
    expect(avail.ok).toBe(false);
    expect(avail.code).toBe('unverified');
    expect(avail.reason).toMatch(/could not verify codex/i);
    expect(calls).toHaveLength(1);
    expect(calls[0].child.killed).toBe(true);
  });

  it('reports unverified when login status hangs, never ready', async () => {
    const { spawnImpl, calls } = scriptedSpawn((call) => {
      if (call.args[0] === '--version') versionOf(call, '0.149.0');
    });
    const runner = createRunner({ spawnImpl, platform: 'linux', probeTimeoutMs: 50 });
    const avail = await runner.probe();
    expect(avail).toMatchObject({ ok: false, code: 'unverified' });
    expect(calls[1].child.killed).toBe(true);
  });

  it('reports update-needed below the floor, without asking about login', async () => {
    const { spawnImpl, calls } = scriptedSpawn((call) => versionOf(call, '0.140.0'));
    const runner = createRunner({ spawnImpl, platform: 'linux' });
    const avail = await runner.probe();
    expect(avail.ok).toBe(false);
    expect(avail.code).toBe('update-needed');
    expect(avail.reason).toContain('0.140.0');
    expect(avail.reason).toContain('0.145.0');
    expect(calls).toHaveLength(1);
  });

  it('reports ready when the version meets the floor and login status exits 0', async () => {
    const { spawnImpl } = scriptedSpawn((call) => {
      if (call.args[0] === '--version') versionOf(call, '0.149.0');
      else call.child.emit('exit', 0, null);
    });
    const runner = createRunner({ spawnImpl, platform: 'linux' });
    await expect(runner.probe()).resolves.toEqual({ ok: true });
  });

  it('lets an unparseable version through to the login check rather than failing it', async () => {
    const { spawnImpl } = scriptedSpawn((call) => {
      if (call.args[0] === '--version') {
        call.child.stdout.emit('data', 'something nightly\n');
        call.child.emit('exit', 0, null);
      } else {
        call.child.emit('exit', 0, null);
      }
    });
    const runner = createRunner({ spawnImpl, platform: 'linux' });
    await expect(runner.probe()).resolves.toEqual({ ok: true });
  });
});

describe('probe spawn shapes on win32', () => {
  const exePath = String.raw`C:\Program Files\Codex\codex.exe`;

  it('spawns a where-resolved codex.exe argv-style with no shell', async () => {
    const { spawnImpl, calls } = scriptedSpawn((call) => {
      if (call.cmd === 'where.exe') {
        call.child.stdout.emit('data', `${exePath}\r\n`);
        call.child.emit('exit', 0, null);
      } else if (call.args[0] === '--version') {
        versionOf(call, '0.149.0');
      } else {
        call.child.emit('exit', 0, null);
      }
    });
    const runner = createRunner({ spawnImpl, platform: 'win32' });
    await expect(runner.probe()).resolves.toEqual({ ok: true });
    const codexCalls = calls.filter((c) => c.cmd !== 'where.exe');
    expect(codexCalls[0].cmd).toBe(exePath);
    expect(codexCalls[0].args).toEqual(['--version']);
    expect(codexCalls[0].opts.shell).toBeUndefined();
  });

  it('keeps the quoted shell line when only the .cmd shim exists', async () => {
    const { spawnImpl, calls } = scriptedSpawn((call) => {
      if (call.cmd === 'where.exe') {
        call.child.stdout.emit('data', 'C:\\Users\\t\\AppData\\Roaming\\npm\\codex.cmd\r\n');
        call.child.emit('exit', 0, null);
      } else if (call.cmd.includes('--version')) {
        versionOf(call, '0.149.0');
      } else {
        call.child.emit('exit', 0, null);
      }
    });
    const runner = createRunner({ spawnImpl, platform: 'win32' });
    await expect(runner.probe()).resolves.toEqual({ ok: true });
    const codexCalls = calls.filter((c) => c.cmd !== 'where.exe');
    expect(codexCalls[0].cmd).toBe('codex "--version"');
    expect(codexCalls[0].opts.shell).toBe(true);
  });
});
