import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCore, type Core, type EngineAdapter, type EngineCapabilities } from '@scenri/core';
import { compileBrief, type Brief, type ScalePlan } from '../src/brief.js';
import {
  drawAtScale,
  largestCm,
  needsOwnScale,
  placeInstruction,
  platePrompt,
  readSize,
  resolveSize,
  sizeFromWords,
  spanCm,
} from '../src/productScale.js';
import { createProductSizes } from '../src/productSizes.js';

let home: string;
let core: Core;
let productHash: string;
let plateHash: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'sc-scale-'));
  core = createCore(home);
  productHash = core.images.save(Buffer.from('product-bytes'));
  plateHash = core.images.save(Buffer.from('scene-plate-bytes'));
});
afterEach(() => {
  core.close();
  rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

describe('reading a size', () => {
  it('reads the largest dimension in centimetres from the way a shop writes it', () => {
    expect(largestCm('about 2 cm across')).toBe(2);
    expect(largestCm('20 x 30 cm')).toBe(30);
    expect(largestCm('45 × 35 × 12 cm')).toBe(45);
    expect(largestCm('18mm')).toBe(1.8);
    expect(largestCm('1.2 m tall')).toBe(120);
    expect(largestCm('6 inches')).toBe(15.2);
    expect(largestCm('7,5 cm')).toBe(7.5);
  });

  it('refuses words with no unit to read', () => {
    expect(largestCm('large')).toBeNull();
    expect(largestCm('one size')).toBeNull();
    expect(largestCm('size 42')).toBeNull();
    expect(largestCm('')).toBeNull();
    expect(sizeFromWords('large')).toBeNull();
    expect(sizeFromWords('  about   2 cm  ')).toEqual({ text: 'about 2 cm', largestCm: 2 });
  });

  it('frames four product lengths, within what a camera can do', () => {
    expect(spanCm(2)).toBe(8);
    expect(spanCm(10)).toBe(40);
    expect(spanCm(0.5)).toBe(6);
    expect(spanCm(80)).toBe(180);
  });

  it('only a product smaller than furniture needs its own magnification', () => {
    expect(needsOwnScale({ text: 'about 2 cm', largestCm: 2 })).toBe(true);
    expect(needsOwnScale({ text: 'about 45 cm', largestCm: 45 })).toBe(true);
    expect(needsOwnScale({ text: 'about 80 cm', largestCm: 80 })).toBe(false);
    expect(needsOwnScale(null)).toBe(false);
  });

  it("a person's correction beats the record, and the record beats the read", () => {
    const read = { text: 'about 10 cm tall', largestCm: 10, by: 'estimate' as const };
    const mine = { text: '12 cm', largestCm: 12, by: 'person' as const };
    expect(resolveSize('30 x 20 cm', read)).toEqual({ text: '30 x 20 cm', largestCm: 30, by: 'record' });
    expect(resolveSize('30 x 20 cm', mine)).toEqual(mine);
    expect(resolveSize(undefined, read)).toEqual(read);
    // a record with no unit is not a size, so the read stands
    expect(resolveSize('one size', read)).toEqual(read);
    expect(readSize('not json')).toBeNull();
    expect(readSize(JSON.stringify({ text: 'x', largestCm: -1 }))).toBeNull();
    expect(readSize(JSON.stringify({ text: 'about 2 cm', largestCm: 2 }))?.by).toBe('estimate');
  });
});

describe('the two prompts', () => {
  it('the plate is led by the lens and never carries the room as its view', () => {
    const room = 'An open concrete floor occupies the foreground and a tall recessed wall closes the background';
    const p = platePrompt({ span: 16, picture: true, light: 'One hard raking side light.', place: room });
    expect(p).toContain('the whole frame spans only about 16 centimetres of that surface');
    expect(p).toContain('taken with the camera about 32 centimetres from it:');
    expect(p).toContain('down to its finest particles');
    expect(p).toContain('The light: One hard raking side light.');
    expect(p).toContain('never a row of stripes');
    expect(p).toContain('The surface is empty: no product');
    // with the place's own picture attached, its room-scale words stay out
    expect(p).not.toContain(room);
  });

  it('without a picture, the place is described only as what its surface is made of', () => {
    const p = platePrompt({ span: 150, picture: false, place: 'A concrete hall.' });
    expect(p).toContain('the photograph does not show this view: A concrete hall.');
    expect(p).toContain('about 3 metres from it');
    expect(p).toContain('as large as it really is against this span');
  });

  it('a view the shot asks for leads the plate, and what it names may stand in it', () => {
    const p = platePrompt({ span: 28, picture: true, shot: 'seen from directly above' });
    expect(p).toContain('The view is the one the shot asks for: seen from directly above.');
    expect(p).not.toContain('lower two thirds');
    expect(p).toContain('no object the shot does not ask for');
  });

  it('the placement states the span, the size and the quarter, and carries the identity lines', () => {
    const p = placeInstruction({
      name: 'Signet Ring',
      size: { text: 'about 2 cm across', largestCm: 2 },
      span: 8,
      shot: 'lying on its side',
      product: ['The attached product image is the exact product.'],
    });
    expect(p).toContain('input.png is a photograph of a surface whose frame spans about 8 centimetres');
    expect(p).toContain(
      "Place Signet Ring on that surface where the light falls, at its true real-world size, about 2 cm across: about a quarter of the frame's width.",
    );
    expect(p).toContain('The shot asks for: lying on its side.');
    expect(p).toContain('The attached product image is the exact product.');
    expect(p.endsWith('Add no other object, no person, no hands and no text')).toBe(true);
  });
});

describe('which shots are drawn in two steps', () => {
  const caps: EngineCapabilities = {
    id: 'x',
    displayName: 'Codex CLI',
    localOnly: false,
    supportsEdit: true,
    supportsMask: false,
    maxReferenceImages: 4,
  };
  const place = (over: Record<string, unknown> = {}) => ({
    id: 'us-steps',
    name: 'Concrete Steps',
    lighting: 'One hard raking side light',
    description: 'A brutalist hall.',
    subject: 'either' as const,
    collections: [],
    verticals: [],
    prompt: 'A minimal brutalist interior of raw board-formed concrete.',
    width: 1024,
    height: 1280,
    preview: `asset:${plateHash}`,
    ...over,
  });
  const brand = () => ({
    meta: { name: 'Acme' },
    products: [
      { id: 'p1', name: 'Signet Ring', shots: [{ file: `asset:${productHash}`, locked: true }] },
      { id: 'p2', name: 'Field Watch', shots: [{ file: `asset:${productHash}`, locked: true }] },
    ],
    characters: [{ id: 'c1', name: 'Marco', shots: [{ file: `asset:${productHash}`, locked: true }] }],
    logos: [{ id: 'l1', file: `asset:${productHash}` }],
  });
  const compile = (tokens: Brief['tokens'], scene = place(), mode?: 'edit') =>
    compileBrief(
      { tokens },
      {
        brand: brand(),
        images: core.images,
        engineCaps: caps,
        templateById: (id: string) => (id === scene.id ? (scene as any) : undefined),
        ...(mode ? { mode } : {}),
      },
    );
  const alone: Brief['tokens'] = [
    { t: 'product', id: 'p1' },
    { t: 'text', v: ' on the steps, from a low angle' },
    { t: 'template', id: 'us-steps' },
  ];

  it('one product alone in a place with its own picture gets a plan', () => {
    const plan = compile(alone).scale as ScalePlan;
    expect(plan).toBeDefined();
    expect(plan.productId).toBe('p1');
    expect(plan.name).toBe('Signet Ring');
    expect(plan.productHash).toBe(productHash);
    expect(plan.sceneHash).toBe(plateHash);
    expect(plan.light).toBe('One hard raking side light');
    expect(plan.shot).toBe('on the steps, from a low angle');
    expect(plan.productLines.join(' ')).toContain('exact product');
  });

  it('anything else is drawn the ordinary way', () => {
    // a presenter, or words that ask for a person
    expect(compile([...alone, { t: 'character', id: 'c1' }]).scale).toBeUndefined();
    expect(compile([...alone, { t: 'text', v: ' held in her hand' }]).scale).toBeUndefined();
    // two products
    expect(compile([...alone, { t: 'product', id: 'p2' }]).scale).toBeUndefined();
    // a mark or a colour asked of the shot
    expect(compile([...alone, { t: 'mark', imageHash: productHash }]).scale).toBeUndefined();
    expect(compile([...alone, { t: 'color', hex: '#112233', name: 'Ink' }]).scale).toBeUndefined();
    // a place with no picture, a figure-led place, a product's own world
    expect(compile(alone, place({ preview: undefined })).scale).toBeUndefined();
    expect(compile(alone, place({ figure: 'one person seated' })).scale).toBeUndefined();
    expect(compile(alone, place({ subject: 'product' })).scale).toBeUndefined();
    // a refinement keeps its own source frame
    expect(compile(alone, place(), 'edit').scale).toBeUndefined();
  });
});

describe('the two draws', () => {
  const plan = (): ScalePlan => ({
    productId: 'p1',
    name: 'Signet Ring',
    dimensions: null,
    description: null,
    productHash,
    sceneHash: plateHash,
    light: 'One hard raking side light',
    shot: '',
    productLines: ['The attached product image is the exact product.'],
  });
  const fake = (over: { editFails?: number[]; concurrency?: number } = {}) => {
    const calls: { generate: any[]; edit: any[] } = { generate: [], edit: [] };
    let edits = 0;
    const engine = {
      capabilities: () => ({ id: 'fake', imageConcurrency: over.concurrency ?? 2 }),
      generate: async (req: any, _signal?: AbortSignal, onImage?: (slot: number, hash: string) => void) => {
        calls.generate.push(req);
        const images = Array.from({ length: req.count }, (_, i) => core.images.save(Buffer.from(`plate-${i}`)));
        for (const [i, h] of images.entries()) onImage?.(i, h);
        return { images, costUsd: 0.01 };
      },
      edit: async (req: any) => {
        const n = edits++;
        calls.edit.push(req);
        if (over.editFails?.includes(n)) throw new Error('placement refused');
        return { images: [core.images.save(Buffer.from(`placed-${n}`))], costUsd: 0.02 };
      },
    } as unknown as EngineAdapter;
    return { engine, calls };
  };
  const run = (engine: EngineAdapter, count: number, landed: [number, string][] = []) =>
    drawAtScale({
      engine,
      images: core.images,
      brand: { brand: {} } as any,
      plan: plan(),
      size: { text: 'about 2 cm across', largestCm: 2 },
      width: 1024,
      height: 1280,
      count,
      signal: new AbortController().signal,
      onImage: (slot, hash) => landed.push([slot, hash]),
    });

  it('draws the plates once, then places the product on each as it lands', async () => {
    const { engine, calls } = fake();
    const landed: [number, string][] = [];
    const r = await run(engine, 3, landed);
    expect(calls.generate).toHaveLength(1);
    expect(calls.generate[0].count).toBe(3);
    expect(calls.generate[0].referenceRoles).toEqual(['scene']);
    expect(calls.generate[0].referenceImages).toEqual([core.images.pathFor(plateHash)]);
    expect(calls.generate[0].prompt).toContain('spans only about 8 centimetres');
    expect(calls.edit).toHaveLength(3);
    expect(calls.edit[0].referenceRoles).toEqual(['product']);
    expect(calls.edit[0].referenceImages).toEqual([core.images.pathFor(productHash)]);
    expect(calls.edit[0].instruction).toContain('Place Signet Ring on that surface');
    expect(r.images).toHaveLength(3);
    expect(landed.map(([slot]) => slot).sort()).toEqual([0, 1, 2]);
    expect(r.costUsd).toBeCloseTo(0.01 + 3 * 0.02);
  });

  it('a placement that fails fails its own slot and says why; the rest are kept', async () => {
    const { engine } = fake({ editFails: [1] });
    const r = await run(engine, 3);
    expect(r.images).toHaveLength(2);
    expect((r.raw as any).partialFailures).toEqual(['placement refused']);
    expect((r.raw as any).variantIndexes).toHaveLength(2);
  });

  it('when every placement fails, the run fails with the reason', async () => {
    const { engine } = fake({ editFails: [0] });
    await expect(run(engine, 1)).rejects.toThrow('placement refused');
  });
});

describe('product sizes', () => {
  const reader = (answer = { text: 'about 2 cm across', largestCm: 2 }) => {
    let reads = 0;
    const analyzer = {
      isAvailable: async () => ({ ok: true }),
      analyze: async () => {
        throw new Error('not used');
      },
      measure: async () => {
        reads++;
        await new Promise((r) => setTimeout(r, 5));
        return answer;
      },
    };
    return { analyzer: analyzer as any, reads: () => reads };
  };
  const ring = () => ({ id: 'p1', name: 'Signet Ring', photo: core.images.pathFor(productHash) });

  it('reads a size once, keeps it per brand, and shares a read already under way', async () => {
    const r = reader();
    const sizes = createProductSizes(core, async () => r.analyzer);
    const [a, b] = await Promise.all([sizes.ensure('b1', ring()), sizes.ensure('b1', ring())]);
    expect(a).toEqual({ text: 'about 2 cm across', largestCm: 2, by: 'estimate' });
    expect(b).toEqual(a);
    expect(await sizes.ensure('b1', ring())).toEqual(a);
    expect(r.reads()).toBe(1);
    // another brand never shares a guess
    await sizes.ensure('b2', ring());
    expect(r.reads()).toBe(2);
  });

  it('asks nothing when nothing can read, or when the record already says', async () => {
    const r = reader();
    expect(await createProductSizes(core, async () => null).ensure('b1', ring())).toBeNull();
    const sizes = createProductSizes(core, async () => r.analyzer);
    expect(await sizes.ensure('b1', { ...ring(), dimensions: '3 cm' })).toEqual({
      text: '3 cm',
      largestCm: 3,
      by: 'record',
    });
    expect(r.reads()).toBe(0);
  });

  it("a person's size wins, words without a unit are refused, and nothing takes it back", async () => {
    const r = reader();
    const sizes = createProductSizes(core, async () => r.analyzer);
    await sizes.ensure('b1', ring());
    expect(sizes.set('b1', ring(), 'large')).toBe('unreadable');
    expect(sizes.set('b1', { ...ring(), dimensions: '3 cm' }, '2.5 cm across')).toEqual({
      text: '2.5 cm across',
      largestCm: 2.5,
      by: 'person',
    });
    expect(sizes.known('b1', { id: 'p1', dimensions: '3 cm' })?.text).toBe('2.5 cm across');
    expect(sizes.set('b1', { id: 'p1', dimensions: '3 cm' }, '')).toEqual({ text: '3 cm', largestCm: 3, by: 'record' });
  });

  it('every compile carries the size that holds as the product dimensions', async () => {
    const r = reader();
    const sizes = createProductSizes(core, async () => r.analyzer);
    await sizes.ensure('b1', ring());
    const json = {
      products: [
        { id: 'p1', name: 'Signet Ring' },
        { id: 'p2', name: 'Unread' },
      ],
    };
    const out = sizes.apply('b1', json);
    expect(out.products[0]).toEqual({ id: 'p1', name: 'Signet Ring', dimensions: 'about 2 cm across' });
    expect(out.products[1]).toBe(json.products[1]);
    // nothing known, nothing copied
    expect(sizes.apply('b9', json)).toBe(json);
  });
});
