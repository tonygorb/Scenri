import { EventEmitter } from 'node:events';
import type { spawn } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { createRunner } from '../src/run.js';
import { createCodexSetup } from '../src/setup.js';

/**
 * The win32 spawn contract. codex is codex.cmd there, which only runs through
 * a shell, and the prompt argument can quote imported library text, so the
 * line the shell receives must leave cmd.exe nothing to interpret: every
 * argument quoted, embedded quotes and percent signs substituted away,
 * newlines flattened.
 */

type Call = {
  cmd: string;
  args: string[];
  opts: Record<string, unknown>;
  child: EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; kill: () => void };
};

function fakeSpawn(before?: (call: Call) => void): { spawnImpl: typeof spawn; calls: Call[] } {
  const calls: Call[] = [];
  const spawnImpl = ((cmd: string, args: string[], opts: Record<string, unknown>) => {
    const child = new EventEmitter() as Call['child'];
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {};
    const call: Call = { cmd, args, opts, child };
    calls.push(call);
    setTimeout(() => {
      before?.(call);
      child.emit('exit', 0, null);
    }, 0);
    return child;
  }) as unknown as typeof spawn;
  return { spawnImpl, calls };
}

describe('codex spawn on win32', () => {
  it('joins one fully quoted shell line and defuses cmd.exe metacharacters when only the shim exists', async () => {
    const { spawnImpl, calls } = fakeSpawn();
    const runner = createRunner({ spawnImpl, platform: 'win32' });
    await runner.run(['exec', 'a b', 'say "hi" & del x', '50% cotton', 'line\nbreak']);

    // where.exe answered empty, so resolution fell back to the shell line.
    expect(calls).toHaveLength(2);
    expect(calls[0].cmd).toBe('where.exe');
    expect(calls[1].args).toEqual([]);
    expect(calls[1].opts.shell).toBe(true);
    expect(calls[1].cmd).toBe(`"codex" "exec" "a b" "say 'hi' & del x" "50 percent  cotton" "line break"`);
  });

  it('spawns a where-resolved codex.exe argv-style, no shell, no substitutions', async () => {
    const exePath = 'C:\\Program Files\\Codex\\codex.exe';
    const { spawnImpl, calls } = fakeSpawn((call) => {
      if (call.cmd === 'where.exe') call.child.stdout.emit('data', `${exePath}\r\n`);
    });
    const runner = createRunner({ spawnImpl, platform: 'win32' });
    await runner.run(['exec', '50% cotton', 'say "hi"']);

    expect(calls[1].cmd).toBe(exePath);
    expect(calls[1].args).toEqual(['exec', '50% cotton', 'say "hi"']);
    expect(calls[1].opts.shell).toBeUndefined();
  });

  it('keeps the POSIX array contract when the platform is pinned posix', async () => {
    const { spawnImpl, calls } = fakeSpawn();
    const runner = createRunner({ spawnImpl, platform: 'linux' });
    await runner.run(['exec', 'a b']);
    expect(calls[0].cmd).toBe('codex');
    expect(calls[0].args).toEqual(['exec', 'a b']);
    expect(calls[0].opts.shell).toBeUndefined();
  });
});

describe('codex setup on win32', () => {
  it('kills the whole npm tree when an install times out, not just its shell', async () => {
    const calls: Call[] = [];
    const hangingSpawn = ((cmd: string, args: string[], opts: Record<string, unknown>) => {
      const child = new EventEmitter() as Call['child'] & { pid: number };
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = () => {};
      child.pid = 8123;
      calls.push({ cmd, args, opts, child });
      // npm never exits; taskkill idles harmlessly
      return child;
    }) as unknown as typeof spawn;
    const setup = createCodexSetup({ spawnImpl: hangingSpawn, platform: 'win32', installTimeoutMs: 50 });
    const res = await setup.install();
    expect(res.ok).toBe(false);
    expect(res.detail ?? '').toMatch(/timed out/);
    const tk = calls.find((c) => c.cmd === 'taskkill');
    expect(tk?.args).toEqual(['/PID', '8123', '/T', '/F']);
  });

  it('never reaches for taskkill on posix', async () => {
    const calls: Call[] = [];
    const hangingSpawn = ((cmd: string, args: string[], opts: Record<string, unknown>) => {
      const child = new EventEmitter() as Call['child'];
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = () => {};
      calls.push({ cmd, args, opts, child });
      return child;
    }) as unknown as typeof spawn;
    const setup = createCodexSetup({ spawnImpl: hangingSpawn, platform: 'linux', installTimeoutMs: 50 });
    await setup.install();
    expect(calls.some((c) => c.cmd === 'taskkill')).toBe(false);
  });

  it('never suggests sudo, which does not exist there', async () => {
    const failing = (() => {
      const child = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter;
        stderr: EventEmitter;
        kill: () => void;
      };
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = () => {};
      queueMicrotask(() => {
        child.stderr.emit('data', 'npm error Error: EACCES: permission denied\n');
        child.emit('exit', 1, null);
      });
      return child;
    }) as unknown as typeof spawn;
    const setup = createCodexSetup({ spawnImpl: failing, platform: 'win32' });
    const res = await setup.install();
    expect(res.ok).toBe(false);
    expect(res.fallbackCommand ?? '').not.toContain('sudo');
    expect(res.detail ?? '').not.toMatch(/password/i);
  });
});
