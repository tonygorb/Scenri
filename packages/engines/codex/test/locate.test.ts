import { EventEmitter } from 'node:events';
import type { spawn } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { MIN_CODEX_VERSION, parseCodexVersion, resolveCodex, versionAtLeast } from '../src/locate.js';

/**
 * Executable resolution. POSIX trusts PATH and spawns `codex` directly, as it
 * always has. win32 asks where.exe, because npm installs codex as a .cmd shim
 * (shell only) while the standalone installer ships a real codex.exe (argv
 * spawn, no shell, killable by pid) — and the two need different spawn shapes.
 */

type Call = { cmd: string; args: string[] };

function fakeWhere(behavior: (child: FakeChild) => void): { spawnImpl: typeof spawn; calls: Call[] } {
  const calls: Call[] = [];
  const spawnImpl = ((cmd: string, args: string[]) => {
    calls.push({ cmd, args });
    const child = new FakeChild();
    setTimeout(() => behavior(child), 0);
    return child;
  }) as unknown as typeof spawn;
  return { spawnImpl, calls };
}

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

describe('parseCodexVersion', () => {
  it('reads the codex-cli triple', () => {
    expect(parseCodexVersion('codex-cli 0.149.0\n')).toBe('0.149.0');
  });

  it('survives CRLF line endings from a Windows pipe', () => {
    expect(parseCodexVersion('codex-cli 0.146.0\r\n')).toBe('0.146.0');
  });

  it('returns null for anything else', () => {
    expect(parseCodexVersion('some other tool 1.0')).toBeNull();
    expect(parseCodexVersion('')).toBeNull();
  });
});

describe('versionAtLeast', () => {
  it('accepts the floor itself and above', () => {
    expect(versionAtLeast(MIN_CODEX_VERSION, MIN_CODEX_VERSION)).toBe(true);
    expect(versionAtLeast('0.149.0', '0.146.0')).toBe(true);
    expect(versionAtLeast('1.0.0', '0.146.0')).toBe(true);
  });

  it('rejects below the floor, comparing numerically not lexically', () => {
    expect(versionAtLeast('0.145.9', '0.146.0')).toBe(false);
    expect(versionAtLeast('0.9.0', '0.146.0')).toBe(false);
  });
});

describe('resolveCodex', () => {
  it('returns the bare PATH command on posix without spawning anything', async () => {
    const { spawnImpl, calls } = fakeWhere(() => {});
    const resolved = await resolveCodex('linux', spawnImpl);
    expect(resolved).toEqual({ command: 'codex', direct: true });
    expect(calls).toHaveLength(0);
  });

  it('prefers a real codex.exe from where.exe, even behind a path with spaces', async () => {
    const exePath = String.raw`C:\Users\First Last\AppData\Local\Programs\codex\codex.exe`;
    const cmdPath = String.raw`C:\Users\First Last\AppData\Roaming\npm\codex.cmd`;
    const { spawnImpl, calls } = fakeWhere((child) => {
      child.stdout.emit('data', `${cmdPath}\r\n${exePath}\r\n`);
      child.emit('exit', 0, null);
    });
    const resolved = await resolveCodex('win32', spawnImpl);
    expect(resolved).toEqual({ command: exePath, direct: true });
    expect(calls[0].cmd).toBe('where.exe');
    expect(calls[0].args).toEqual(['codex']);
  });

  it('falls back to the shell path when only the npm .cmd shim exists', async () => {
    const { spawnImpl } = fakeWhere((child) => {
      child.stdout.emit('data', 'C:\\Users\\t\\AppData\\Roaming\\npm\\codex.cmd\r\n');
      child.emit('exit', 0, null);
    });
    await expect(resolveCodex('win32', spawnImpl)).resolves.toEqual({ command: 'codex', direct: false });
  });

  it('falls back to the shell path when where.exe finds nothing or fails', async () => {
    const notFound = fakeWhere((child) => child.emit('exit', 1, null));
    await expect(resolveCodex('win32', notFound.spawnImpl)).resolves.toEqual({ command: 'codex', direct: false });

    const broken = fakeWhere((child) => child.emit('error', new Error('spawn where.exe ENOENT')));
    await expect(resolveCodex('win32', broken.spawnImpl)).resolves.toEqual({ command: 'codex', direct: false });
  });

  it('gives up on a hung where.exe and falls back, killing the child', async () => {
    let hung: FakeChild | undefined;
    const { spawnImpl } = fakeWhere((child) => {
      hung = child;
    });
    const resolved = await resolveCodex('win32', spawnImpl, 50);
    expect(resolved).toEqual({ command: 'codex', direct: false });
    expect(hung?.killed).toBe(true);
  });
});
