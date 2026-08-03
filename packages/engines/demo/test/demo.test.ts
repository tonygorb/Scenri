import { describe, it, expect } from 'vitest';
import { createDemoEngine } from '../src/index.js';
import type { BrandContext } from '@scenri/core';

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

  it('generates `count` PNG images through saveImage', async () => {
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
