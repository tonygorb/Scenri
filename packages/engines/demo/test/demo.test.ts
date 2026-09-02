import { describe, it, expect } from 'vitest';
import { createDemoEngine, demoOptionsFromEnv } from '../src/index.js';
import { BUDGET_EXHAUSTED, type BrandContext } from '@scenri/core';

const brand: BrandContext = {
  brand: {
    specVersion: '0.1',
    meta: { name: 'Acme' },
    palette: { primary: { hex: '#1F3D2B' }, secondary: { hex: '#D96C3B' } },
  },
  assetPaths: {},
};

describe('mock engine', () => {
  it('is always available, zero cost, correct capabilities', async () => {
    const e = createDemoEngine(() => 'h');
    expect((await e.isAvailable()).ok).toBe(true);
    expect(await e.costEstimate({ prompt: 'x', brand, width: 64, height: 64, count: 3 })).toBe(0);
    expect(e.capabilities()).toMatchObject({ id: 'demo', localOnly: false, supportsEdit: true });
  });

  // 30s, not the 5s default: sharp's first render on a cold Windows CI
  // runner loads libvips DLLs and can alone eat the default budget.
  it('generates `count` PNG images through saveImage', { timeout: 30_000 }, async () => {
    const saved: Buffer[] = [];
    const e = createDemoEngine((b) => {
      saved.push(b);
      return `hash-${saved.length}`;
    });
    const res = await e.generate({ prompt: 'hero shot', brand, width: 96, height: 96, count: 3 });
    expect(res.images).toEqual(['hash-1', 'hash-2', 'hash-3']);
    expect(res.costUsd).toBe(0);
    for (const b of saved) expect(b.subarray(1, 4).toString()).toBe('PNG');
  });

  it('edit produces one image and escapes prompt text safely', async () => {
    const saved: Buffer[] = [];
    const e = createDemoEngine((b) => {
      saved.push(b);
      return 'h1';
    });
    const res = await e.edit({ instruction: '<script>alert(1)</script> & more', sourceImage: '/nope.png', brand });
    expect(res.images).toEqual(['h1']);
    expect(saved).toHaveLength(1);
  });

  it('edit answers at the requested canvas, not a hardcoded square', async () => {
    // The server states the source's own pixels on a plain refine; a fixed
    // 1024x1024 answer made every demo edit of a non-square shot fail the
    // aspect check.
    const saved: Buffer[] = [];
    const e = createDemoEngine((b) => {
      saved.push(b);
      return 'h1';
    });
    await e.edit({ instruction: 'warmer', sourceImage: '/nope.png', brand, width: 96, height: 128 });
    // PNG IHDR: width and height are the first two big-endian words after byte 16.
    expect(saved[0].readUInt32BE(16)).toBe(96);
    expect(saved[0].readUInt32BE(20)).toBe(128);
  });

  it('falls back to neutral palette when brand has none', async () => {
    const e = createDemoEngine(() => 'h');
    const res = await e.generate({
      prompt: 'x',
      brand: { brand: {}, assetPaths: {} },
      width: 64,
      height: 64,
      count: 1,
    });
    expect(res.images).toHaveLength(1);
  });
});

describe('progressive delivery', () => {
  const saver = () => {
    let n = 0;
    return () => `hash-${++n}`;
  };
  const req = { prompt: 'hero', brand, width: 64, height: 64, count: 3 };

  it('reports each slot as its image lands, in request order', { timeout: 30_000 }, async () => {
    const e = createDemoEngine(saver());
    const landed: [number, string][] = [];
    const res = await e.generate(req, undefined, (slot, hash) => landed.push([slot, hash]));
    expect(landed).toEqual([
      [0, 'hash-1'],
      [1, 'hash-2'],
      [2, 'hash-3'],
    ]);
    expect(res.images).toEqual(['hash-1', 'hash-2', 'hash-3']);
  });

  it('lands the last slot first when asked to, one stagger apart', { timeout: 30_000 }, async () => {
    const e = createDemoEngine(saver(), { staggerMs: 20, order: 'reverse' });
    const landed: number[] = [];
    const t0 = Date.now();
    const res = await e.generate(req, undefined, (slot) => landed.push(slot));
    expect(landed).toEqual([2, 1, 0]);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(40);
    // the answer still reads by slot, whatever order the images arrived in
    expect(res.images).toHaveLength(3);
    expect((res.raw as any)?.variantIndexes ?? [0, 1, 2]).toEqual([0, 1, 2]);
  });

  it('reports a failing slot the way codex reports one', { timeout: 30_000 }, async () => {
    const e = createDemoEngine(saver(), { failSlot: 1 });
    const landed: number[] = [];
    const res = await e.generate(req, undefined, (slot) => landed.push(slot));
    expect(landed).toEqual([0, 2]);
    expect(res.images).toHaveLength(2);
    expect(res.raw).toMatchObject({ variantIndexes: [0, 2] });
    expect((res.raw as any).partialFailures).toHaveLength(1);
  });

  it('a cancel stops the run; a budget abort keeps what landed', { timeout: 30_000 }, async () => {
    const cancel = new AbortController();
    const e = createDemoEngine(saver(), { staggerMs: 40 });
    await expect(
      e.generate(req, cancel.signal, (slot) => {
        if (slot === 0) cancel.abort();
      }),
    ).rejects.toThrow();

    const budget = new AbortController();
    const e2 = createDemoEngine(saver(), { staggerMs: 40 });
    const res = await e2.generate(req, budget.signal, (slot) => {
      if (slot === 0) budget.abort(BUDGET_EXHAUSTED);
    });
    expect(res.images).toHaveLength(1);
    expect(res.raw).toMatchObject({ variantIndexes: [0] });
  });

  it('reads its knobs from the environment, and none by default', () => {
    expect(demoOptionsFromEnv({})).toEqual({});
    expect(
      demoOptionsFromEnv({ SCENRI_DEMO_STAGGER_MS: '1500', SCENRI_DEMO_ORDER: 'reverse', SCENRI_DEMO_FAIL_SLOT: '1' }),
    ).toEqual({ staggerMs: 1500, order: 'reverse', failSlot: 1 });
  });
});
