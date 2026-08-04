import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { spawn } from 'node:child_process';
import type { BrandContext, EditRequest, GenerateRequest } from '@scenri/core';
import { createCodexEngine } from '../src/index.js';

const PNG_1 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 1, 1]);
const PNG_2 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 2, 2, 2]);

const brand: BrandContext = { brand: {}, assetPaths: {} };

const genReq: GenerateRequest = {
  prompt: 'a fox mascot on a teal background',
  brand,
  width: 640,
  height: 480,
  count: 2,
};

class FakeChild extends EventEmitter {
  kill = vi.fn(() => true);
  stdout = new EventEmitter();
  stderr = new EventEmitter();
}

interface SpawnCall {
  cmd: string;
  args: string[];
  child: FakeChild;
}

/** Build a fake spawnImpl; `onSpawn` runs on the next tick so listeners attach first. */
function fakeSpawn(onSpawn: (call: SpawnCall) => void): {
  spawnImpl: typeof spawn;
  calls: SpawnCall[];
} {
  const calls: SpawnCall[] = [];
  const spawnImpl = ((cmd: string, args: string[]) => {
    const call: SpawnCall = { cmd, args, child: new FakeChild() };
    calls.push(call);
    setTimeout(() => onSpawn(call), 0);
    return call.child;
  }) as unknown as typeof spawn;
  return { spawnImpl, calls };
}

function dirFromArgs(args: string[]): string {
  const i = args.indexOf('-C');
  expect(i).toBeGreaterThan(-1);
  return args[i + 1];
}

function newSaveImage() {
  let n = 0;
  return vi.fn((_buf: Buffer) => `hash-${++n}`);
}

describe('capabilities / costEstimate', () => {
  it('reports the locked codex-cli capabilities', () => {
    const engine = createCodexEngine({ saveImage: newSaveImage() });
    expect(engine.capabilities()).toEqual({
      id: 'codex-cli',
      displayName: 'Codex CLI',
      localOnly: true,
      supportsEdit: true,
      supportsMask: false,
      maxReferenceImages: 1,
    });
  });

  it('costEstimate is always 0', async () => {
    const engine = createCodexEngine({ saveImage: newSaveImage() });
    await expect(engine.costEstimate(genReq)).resolves.toBe(0);
  });
});

describe('isAvailable', () => {
  it('resolves ok:true when `codex --version` exits 0', async () => {
    const { spawnImpl, calls } = fakeSpawn(({ child }) => child.emit('exit', 0, null));
    const engine = createCodexEngine({ saveImage: newSaveImage(), spawnImpl });
    await expect(engine.isAvailable()).resolves.toEqual({ ok: true });
    expect(calls).toHaveLength(1);
    expect(calls[0].cmd).toBe('codex');
    expect(calls[0].args).toEqual(['--version']);
  });

  it('resolves ok:false with reason on ENOENT (never rejects)', async () => {
    const { spawnImpl } = fakeSpawn(({ child }) => {
      const err = Object.assign(new Error('spawn codex ENOENT'), { code: 'ENOENT' });
      child.emit('error', err);
    });
    const engine = createCodexEngine({ saveImage: newSaveImage(), spawnImpl });
    await expect(engine.isAvailable()).resolves.toEqual({
      ok: false,
      reason: 'Codex CLI not found or not signed in (run: codex login)',
    });
  });

  it('resolves ok:false with reason on nonzero exit', async () => {
    const { spawnImpl } = fakeSpawn(({ child }) => child.emit('exit', 1, null));
    const engine = createCodexEngine({ saveImage: newSaveImage(), spawnImpl });
    await expect(engine.isAvailable()).resolves.toEqual({
      ok: false,
      reason: 'Codex CLI not found or not signed in (run: codex login)',
    });
  });
});

describe('generate', () => {
  it('runs one codex exec per image with low reasoning, collects hashes in order', async () => {
    let n = 0;
    const { spawnImpl, calls } = fakeSpawn(({ args, child }) => {
      const dir = dirFromArgs(args);
      writeFileSync(join(dir, 'out-1.png'), n++ === 0 ? PNG_1 : PNG_2);
      child.emit('exit', 0, null);
    });
    const saveImage = newSaveImage();
    const engine = createCodexEngine({ saveImage, spawnImpl });

    const result = await engine.generate(genReq); // count: 2 → two parallel execs

    expect(calls).toHaveLength(2);
    for (const { cmd, args } of calls) {
      expect(cmd).toBe('codex');
      expect(args.slice(0, 4)).toEqual(['exec', '--skip-git-repo-check', '--sandbox', 'workspace-write']);
      expect(args).toContain('model_reasoning_effort="low"');
      const promptText = args[args.indexOf('-C') + 2];
      expect(promptText).toContain('Generate one flawless, professional-grade image immediately');
      expect(promptText).toContain('640x480: a fox mascot on a teal background');
      expect(promptText).toContain('Save the image in the current directory as out-1.png');
    }
    // second run is asked for a distinct composition
    const prompts = calls.map(({ args }) => args[args.indexOf('-C') + 2]);
    expect(prompts.filter((p) => p.includes('variant 2'))).toHaveLength(1);
    // distinct workdirs, both cleaned up
    const dirs = calls.map(({ args }) => dirFromArgs(args));
    expect(new Set(dirs).size).toBe(2);
    for (const d of dirs) expect(existsSync(d)).toBe(false);

    expect(saveImage).toHaveBeenCalledTimes(2);
    expect(result.costUsd).toBe(0);
    expect(result.images.slice().sort()).toEqual(['hash-1', 'hash-2']); // parallel workers — arrival order varies
  });

  it('injects brand palette/mood/avoid into the prompt when present, omits when absent', async () => {
    const { spawnImpl, calls } = fakeSpawn(({ args, child }) => {
      writeFileSync(join(dirFromArgs(args), 'out-1.png'), PNG_1);
      child.emit('exit', 0, null);
    });
    const engine = createCodexEngine({ saveImage: newSaveImage(), spawnImpl });
    const branded = {
      ...genReq,
      count: 1,
      brand: {
        assetPaths: {},
        brand: {
          specVersion: '0.1',
          meta: { name: 'Acme', tagline: 'Slow mornings' },
          palette: { primary: { hex: '#1F3D2B' }, accent: [{ hex: '#D96C3B' }] },
          imagery: { mood: 'crafted, tactile', keywords: ['warm daylight'], avoid: ['neon'] },
        },
      },
    };
    await engine.generate(branded);
    const p1 = calls[0].args[calls[0].args.indexOf('-C') + 2];
    expect(p1).toContain('brand colors #1F3D2B, #D96C3B');
    expect(p1).toContain('mood: crafted, tactile');
    expect(p1).toContain('avoid: neon');
    expect(p1).toContain('Slow mornings');

    await engine.generate({ ...genReq, count: 1, brand: { brand: {}, assetPaths: {} } });
    const p2 = calls[1].args[calls[1].args.indexOf('-C') + 2];
    expect(p2).not.toContain('Brand style');
  });

  it('passes referenceImages[0] via --image and adds the fidelity directive', async () => {
    const srcDir = mkdtempSync(join(tmpdir(), 'codex-ref-'));
    const refPath = join(srcDir, 'product.png');
    writeFileSync(refPath, PNG_1);
    const { spawnImpl, calls } = fakeSpawn(({ args, child }) => {
      writeFileSync(join(dirFromArgs(args), 'out-1.png'), PNG_2);
      child.emit('exit', 0, null);
    });
    const engine = createCodexEngine({ saveImage: newSaveImage(), spawnImpl });
    await engine.generate({ ...genReq, count: 1, referenceImages: [refPath] });
    const args = calls[0].args;
    expect(args).toContain(`--image=${join(dirFromArgs(args), 'product.png')}`);
    expect(args[args.length - 1]).not.toContain('--image'); // prompt stays the positional tail
    const promptText = args[args.length - 1];
    expect(promptText).toContain('preserve its label, shape, colors and design faithfully');
  });

  it('rejects the whole batch when one parallel run fails', async () => {
    let n = 0;
    const { spawnImpl } = fakeSpawn(({ args, child }) => {
      if (n++ === 0) {
        writeFileSync(join(dirFromArgs(args), 'out-1.png'), PNG_1);
        child.emit('exit', 0, null);
      } else {
        child.stderr.emit('data', 'image tool unavailable');
        child.emit('exit', 1, null);
      }
    });
    const engine = createCodexEngine({ saveImage: newSaveImage(), spawnImpl });
    await expect(engine.generate(genReq)).rejects.toThrow(/exited with code 1.*image tool unavailable/s);
  });

  it('throws a clear error when codex exits 0 without producing images', async () => {
    const { spawnImpl } = fakeSpawn(({ child }) => child.emit('exit', 0, null));
    const engine = createCodexEngine({ saveImage: newSaveImage(), spawnImpl });
    await expect(engine.generate(genReq)).rejects.toThrow('Codex finished but produced no images');
  });

  it('throws with exit code and stderr snippet on nonzero exit', async () => {
    const { spawnImpl } = fakeSpawn(({ child }) => {
      child.stderr.emit('data', Buffer.from('not signed in'));
      child.emit('exit', 3, null);
    });
    const saveImage = newSaveImage();
    const engine = createCodexEngine({ saveImage, spawnImpl });
    await expect(engine.generate(genReq)).rejects.toThrow(/codex exited with code 3: not signed in/);
    expect(saveImage).not.toHaveBeenCalled();
  });

  it('kills the child and throws after timeoutMs when codex never exits', async () => {
    const { spawnImpl, calls } = fakeSpawn(() => {
      /* never exits */
    });
    const engine = createCodexEngine({ saveImage: newSaveImage(), spawnImpl, timeoutMs: 50 });
    await expect(engine.generate(genReq)).rejects.toThrow('Codex CLI timed out after 50ms');
    expect(calls[0].child.kill).toHaveBeenCalled();
  });
});

describe('edit', () => {
  it('copies sourceImage to input.png, sends the edit prompt, returns the hash', async () => {
    const srcDir = mkdtempSync(join(tmpdir(), 'codex-test-src-'));
    const sourceImage = join(srcDir, 'photo.png');
    writeFileSync(sourceImage, PNG_1);

    let inputBytes: Buffer | undefined;
    const { spawnImpl, calls } = fakeSpawn(({ args, child }) => {
      const dir = dirFromArgs(args);
      void readFile(join(dir, 'input.png')).then((buf) => {
        inputBytes = buf;
        writeFileSync(join(dir, 'out-1.png'), PNG_2);
        child.emit('exit', 0, null);
      });
    });
    const saveImage = newSaveImage();
    const engine = createCodexEngine({ saveImage, spawnImpl });

    const req: EditRequest = { instruction: 'make the sky teal', sourceImage, brand };
    const result = await engine.edit(req);

    const { cmd, args } = calls[0];
    expect(cmd).toBe('codex');
    expect(args.slice(0, 4)).toEqual(['exec', '--skip-git-repo-check', '--sandbox', 'workspace-write']);
    expect(args[args.indexOf('-C') + 2]).toBe(
      'Edit input.png using your image generation/editing tool: make the sky teal.' +
        ' Do not browse the web or explore files. Save the result in the current directory as out-1.png' +
        ' (you may run the commands needed to save and resize it). Nothing else.',
    );
    expect(inputBytes?.equals(PNG_1)).toBe(true);
    expect(saveImage).toHaveBeenCalledTimes(1);
    expect(saveImage.mock.calls[0][0].equals(PNG_2)).toBe(true);
    expect(result).toEqual({ images: ['hash-1'], costUsd: 0 });
  });

  it('propagates a clear error when codex exits 0 without out-1.png', async () => {
    const srcDir = mkdtempSync(join(tmpdir(), 'codex-test-src-'));
    const sourceImage = join(srcDir, 'photo.png');
    writeFileSync(sourceImage, PNG_1);

    const { spawnImpl } = fakeSpawn(({ child }) => child.emit('exit', 0, null));
    const engine = createCodexEngine({ saveImage: newSaveImage(), spawnImpl });
    await expect(engine.edit({ instruction: 'x', sourceImage, brand })).rejects.toThrow(
      'Codex finished but produced no images',
    );
  });
});
