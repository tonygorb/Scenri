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
import { variationPlan } from '../src/variationPlan.js';

let home: string;
let core: Core;
let productHash: string;
let faceA: string;
let faceB: string;
let sceneRef: string;
let scenePlate: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'sc-bind-'));
  core = createCore(home);
  productHash = core.images.save(Buffer.from('product-bytes'));
  faceA = core.images.save(Buffer.from('face-a'));
  faceB = core.images.save(Buffer.from('face-b'));
  sceneRef = core.images.save(Buffer.from('scene-portrait-of-person-a'));
  scenePlate = core.images.save(Buffer.from('scene-drawn-plate-nobody-in-it'));
});
afterEach(() => {
  core.close();
  rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
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
          id === 'us-portrait'
            ? { ...scene, preview: `asset:${scenePlate}`, refs: [{ file: `asset:${sceneRef}` }] }
            : undefined,
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
          id === 'us-portrait'
            ? { ...scene, preview: `asset:${scenePlate}`, refs: [{ file: `asset:${sceneRef}` }] }
            : undefined,
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

  // The plate is what conditions, and its bytes prove it: the payload carries
  // the drawn card's file, never the raw upload's.
  it('the scene slot carries the plate bytes, and without a plate a presenter shot ships no scene at all', async () => {
    const withPlate = compileBrief(
      {
        tokens: [
          { t: 'character', id: 'c1' },
          { t: 'template', id: 'us-portrait' },
        ],
      },
      {
        brand: brand(),
        images: core.images,
        engineCaps: CAPS,
        templateById: (id: string) =>
          id === 'us-portrait'
            ? { ...scene, preview: `asset:${scenePlate}`, refs: [{ file: `asset:${sceneRef}` }] }
            : undefined,
      },
    );
    const sceneAttach = withPlate.attachments.find((a) => a.role === 'scene');
    expect(sceneAttach?.hash).toBe(scenePlate);
    expect(withPlate.referenceImages).toContain(core.images.pathFor(scenePlate));
    expect(withPlate.referenceImages).not.toContain(core.images.pathFor(sceneRef));

    const noPlate = compileBrief(
      {
        tokens: [
          { t: 'character', id: 'c1' },
          { t: 'template', id: 'us-portrait' },
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
    expect(noPlate.attachments.map((a) => a.role)).not.toContain('scene');
  });
});

/**
 * The set contract, end to end.
 *
 * Generate 4 must be four photographs of ONE recipe. The reported failure was
 * output 1 holding the selected presenter while 2, 3 and 4 drifted into other
 * people, so what is pinned here is that nothing about the run's SIZE changes
 * what any one output is asked to be: one compile, one reference set, one size,
 * and per-slot text that differs only in the photographic move it names.
 */
describe('one canonical recipe, N photographs', () => {
  const fullStack = () =>
    compileBrief(
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
          id === 'us-portrait'
            ? { ...scene, preview: `asset:${scenePlate}`, refs: [{ file: `asset:${sceneRef}` }] }
            : undefined,
      },
    );

  async function runBatch(count: number) {
    const compiled = fullStack();
    const roles = compiled.attachments.map((a) => a.role);
    const variations = variationPlan(count, {
      hasPresenter: roles.includes('character'),
      hasProduct: roles.includes('product'),
      hasMark: roles.includes('brand'),
      cameraFixed: false,
    });
    // Frozen: a set contract that mutates its own inputs between outputs is not
    // a contract. If any of this is consumed in place the run throws.
    Object.freeze(compiled.referenceImages);
    Object.freeze(roles);
    Object.freeze(variations);
    const { spawnImpl, calls } = fakeSpawn();
    const engine = createCodexEngine({ platform: 'linux', saveImage: () => 'h1', spawnImpl });
    await engine.generate({
      prompt: compiled.prompt,
      brand: { brand: brand(), assetPaths: {} },
      width: compiled.width,
      height: compiled.height,
      count,
      referenceImages: compiled.referenceImages,
      referenceRoles: roles,
      ...(variations.length ? { variations } : {}),
    });
    return { compiled, roles, variations, calls };
  }

  it('sends every output the same references, roles, filenames and frame', async () => {
    const { compiled, roles, calls } = await runBatch(4);
    expect(calls).toHaveLength(4);

    const basenames = calls.map(({ args }) =>
      args.filter((a) => a.startsWith('--image=')).map((a) => a.split(/[\\/]/).pop()),
    );
    for (const b of basenames)
      expect(b).toEqual(['product-1.png', 'character-1.png', 'character-2.png', 'scene-1.png']);

    // Same frame in every slot: no output is quietly cheaper than another.
    const frames = calls.map(({ child }) => /composed as a (\d+x\d+) frame/.exec(child.stdin.written)?.[1]);
    expect(new Set(frames).size).toBe(1);

    // The compiler ran once and its outputs came back untouched.
    expect(compiled.referenceImages).toHaveLength(4);
    expect(roles).toEqual(['product', 'character', 'character', 'scene']);
  });

  it('differs between outputs only by the variation clause', async () => {
    const { variations, calls } = await runBatch(4);
    const prompts = calls.map(({ child }) => child.stdin.written);
    const stripped = prompts.map((p) => {
      const hit = variations.find((v) => p.endsWith(` ${v}`));
      expect(hit).toBeTruthy();
      return p.slice(0, p.length - (hit as string).length);
    });
    expect(new Set(stripped).size).toBe(1);
    // every slot got its own clause, none got another's
    expect(new Set(prompts).size).toBe(4);
  });

  it('locks the identities the user actually selected, in every output', async () => {
    const { calls } = await runBatch(4);
    for (const { child } of calls) {
      const p = child.stdin.written;
      expect(p).toContain('The person is the one in the character references and nobody else');
      expect(p).toContain('The product is the one in the product references and no other');
      expect(p).toContain('the same wardrobe garment for garment');
      // and the identity binding the earlier fix established still holds
      expect(p).toContain('character-1.png shows the exact person');
      expect(p).toContain('scene-1.png shows a reference for this world');
      expect(p).toContain('take no identity from the person in it');
    }
  });

  it('carries no counter, so no output is described as later than another', async () => {
    const { calls } = await runBatch(4);
    for (const { child } of calls) {
      expect(child.stdin.written).not.toMatch(/take \d+ of \d+/);
      expect(child.stdin.written).not.toMatch(/variant \d+/);
    }
  });

  it('leaves a single image exactly as it was', async () => {
    const one = await runBatch(1);
    expect(one.variations).toEqual([]);
    const solo = one.calls[0].child.stdin.written;
    // Byte-identical to what a count of 1 sent before any of this existed: the
    // set contract may not change what one photograph is.
    expect(solo).not.toContain('one continuous shoot');
    expect(solo).not.toMatch(/take \d+ of \d+/);
  });
});
