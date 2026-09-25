import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { spawn } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCodexAnalyzer, createCodexEngine, createRunner } from '../src/index.js';

/**
 * The codex agent runs in a sandbox and reads pictures and words anyone could
 * have made; Scenri runs outside it. So what crosses back is checked: a file
 * codex leaves is taken only when it is a plain file, a failed copy of the
 * person's picture never names a path, and the child never sees Scenri's other
 * providers' keys.
 */

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
const brand = { brand: {}, assetPaths: {} };

class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  stdin = { write: () => true, end: () => {}, on: () => {} };
  pid = 4242;
  kill = () => true;
}

/** A linux codex that runs `leave(workdir)` and exits 0, recording each child's env. */
function fakeCodex(leave: (dir: string) => void) {
  const envs: NodeJS.ProcessEnv[] = [];
  const spawnImpl = ((_cmd: string, args: string[], opts: { env: NodeJS.ProcessEnv }) => {
    envs.push(opts.env);
    const child = new FakeChild();
    setTimeout(() => {
      leave(args[args.indexOf('-C') + 1]);
      child.emit('exit', 0, null);
    }, 0);
    return child;
  }) as unknown as typeof spawn;
  return { spawnImpl, envs };
}

const made: string[] = [];
const secretFile = () => {
  const dir = mkdtempSync(join(tmpdir(), 'codex-secret-'));
  made.push(dir);
  const file = join(dir, 'secret.txt');
  writeFileSync(file, 'NOT-A-PICTURE');
  return file;
};
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('what Scenri takes back from a codex workdir', () => {
  it('refuses an out-1.png that is a link to a file elsewhere', async () => {
    const secret = secretFile();
    const { spawnImpl } = fakeCodex((dir) => symlinkSync(secret, join(dir, 'out-1.png')));
    const saveImage = vi.fn(() => 'hash-1');
    const engine = createCodexEngine({ platform: 'linux', saveImage, spawnImpl });
    await expect(engine.generate({ prompt: 'a mug', brand, width: 640, height: 800, count: 1 } as any)).rejects.toThrow(
      /out-1\.png is not a plain file/,
    );
    expect(saveImage).not.toHaveBeenCalled();
  });

  it('still takes a plain out-1.png', async () => {
    const { spawnImpl } = fakeCodex((dir) => writeFileSync(join(dir, 'out-1.png'), PNG));
    const saveImage = vi.fn(() => 'hash-1');
    const engine = createCodexEngine({ platform: 'linux', saveImage, spawnImpl });
    const res = await engine.generate({ prompt: 'a mug', brand, width: 640, height: 800, count: 1 } as any);
    expect(res.images).toEqual(['hash-1']);
  });

  it('reads no analysis.json that is a link', async () => {
    const secret = secretFile();
    // the read tries twice in one workdir, so the second attempt lays the link again
    const { spawnImpl } = fakeCodex((dir) => {
      rmSync(join(dir, 'analysis.json'), { force: true });
      symlinkSync(secret, join(dir, 'analysis.json'));
    });
    const analyzer = createCodexAnalyzer({ platform: 'linux', spawnImpl });
    const err = await analyzer
      .analyze({ kind: 'scene', imagePaths: [], name: '', instruction: 'a basalt shore' })
      .catch((e: Error) => e);
    expect(String((err as Error).message)).toMatch(/No analysis\.json was written/);
    expect(String((err as Error).message)).not.toContain('NOT-A-PICTURE');
  });

  it('says a reference could not be read without naming a path', async () => {
    const { spawnImpl } = fakeCodex(() => {});
    const missing = join(tmpdir(), 'codex-gone', 'photo.png');
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const engine = createCodexEngine({ platform: 'linux', saveImage: () => 'x', spawnImpl });
      const err = await engine.edit({ instruction: 'warmer', sourceImage: missing, brand } as any).catch((e) => e);
      expect((err as Error).message).toBe('A reference picture could not be read.');
      // the raw reason still reaches the log
      expect(String(errors.mock.calls[0]?.[0])).toContain('ENOENT');
    } finally {
      errors.mockRestore();
    }
  });

  it("never hands a codex child Scenri's other providers' keys", async () => {
    const { spawnImpl, envs } = fakeCodex((dir) => writeFileSync(join(dir, 'out-1.png'), PNG));
    const runner = createRunner({
      spawnImpl,
      platform: 'linux',
      env: { PATH: '/usr/bin', HOME: '/home/sam', OPENROUTER_API_KEY: 'a', FAL_KEY: 'b', REPLICATE_API_TOKEN: 'c' },
    });
    const engine = createCodexEngine({ platform: 'linux', saveImage: () => 'x', runner });
    await engine.generate({ prompt: 'a mug', brand, width: 640, height: 800, count: 1 } as any);
    expect(envs[0]).toEqual({ PATH: '/usr/bin', HOME: '/home/sam' });
  });
});
