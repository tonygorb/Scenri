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

type Call = { cmd: string; args: string[]; opts: Record<string, unknown> };

function fakeSpawn(): { spawnImpl: typeof spawn; calls: Call[] } {
  const calls: Call[] = [];
  const spawnImpl = ((cmd: string, args: string[], opts: Record<string, unknown>) => {
    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
      kill: () => void;
    };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {};
    calls.push({ cmd, args, opts });
    queueMicrotask(() => child.emit('exit', 0, null));
    return child;
  }) as unknown as typeof spawn;
  return { spawnImpl, calls };
}

describe('codex spawn on win32', () => {
  it('joins one fully quoted shell line and defuses cmd.exe metacharacters', async () => {
    const { spawnImpl, calls } = fakeSpawn();
    const runner = createRunner({ spawnImpl, platform: 'win32' });
    await runner.run(['exec', 'a b', 'say "hi" & del x', '50% cotton', 'line\nbreak']);

    expect(calls).toHaveLength(1);
    expect(calls[0].args).toEqual([]);
    expect(calls[0].opts.shell).toBe(true);
    expect(calls[0].cmd).toBe(`"codex" "exec" "a b" "say 'hi' & del x" "50 percent  cotton" "line break"`);
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
