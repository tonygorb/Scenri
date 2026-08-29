import { EventEmitter } from 'node:events';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { spawn } from 'node:child_process';
import type { BrandContext, GenerateRequest } from '@scenri/core';
import { describe, expect, it } from 'vitest';
import { createCodexEngine } from '../src/index.js';
import { createRunner, execArgs } from '../src/run.js';

/**
 * The prompt rides stdin, on every platform. As an argv tail it hit cmd.exe's
 * 8191-character line limit and the winArg substitutions mangled its quotes,
 * percents and newlines on Windows; stdin carries the exact bytes everywhere.
 * And the silence contract: a codex that never says anything never started
 * (the first-output guard kills it fast), while silence after the first byte
 * is normal work — the image_gen round-trip is quiet — bounded only by the
 * hard cap.
 */

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 9, 9, 9]);
const brand: BrandContext = { brand: {}, assetPaths: {} };

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
  pid = 7777;
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
  const spawnImpl = ((cmd: string, args: string[]) => {
    const call: Call = { cmd, args, child: new FakeChild() };
    calls.push(call);
    setTimeout(() => script(call), 0);
    return call.child;
  }) as unknown as typeof spawn;
  return { spawnImpl, calls };
}

const dirOf = (args: string[]) => args[args.indexOf('-C') + 1];

describe('execArgs', () => {
  it('ends with the stdin marker, carries no prompt, and silences color codes', () => {
    const args = execArgs('/work/dir');
    expect(args[args.length - 1]).toBe('-');
    expect(args).toContain('--color');
    expect(args).toContain('never');
    expect(args).toContain('/work/dir');
  });
});

describe('stdin transport', () => {
  it('delivers the prompt bytes exactly, hostile characters included', async () => {
    const hostile = '50% "quoted" & <piped>\nsecond line';
    const { spawnImpl, calls } = scriptedSpawn((call) => call.child.emit('exit', 0, null));
    const runner = createRunner({ spawnImpl, platform: 'linux' });
    await runner.run(execArgs('/tmp/x'), undefined, { stdin: hostile });
    expect(calls[0].child.stdin.written).toBe(hostile);
    expect(calls[0].args.join(' ')).not.toContain('50%');
  });

  it('keeps the prompt out of the win32 shell line too', async () => {
    const { spawnImpl, calls } = scriptedSpawn((call) => {
      if (call.cmd === 'where.exe') call.child.emit('exit', 1, null);
      else call.child.emit('exit', 0, null);
    });
    const runner = createRunner({ spawnImpl, platform: 'win32' });
    await runner.run(execArgs('C:\\t'), undefined, { stdin: 'a 50% prompt' });
    const line = calls.find((c) => c.cmd !== 'where.exe');
    expect(line?.cmd).not.toContain('percent');
    expect(line?.cmd).not.toContain('prompt');
    expect(line?.child.stdin.written).toBe('a 50% prompt');
  });
});

describe('first-output guard', () => {
  it('fails a run that never says anything, well before the hard cap', async () => {
    const { spawnImpl, calls } = scriptedSpawn(() => {});
    const runner = createRunner({ spawnImpl, platform: 'linux', timeoutMs: 60_000, firstOutputMs: 80 });
    await expect(runner.run(execArgs('/tmp/x'), undefined, { stdin: 'p' })).rejects.toThrow(
      /no output for \d+s after launch/,
    );
    expect(calls[0].child.killed).toBe(true);
  });

  it('disarms on the first byte: long silence after the banner is normal work', async () => {
    // The banner arrives, then nothing for far longer than the guard window —
    // the exact shape of a healthy image_gen round-trip, which the old rolling
    // silence watchdog used to kill about one time in eight.
    const { spawnImpl } = scriptedSpawn((call) => {
      call.child.stdout.emit('data', 'banner\n');
      setTimeout(() => call.child.emit('exit', 0, null), 300);
    });
    const runner = createRunner({ spawnImpl, platform: 'linux', firstOutputMs: 60 });
    await expect(runner.run(execArgs('/tmp/x'), undefined, { stdin: 'p' })).resolves.toBeUndefined();
  });

  it('a run that wedges after its banner is bounded by the hard cap', async () => {
    const { spawnImpl, calls } = scriptedSpawn((call) => {
      call.child.stdout.emit('data', 'banner\n');
    });
    const runner = createRunner({ spawnImpl, platform: 'linux', firstOutputMs: 40, timeoutMs: 150 });
    await expect(runner.run(execArgs('/tmp/x'), undefined, { stdin: 'p' })).rejects.toThrow(/timed out after 150ms/);
    expect(calls[0].child.killed).toBe(true);
  });

  it('a per-call timeout overrides the runner default', async () => {
    const { spawnImpl } = scriptedSpawn((call) => {
      call.child.stdout.emit('data', 'banner\n');
    });
    const runner = createRunner({ spawnImpl, platform: 'linux', firstOutputMs: 40, timeoutMs: 60_000 });
    await expect(runner.run(execArgs('/tmp/x'), undefined, { stdin: 'p', timeoutMs: 120 })).rejects.toThrow(
      /timed out after 120ms/,
    );
  });
});

describe('generate over stdin, failing fast', () => {
  const req = (count: number): GenerateRequest => ({
    prompt: 'a fox with a 50% "discount" tag',
    brand,
    width: 640,
    height: 480,
    count,
  });

  const saveImage = () => 'hash';

  it('sends the compiled prompt over stdin, not argv', async () => {
    const { spawnImpl, calls } = scriptedSpawn((call) => {
      writeFileSync(join(dirOf(call.args), 'out-1.png'), PNG);
      call.child.emit('exit', 0, null);
    });
    const engine = createCodexEngine({ spawnImpl, platform: 'linux', saveImage, probeTtlMs: 0 });
    await engine.generate(req(1));
    expect(calls[0].args[calls[0].args.length - 1]).toBe('-');
    expect(calls[0].child.stdin.written).toContain('a fox with a 50% "discount" tag');
    expect(calls[0].args.join(' ')).not.toContain('discount');
  });

  it('aborts the batch as soon as one variant fails with an auth error', async () => {
    let execSeen = 0;
    const { spawnImpl, calls } = scriptedSpawn((call) => {
      execSeen++;
      if (execSeen === 1) {
        call.child.stderr.emit('data', 'Not logged in\n');
        call.child.emit('exit', 1, null);
      }
      // later execs hang until killed
    });
    const engine = createCodexEngine({ spawnImpl, platform: 'linux', saveImage, probeTtlMs: 0 });
    await expect(engine.generate(req(4))).rejects.toThrow(/Not logged in/i);
    // two workers dequeued, the third and fourth jobs never started
    expect(calls).toHaveLength(2);
    expect(calls[1].child.killed).toBe(true);
  });

  it('keeps the survivors and reports the casualties on raw', async () => {
    let execSeen = 0;
    const { spawnImpl } = scriptedSpawn((call) => {
      execSeen++;
      if (execSeen === 1) {
        call.child.stderr.emit('data', 'rate limited\n');
        call.child.emit('exit', 3, null);
      } else {
        writeFileSync(join(dirOf(call.args), 'out-1.png'), PNG);
        call.child.emit('exit', 0, null);
      }
    });
    const engine = createCodexEngine({ spawnImpl, platform: 'linux', saveImage, probeTtlMs: 0 });
    const res = await engine.generate(req(2));
    expect(res.images).toHaveLength(1);
    expect(res.raw).toMatchObject({ requested: 2 });
    expect(JSON.stringify(res.raw)).toContain('rate limited');
  });
});
