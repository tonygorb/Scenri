import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { spawn } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCodexEngine } from '../src/index.js';

/**
 * Windows recovery for upstream sandbox write-back failures: codex's built-in
 * image tool saves under $CODEX_HOME/generated_images first and then moves the
 * file into the workdir — and that second step is exactly what the native
 * Windows sandbox breaks (openai/codex#34961). When an exec exits 0 with an
 * empty workdir on win32, the adapter claims the image from where codex left
 * it. POSIX keeps the strict workdir contract: no images means failed.
 */

const PNG_NEW = Buffer.from([0x89, 0x50, 0x4e, 0x47, 42]);
const brand = { brand: {}, assetPaths: {} };
const req = { prompt: 'a mug', brand, width: 640, height: 480, count: 1 };

class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  stdin = { written: '', write: () => true, end: () => {}, on: () => {} };
  pid = 5555;
  kill = () => true;
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

/** The win32 spawn is one joined shell line; the workdir hides inside it. */
const dirFromShellLine = (cmd: string) => /"-C" "([^"]+)"/.exec(cmd)?.[1] ?? '';

let codexHome: string;
let generated: string;

beforeEach(() => {
  codexHome = mkdtempSync(join(tmpdir(), 'fake-codex-home-'));
  generated = join(codexHome, 'generated_images');
  mkdirSync(generated, { recursive: true });
  vi.stubEnv('CODEX_HOME', codexHome);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const newSaveImage = () => {
  const saved: Buffer[] = [];
  const fn = vi.fn((buf: Buffer) => {
    saved.push(buf);
    return `hash-${saved.length}`;
  });
  return Object.assign(fn, { saved });
};

describe('win32 output fallback', () => {
  const win32Exec = (behavior: (dir: string) => void) =>
    scriptedSpawn((call) => {
      if (call.cmd === 'where.exe') {
        call.child.emit('exit', 1, null);
        return;
      }
      if (call.cmd === 'taskkill') return;
      behavior(dirFromShellLine(call.cmd));
      call.child.emit('exit', 0, null);
    });

  it('claims a fresh generated_images file when the workdir stayed empty', async () => {
    writeFileSync(join(generated, 'img-old.png'), Buffer.from('stale'));
    const saveImage = newSaveImage();
    const { spawnImpl } = win32Exec(() => {
      writeFileSync(join(generated, 'img-new.png'), PNG_NEW);
    });
    const engine = createCodexEngine({ spawnImpl, platform: 'win32', probeTtlMs: 0, saveImage });
    const res = await engine.generate(req);
    expect(res.images).toEqual(['hash-1']);
    expect(saveImage.saved[0].equals(PNG_NEW)).toBe(true);
  });

  it('prefers the workdir image when codex did manage to move it', async () => {
    const saveImage = newSaveImage();
    const { spawnImpl } = win32Exec((dir) => {
      writeFileSync(join(generated, 'img-decoy.png'), Buffer.from('decoy'));
      writeFileSync(join(dir, 'out-1.png'), PNG_NEW);
    });
    const engine = createCodexEngine({ spawnImpl, platform: 'win32', probeTtlMs: 0, saveImage });
    const res = await engine.generate(req);
    expect(res.images).toEqual(['hash-1']);
    expect(saveImage.saved[0].equals(PNG_NEW)).toBe(true);
  });

  it('still fails cleanly when nothing new appeared anywhere', async () => {
    writeFileSync(join(generated, 'img-old.png'), Buffer.from('stale'));
    const saveImage = newSaveImage();
    const { spawnImpl } = win32Exec(() => {});
    const engine = createCodexEngine({ spawnImpl, platform: 'win32', probeTtlMs: 0, saveImage });
    await expect(engine.generate(req)).rejects.toThrow(/produced no images/);
    expect(saveImage).not.toHaveBeenCalled();
  });
});

describe('posix keeps the strict workdir contract', () => {
  it('never claims from generated_images', async () => {
    const saveImage = newSaveImage();
    const { spawnImpl } = scriptedSpawn((call) => {
      writeFileSync(join(generated, 'img-new.png'), PNG_NEW);
      call.child.emit('exit', 0, null);
    });
    const engine = createCodexEngine({ spawnImpl, platform: 'linux', probeTtlMs: 0, saveImage });
    await expect(engine.generate(req)).rejects.toThrow(/produced no images/);
    expect(saveImage).not.toHaveBeenCalled();
  });
});
