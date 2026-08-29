/**
 * The compile-to-filename contract, end to end.
 *
 * compileBrief decides which pictures ride and in what order; the codex
 * adapter names each file for its role and binds the prompt to those names.
 * This is the seam the identity-mix report sat on - a scene reference read as
 * "the exact person" - so the whole chain is pinned in one place: brief in,
 * --image args and filename-bound prose out.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { spawn } from 'node:child_process';
import { createCore, type Core, type EngineCapabilities } from '@scenri/core';
import { createCodexEngine } from '@scenri/engine-codex';
import { compileBrief } from '../src/brief.js';

let home: string;
let core: Core;
let productHash: string;
let faceA: string;
let faceB: string;
let sceneRef: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'sc-bind-'));
  core = createCore(home);
  productHash = core.images.save(Buffer.from('product-bytes'));
  faceA = core.images.save(Buffer.from('face-a'));
  faceB = core.images.save(Buffer.from('face-b'));
  sceneRef = core.images.save(Buffer.from('scene-portrait-of-person-a'));
});
afterEach(() => {
  core.close();
  rmSync(home, { recursive: true, force: true });
});

const CAPS: EngineCapabilities = {
  id: 'codex-cli',
  displayName: 'Codex CLI',
  localOnly: true,
  supportsEdit: true,
  supportsMask: false,
  maxReferenceImages: 5,
};

const brand = () => ({
  meta: { name: 'Acme' },
  products: [
    { id: 'p1', name: 'House Blend', shots: [{ file: `asset:${productHash}`, angle: 'front', locked: true }] },
  ],
  characters: [
    {
      id: 'c1',
      name: 'Presenter B',
      shots: [
        { file: `asset:${faceA}`, angle: 'front', locked: true },
        { file: `asset:${faceB}`, angle: 'left-profile', locked: true },
      ],
    },
  ],
});

const scene = {
  id: 'us-portrait',
  name: 'Portrait World',
  promptName: 'Portrait World',
  lighting: 'Soft frontal light',
  description: 'A close portrait world.',
  subject: 'person' as const,
  collections: [],
  verticals: [],
  prompt: 'A warm seamless studio ground.',
  figure: 'one person at close portrait range',
  refs: [{ file: `asset:${''}` }],
  width: 1024,
  height: 1280,
};

class FakeChild extends EventEmitter {
  kill = vi.fn(() => true);
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
}

function fakeSpawn() {
  const calls: Array<{ args: string[]; child: FakeChild }> = [];
  const spawnImpl = ((_cmd: string, args: string[]) => {
    const call = { args, child: new FakeChild() };
    calls.push(call);
    setTimeout(() => {
      const i = args.indexOf('-C');
      writeFileSync(join(args[i + 1], 'out-1.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 9]));
      call.child.emit('exit', 0, null);
    }, 0);
    return call.child;
  }) as unknown as typeof spawn;
  return { spawnImpl, calls };
}

describe('compileBrief order survives into codex filenames and prose', () => {
  it('the tester shape: presenter + figure-led scene', async () => {
    const compiled = compileBrief(
      {
        tokens: [
          { t: 'character', id: 'c1' },
          { t: 'template', id: 'us-portrait' },
          { t: 'text', v: 'she smiles at the camera' },
        ],
      },
      {
        brand: brand(),
        images: core.images,
        engineCaps: CAPS,
        templateById: (id: string) =>
          id === 'us-portrait' ? { ...scene, refs: [{ file: `asset:${sceneRef}` }] } : undefined,
      },
    );
    expect(compiled.attachments.map((a) => a.role)).toEqual(['character', 'character', 'scene']);

    const { spawnImpl, calls } = fakeSpawn();
    const engine = createCodexEngine({ platform: 'linux', saveImage: () => 'h1', spawnImpl });
    await engine.generate({
      prompt: compiled.prompt,
      brand: { brand: brand(), assetPaths: {} },
      width: compiled.width,
      height: compiled.height,
      count: 1,
      referenceImages: compiled.referenceImages,
      referenceRoles: compiled.attachments.map((a) => a.role),
    });

    const args = calls[0].args;
    const basenames = args.filter((a) => a.startsWith('--image=')).map((a) => a.split(/[\\/]/).pop());
    expect(basenames).toEqual(['character-1.png', 'character-2.png', 'scene-1.png']);
    const prompt = calls[0].child.stdin.written;
    expect(prompt).toContain('character-1.png shows the exact person');
    expect(prompt).toContain('character-2.png shows the exact person');
    expect(prompt).toContain('scene-1.png shows a reference for this world');
    expect(prompt).toContain('take no identity from the person in it');
    expect(prompt).not.toContain('Attached image');
  });

  it('product + presenter + scene fills five slots in role-priority order', async () => {
    const compiled = compileBrief(
      {
        tokens: [
          { t: 'template', id: 'us-portrait' },
          { t: 'character', id: 'c1' },
          { t: 'product', id: 'p1' },
          { t: 'text', v: 'she holds it up' },
        ],
      },
      {
        brand: brand(),
        images: core.images,
        engineCaps: CAPS,
        templateById: (id: string) =>
          id === 'us-portrait' ? { ...scene, refs: [{ file: `asset:${sceneRef}` }] } : undefined,
      },
    );
    expect(compiled.attachments.map((a) => a.role)).toEqual(['product', 'character', 'character', 'scene']);

    const { spawnImpl, calls } = fakeSpawn();
    const engine = createCodexEngine({ platform: 'linux', saveImage: () => 'h1', spawnImpl });
    await engine.generate({
      prompt: compiled.prompt,
      brand: { brand: brand(), assetPaths: {} },
      width: compiled.width,
      height: compiled.height,
      count: 1,
      referenceImages: compiled.referenceImages,
      referenceRoles: compiled.attachments.map((a) => a.role),
    });
    const basenames = calls[0].args.filter((a) => a.startsWith('--image=')).map((a) => a.split(/[\\/]/).pop());
    expect(basenames).toEqual(['product-1.png', 'character-1.png', 'character-2.png', 'scene-1.png']);
  });
});
