import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'node:events';
import { basename } from 'node:path';
import { PassThrough } from 'node:stream';
import { openInBrowser, type OpenerChild, type OpenerSpawn } from '../src/desktop/browser.js';

/**
 * The browser is the last step a person sees, and on Windows it goes through a
 * helper process. Each helper is judged by its exit, never assumed to have
 * worked because it started; a failed one is followed by the next, and only
 * when every helper failed does the caller get a reason it can put in a dialog.
 */

type Script = { code?: number | null; stderr?: string; error?: Error; hang?: boolean };
type Spawned = { cmd: string; args: string[]; opts: Record<string, unknown>; child: OpenerChild & { killed: boolean } };

function fakeChild(script: Script) {
  const child = new EventEmitter() as EventEmitter & OpenerChild & { killed: boolean };
  const stderr = new PassThrough();
  child.stderr = stderr;
  child.killed = false;
  child.kill = () => {
    child.killed = true;
    setImmediate(() => child.emit('close', null, 'SIGTERM'));
    return true;
  };
  setImmediate(() => {
    if (script.error) return child.emit('error', script.error);
    if (script.stderr) stderr.write(script.stderr);
    stderr.end();
    if (!script.hang) setImmediate(() => child.emit('close', script.code ?? 0, null));
  });
  return child;
}

function spawner(scripts: Script[]) {
  const spawns: Spawned[] = [];
  const spawnImpl: OpenerSpawn = (cmd, args, opts) => {
    const child = fakeChild(scripts[spawns.length] ?? {});
    spawns.push({ cmd, args, opts: opts as Record<string, unknown>, child });
    return child;
  };
  return { spawns, spawnImpl };
}

const URL = 'http://127.0.0.1:4747/';
const env = { SystemRoot: 'C:\\Windows', PATH: 'C:\\x' };

describe('openInBrowser on Windows', () => {
  it('asks PowerShell to Start-Process the URL from the environment, hidden, and is done when it exits 0', async () => {
    const { spawns, spawnImpl } = spawner([{ code: 0 }]);
    await openInBrowser(URL, 'win32', env, { spawn: spawnImpl });
    expect(spawns).toHaveLength(1);
    const [ps] = spawns;
    expect(basename(ps.cmd).toLowerCase()).toBe('powershell.exe');
    expect(ps.args).toContain('-NoProfile');
    expect(ps.args).toContain('-NonInteractive');
    expect(ps.args.at(-1)).toBe('Start-Process $env:SCENRI_URL');
    expect(ps.args.join(' ')).not.toContain(URL);
    expect((ps.opts.env as Record<string, string>).SCENRI_URL).toBe(URL);
    expect(ps.opts.windowsHide).toBe(true);
    expect(ps.opts.shell).toBeUndefined();
    expect(ps.opts.detached).toBeUndefined();
  });

  it('falls through to rundll32 with the URL as an argument when PowerShell fails', async () => {
    const { spawns, spawnImpl } = spawner([{ code: 1, stderr: 'Start-Process : boom' }, { code: 0 }]);
    await openInBrowser(URL, 'win32', env, { spawn: spawnImpl });
    expect(spawns).toHaveLength(2);
    expect(spawns[1].cmd).toBe('C:\\Windows\\System32\\rundll32.exe');
    expect(spawns[1].args).toEqual(['url.dll,FileProtocolHandler', URL]);
    expect(spawns[1].opts.windowsHide).toBe(true);
  });

  it('ends with explorer, whose exit code 1 is its normal answer', async () => {
    const { spawns, spawnImpl } = spawner([{ code: 1 }, { error: new Error('spawn ENOENT') }, { code: 1 }]);
    await openInBrowser(URL, 'win32', env, { spawn: spawnImpl });
    expect(spawns).toHaveLength(3);
    expect(spawns[2].cmd).toBe('C:\\Windows\\explorer.exe');
    expect(spawns[2].args).toEqual([URL]);
  });

  it('rejects with every helper\u2019s reason when all of them failed', async () => {
    const { spawns, spawnImpl } = spawner([
      { code: 1, stderr: 'Start-Process : boom\r\n' },
      { code: 3 },
      { error: new Error('spawn ENOENT') },
    ]);
    await expect(openInBrowser(URL, 'win32', env, { spawn: spawnImpl })).rejects.toThrow(
      /boom.*rundll32.*explorer.*ENOENT/s,
    );
    expect(spawns).toHaveLength(3);
  });

  it('gives a helper a bounded time, kills one that hangs, and moves on', async () => {
    const { spawns, spawnImpl } = spawner([{ hang: true }, { code: 0 }]);
    await openInBrowser(URL, 'win32', env, { spawn: spawnImpl, timeoutMs: 20 });
    expect(spawns[0].child.killed).toBe(true);
    expect(spawns).toHaveLength(2);
  });

  it('finds the helpers under SystemRoot, and under C:\\Windows when that is unset', async () => {
    const { spawns, spawnImpl } = spawner([{ code: 1 }, { code: 0 }]);
    await openInBrowser(URL, 'win32', { PATH: '' }, { spawn: spawnImpl });
    expect(spawns[1].cmd).toBe('C:\\Windows\\System32\\rundll32.exe');
  });
});

describe('openInBrowser elsewhere', () => {
  it('resolves when the open package\u2019s child exits 0', async () => {
    const child = fakeChild({ code: 0 });
    await openInBrowser(URL, 'darwin', {}, { open: async () => child });
  });

  it('rejects when that child exits non-zero or cannot be spawned', async () => {
    await expect(openInBrowser(URL, 'darwin', {}, { open: async () => fakeChild({ code: 2 }) })).rejects.toThrow(/2/);
    await expect(
      openInBrowser(URL, 'linux', {}, { open: async () => fakeChild({ error: new Error('no xdg-open') }) }),
    ).rejects.toThrow(/xdg-open/);
  });
});
