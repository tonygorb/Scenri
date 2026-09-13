import { EventEmitter } from 'node:events';
import type { spawn } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { createRunner } from '../src/run.js';
import { CONNECT_PROMPT } from '../src/connect.js';

/**
 * The fifth rung. A probe made of exit codes cannot see the failure that
 * matters most: measured on codex-cli 0.153.4 (2026-09-13), a stale
 * CODEX_API_KEY leaves `codex --version` and `codex login status` both green
 * while every `codex exec` answers 401, because exec reads that variable and
 * login status does not. So the check runs the command a shot runs, through
 * the same spawn, with the same environment.
 */

class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  stdin = {
    written: '',
    write(d: string | Buffer) {
      this.written += String(d);
      return true;
    },
    end: () => {},
    on: () => {},
  };
  pid = 4242;
  killed = false;
  kill = () => {
    this.killed = true;
    this.emit('exit', null, 'SIGTERM');
    return true;
  };
}

type Call = { cmd: string; args: string[]; opts: Record<string, unknown>; child: FakeChild };

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

const CONFLICT_401 =
  'ERROR: unexpected status 401 Unauthorized: Incorrect API key provided: sk-proj-****s000. You can find your API key at https://platform.openai.com/account/api-keys.';

/** A machine whose ladder is green; `exec` behaves however the test says. */
function machine(exec: (call: Call) => void, status = 0) {
  return scriptedSpawn((call) => {
    if (call.args[0] === '--version') {
      call.child.stdout.emit('data', 'codex-cli 0.153.4\n');
      return void call.child.emit('exit', 0, null);
    }
    if (call.args[0] === 'login') return void call.child.emit('exit', status, null);
    exec(call);
  });
}

const healthyExec = (call: Call) => {
  call.child.stdout.emit('data', 'READY\n');
  call.child.emit('exit', 0, null);
};
const refusedExec = (call: Call) => {
  call.child.stderr.emit('data', `${CONFLICT_401}\n`);
  call.child.emit('exit', 1, null);
};
const execCalls = (calls: Call[]) => calls.filter((c) => c.args[0] === 'exec');

const base = { platform: 'linux' as const, probeTimeoutMs: 200, probeTtlMs: 0 };

describe('the connection check', () => {
  it('runs the command a shot runs: exec, stdin marker, no image, no forced login method', async () => {
    const { spawnImpl, calls } = machine(healthyExec);
    const runner = createRunner({ ...base, spawnImpl, env: { PATH: '/usr/bin' } });
    await expect(runner.connect()).resolves.toMatchObject({ outcome: 'proven' });
    const exec = execCalls(calls)[0];
    expect(exec.args).toEqual([
      'exec',
      '--skip-git-repo-check',
      '--sandbox',
      'workspace-write',
      '--color',
      'never',
      '-c',
      'model_reasoning_effort="low"',
      '-C',
      expect.stringContaining('scenri-codex-'),
      '-',
    ]);
    expect(exec.args.join(' ')).not.toContain('--image');
    // forced_login_method="chatgpt" makes codex DELETE ~/.codex/auth.json when
    // a key is in play. Measured 2026-09-13. It must never appear here.
    expect(exec.args.join(' ')).not.toContain('forced_login_method');
    expect(exec.child.stdin.written).toBe(CONNECT_PROMPT);
  });

  it('asks nothing of a machine that is not signed in, and spends no plan doing it', async () => {
    const { spawnImpl, calls } = machine(healthyExec, 1);
    const runner = createRunner({ ...base, spawnImpl });
    await expect(runner.connect()).resolves.toMatchObject({ outcome: 'unproven' });
    expect(execCalls(calls)).toHaveLength(0);
  });

  it('launches the check without the named variables, and keeps the rest', async () => {
    const { spawnImpl, calls } = machine(healthyExec);
    const runner = createRunner({
      ...base,
      spawnImpl,
      env: { PATH: '/usr/bin', CODEX_API_KEY: 'sk-proj-stale', HOME: '/Users/sam' },
      ignoreEnvKeys: () => ['CODEX_API_KEY'],
    });
    await runner.connect();
    const env = execCalls(calls)[0].opts.env as NodeJS.ProcessEnv;
    expect(env.CODEX_API_KEY).toBeUndefined();
    expect(env.PATH).toBe('/usr/bin');
    expect(env.HOME).toBe('/Users/sam');
  });

  it('names the conflict when a key here explains the 401', async () => {
    const { spawnImpl } = machine(refusedExec);
    const runner = createRunner({ ...base, spawnImpl, env: { CODEX_API_KEY: 'sk-proj-stale' } });
    const conn = await runner.connect();
    expect(conn.outcome).toBe('refused');
    expect(conn.failure?.code).toBe('CODEX_AUTH_CONFLICT');
    const avail = await runner.probe();
    expect(avail).toMatchObject({ ok: false, code: 'env-conflict' });
    expect(avail.reason).toContain('CODEX_API_KEY');
    expect(avail.reason).not.toContain('sk-proj');
  });

  it('calls the same 401 a signed-out session when nothing here explains it', async () => {
    const { spawnImpl } = machine(refusedExec);
    const runner = createRunner({ ...base, spawnImpl, env: { PATH: '/usr/bin' } });
    await runner.connect();
    await expect(runner.probe()).resolves.toMatchObject({ ok: false, code: 'not-authenticated' });
  });

  /**
   * The safety property. A check that cannot get an answer must leave the
   * ladder's verdict alone: turning a working Codex off because a link was
   * slow would be a worse bug, and a more confusing one, than the false green
   * this rung exists to remove.
   */
  it('leaves a ready machine ready when the check itself cannot finish', async () => {
    const { spawnImpl } = machine(() => {});
    const runner = createRunner({ ...base, spawnImpl, connectTimeoutMs: 60 });
    await expect(runner.connect()).resolves.toMatchObject({ outcome: 'unproven' });
    await expect(runner.probe()).resolves.toEqual({ ok: true });
  });

  it('leaves a ready machine ready when the plan is used up', async () => {
    const { spawnImpl } = machine((call) => {
      call.child.stderr.emit('data', "ERROR: You've hit your usage limit. Upgrade to Pro\n");
      call.child.emit('exit', 1, null);
    });
    const runner = createRunner({ ...base, spawnImpl });
    await expect(runner.connect()).resolves.toMatchObject({ outcome: 'unproven' });
    await expect(runner.probe()).resolves.toEqual({ ok: true });
  });
});

describe('what the verdict costs, and when it expires', () => {
  it('spends one turn, not one per caller', async () => {
    const { spawnImpl, calls } = machine(healthyExec);
    const runner = createRunner({ ...base, spawnImpl });
    await runner.connect();
    await runner.connect();
    await runner.probe();
    expect(execCalls(calls)).toHaveLength(1);
  });

  it('never spawns an exec from probe(), whatever a page load asks', async () => {
    const { spawnImpl, calls } = machine(healthyExec);
    const runner = createRunner({ ...base, spawnImpl });
    await runner.probe();
    await runner.probe();
    expect(execCalls(calls)).toHaveLength(0);
  });

  // A sign-in poll calls invalidateProbe every two seconds. If that also threw
  // away the connection verdict, it would buy a real exec every tick.
  it('keeps the verdict across invalidateProbe, and drops it on invalidateConnection', async () => {
    const { spawnImpl, calls } = machine(healthyExec);
    const runner = createRunner({ ...base, spawnImpl });
    await runner.connect();
    runner.invalidateProbe();
    await runner.connect();
    expect(execCalls(calls)).toHaveLength(1);
    runner.invalidateConnection();
    await runner.connect();
    expect(execCalls(calls)).toHaveLength(2);
  });

  it('forgets a verdict once the conflicting variables change', async () => {
    let ignored: string[] = [];
    const { spawnImpl, calls } = machine(healthyExec);
    const runner = createRunner({
      ...base,
      spawnImpl,
      env: { CODEX_API_KEY: 'sk-proj-stale' },
      ignoreEnvKeys: () => ignored,
    });
    await runner.connect();
    expect(execCalls(calls)).toHaveLength(1);
    ignored = ['CODEX_API_KEY'];
    await runner.connect();
    expect(execCalls(calls)).toHaveLength(2);
  });

  it('force buys a fresh answer even when the stored one is still warm', async () => {
    const { spawnImpl, calls } = machine(healthyExec);
    const runner = createRunner({ ...base, spawnImpl });
    await runner.connect();
    await runner.connect({ force: true });
    expect(execCalls(calls)).toHaveLength(2);
  });
});

describe('the check prompt', () => {
  it('carries nothing that the win32 shell quoting would have to rewrite', () => {
    expect(CONNECT_PROMPT).not.toMatch(/["%\r\n]/);
  });

  it('asks for no tools, no image and no files', () => {
    expect(CONNECT_PROMPT).toMatch(/not use any tools/i);
    expect(CONNECT_PROMPT).toMatch(/not generate an image/i);
    expect(CONNECT_PROMPT).toMatch(/read or write any files/i);
  });
});
