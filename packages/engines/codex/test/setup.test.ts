import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import type { spawn } from 'node:child_process';
import { createCodexSetup, INSTALL_COMMAND } from '../src/setup.js';

class FakeChild extends EventEmitter {
  kill = vi.fn(() => true);
  stdout = new EventEmitter();
  stderr = new EventEmitter();
}

interface Call {
  cmd: string;
  args: string[];
  child: FakeChild;
}

function fakeSpawn(onSpawn: (call: Call) => void): { spawnImpl: typeof spawn; calls: Call[] } {
  const calls: Call[] = [];
  const spawnImpl = ((cmd: string, args: string[]) => {
    const call: Call = { cmd, args, child: new FakeChild() };
    calls.push(call);
    setTimeout(() => onSpawn(call), 0);
    return call.child;
  }) as unknown as typeof spawn;
  return { spawnImpl, calls };
}

/** Answer each probe/install/login command with a chosen exit code. */
function scripted(codes: { version?: number; status?: number; npm?: number; login?: number }) {
  return fakeSpawn(({ cmd, args, child }) => {
    if (cmd === 'npm') return void child.emit('exit', codes.npm ?? 0, null);
    if (args[0] === '--version') return void child.emit('exit', codes.version ?? 0, null);
    if (args[0] === 'login' && args[1] === 'status') return void child.emit('exit', codes.status ?? 0, null);
    child.emit('exit', codes.login ?? 0, null);
  });
}

describe('status', () => {
  it('maps the probe onto the three states the wizard switches on', async () => {
    const notInstalled = createCodexSetup({ spawnImpl: scripted({ version: 1 }).spawnImpl });
    await expect(notInstalled.status()).resolves.toMatchObject({ state: 'not-installed' });

    const notSignedIn = createCodexSetup({ spawnImpl: scripted({ version: 0, status: 1 }).spawnImpl });
    await expect(notSignedIn.status()).resolves.toMatchObject({ state: 'not-authenticated' });

    const ready = createCodexSetup({ spawnImpl: scripted({}).spawnImpl });
    await expect(ready.status()).resolves.toEqual({ state: 'ready', reason: undefined });
  });
});

describe('install', () => {
  it('runs the official global install and nothing else', async () => {
    const { spawnImpl, calls } = scripted({});
    const setup = createCodexSetup({ spawnImpl });
    await expect(setup.install()).resolves.toEqual({ ok: true });
    expect(calls[0]).toMatchObject({ cmd: 'npm', args: ['install', '-g', '@openai/codex'] });
  });

  it('hands back the command to run by hand when the install fails', async () => {
    const { spawnImpl } = scripted({ npm: 1, version: 1 });
    const setup = createCodexSetup({ spawnImpl });
    const res = await setup.install();
    expect(res.ok).toBe(false);
    expect(res.fallbackCommand).toBe(INSTALL_COMMAND);
    expect(res.docsUrl).toBeTruthy();
  });

  it('trusts the probe over the exit code: installed but not on PATH still fails', async () => {
    // npm says it worked; the binary is still not reachable from this process.
    const { spawnImpl } = scripted({ npm: 0, version: 1 });
    const setup = createCodexSetup({ spawnImpl });
    const res = await setup.install();
    expect(res.ok).toBe(false);
    expect(res.fallbackCommand).toBe(INSTALL_COMMAND);
  });
});

describe('login', () => {
  it('runs `codex login` and reports the state it left behind', async () => {
    const { spawnImpl, calls } = scripted({});
    const setup = createCodexSetup({ spawnImpl });
    await expect(setup.login()).resolves.toEqual({ ok: true });
    expect(calls.some((c) => c.cmd === 'codex' && c.args[0] === 'login' && c.args.length === 1)).toBe(true);
  });

  it('offers the headless alternative when the browser flow fails', async () => {
    const { spawnImpl } = scripted({ login: 1, status: 1 });
    const setup = createCodexSetup({ spawnImpl });
    const res = await setup.login();
    expect(res.ok).toBe(false);
    expect(res.fallbackCommand).toBe('codex login --device-auth');
  });

  it('never reads or returns a credential', async () => {
    const { spawnImpl } = scripted({});
    const setup = createCodexSetup({ spawnImpl });
    const res = await setup.login();
    expect(JSON.stringify(res)).not.toMatch(/token|secret|password|api[-_]?key/i);
  });
});
