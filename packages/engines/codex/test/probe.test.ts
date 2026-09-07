import { EventEmitter } from 'node:events';
import type { spawn } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { createRunner, execArgs } from '../src/run.js';

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

/**
 * Captured live on 2026-09-07. The Codex desktop app had written
 * model = "gpt-6-astra" into ~/.codex/config.toml, and the npm CLI beside it
 * was 0.145.0. Scenri passes no --model, so every exec inherited that model and
 * died with codex's own 400 while the probe kept answering ready: the version
 * met the floor and login status exited 0. The exec that finds out has to tell
 * the probe, or the setup wizard shows a green check under a failed shot.
 */
const MODEL_NEEDS_NEWER_CODEX =
  'OpenAI Codex v0.145.0\n--------\nworkdir: /tmp/scenri-codex-x\nmodel: gpt-6-astra\nprovider: openai\n' +
  'approval: never\nsandbox: workspace-write [workdir, /tmp]\nreasoning effort: low\n--------\nuser\n...\n' +
  'warning: Model metadata for `gpt-6-astra` not found. Defaulting to fallback metadata; this can degrade performance and cause issues.\n' +
  'ERROR: {"type":"error","status":400,"error":{"type":"invalid_request_error","message":"The \'gpt-6-astra\' model requires a newer version of Codex. Please upgrade to the latest app or CLI and try again."}}\n';

describe('a model the installed codex cannot serve', () => {
  it('turns the probe to update-needed for that version, and back to ready once codex is newer', async () => {
    let version = '0.145.0';
    const { spawnImpl } = scriptedSpawn((call) => {
      if (call.args[0] === '--version') versionOf(call, version);
      else if (call.args[0] === 'exec') {
        call.child.stderr.emit('data', MODEL_NEEDS_NEWER_CODEX);
        call.child.emit('exit', 1, null);
      } else call.child.emit('exit', 0, null);
    });
    const runner = createRunner({ spawnImpl, platform: 'linux' });
    await expect(runner.probe()).resolves.toEqual({ ok: true });

    await expect(runner.run(execArgs('/tmp/scenri-codex-x'))).rejects.toThrow(
      'Codex CLI 0.145.0 is too old for the model it is set to, gpt-6-astra. Update Codex CLI, then run this again.',
    );

    // No invalidate in between: the failed exec itself has to retire the cached "ready".
    const avail = await runner.probe();
    expect(avail).toMatchObject({ ok: false, code: 'update-needed' });
    expect(avail.reason).toBe('Codex CLI 0.145.0 is too old for the model it is set to, gpt-6-astra.');

    // "Check again" without updating changes nothing: same version, same verdict.
    runner.invalidateProbe();
    expect((await runner.probe()).code).toBe('update-needed');

    version = '0.153.4';
    runner.invalidateProbe();
    await expect(runner.probe()).resolves.toEqual({ ok: true });
  });
});
