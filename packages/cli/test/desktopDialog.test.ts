import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'node:events';
import { basename } from 'node:path';
import { type DialogSpawn, showDialog } from '../src/desktop/dialog.js';

/**
 * One native sentence when there is no terminal. On Windows the box comes from
 * a PowerShell that must have no console (nothing to flash) and no SW_HIDE hint
 * (the box itself is the first window that process shows; a hidden first
 * window is a modal nobody can see and nobody can close).
 */

function spawner(script: { error?: Error } = {}) {
  const calls: { cmd: string; args: string[]; opts: Record<string, unknown> }[] = [];
  const spawnImpl: DialogSpawn = (cmd, args, opts) => {
    calls.push({ cmd, args, opts: opts as Record<string, unknown> });
    const child = new EventEmitter();
    setImmediate(() => (script.error ? child.emit('error', script.error) : child.emit('exit', 0, null)));
    return child;
  };
  return { calls, spawnImpl };
}

describe('showDialog on Windows', () => {
  it('shows a MessageBox from a console-less PowerShell, the message in the environment, no hide hint', async () => {
    const { calls, spawnImpl } = spawner();
    await showDialog('win32', 'Port 4747 is in use by another app.', { SystemRoot: 'C:\\Windows' }, spawnImpl);
    expect(calls).toHaveLength(1);
    const [c] = calls;
    expect(basename(c.cmd).toLowerCase()).toBe('powershell.exe');
    expect(c.args).toContain('-NonInteractive');
    expect(c.args.at(-1)).toContain('MessageBox]::Show($env:SCENRI_MESSAGE');
    expect(c.args.join(' ')).not.toContain('Port 4747');
    expect((c.opts.env as Record<string, string>).SCENRI_MESSAGE).toBe('Port 4747 is in use by another app.');
    expect(c.opts.stdio).toBe('ignore');
    expect(c.opts.detached).toBe(true);
    expect(c.opts.windowsHide).toBeUndefined();
    expect(c.opts.shell).toBeUndefined();
  });

  it('resolves when the helper cannot even start', async () => {
    const { spawnImpl } = spawner({ error: new Error('spawn ENOENT') });
    await showDialog('win32', 'x', {}, spawnImpl);
  });
});

describe('showDialog on macOS', () => {
  it('hands the message to osascript as an argument after --, never as script text', async () => {
    const { calls, spawnImpl } = spawner();
    await showDialog('darwin', 'Scenri could not start.', {}, spawnImpl);
    expect(calls[0].cmd).toBe('/usr/bin/osascript');
    expect(calls[0].args.slice(-2)).toEqual(['--', 'Scenri could not start.']);
    expect(calls[0].args.filter((a) => a.includes('Scenri could not start.'))).toHaveLength(1);
  });
});

describe('showDialog silenced', () => {
  it('spawns nothing under SCENRI_NO_DIALOG', async () => {
    const { calls, spawnImpl } = spawner();
    await showDialog('win32', 'x', { SCENRI_NO_DIALOG: '1' }, spawnImpl);
    expect(calls).toHaveLength(0);
  });
});
