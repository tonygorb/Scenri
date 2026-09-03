import { describe, expect, it } from 'vitest';
import { TINT_CACHE_CAP, tintCacheSize, vibrantFromPixels, vibrantTintOf } from '../src/composer/sceneTint.js';

const field = (px: number[], count: number): number[] => Array.from({ length: count }, () => px).flat();

describe('vibrantFromPixels', () => {
  it('names a saturated field by its own colour', () => {
    const hex = vibrantFromPixels(field([200, 40, 40, 255], 64), 4);
    expect(hex).toBeTruthy();
    const [r, g, b] = [hex?.slice(1, 3), hex?.slice(3, 5), hex?.slice(5, 7)].map((c) => parseInt(c ?? '0', 16));
    expect(r).toBeGreaterThan(g);
    expect(r).toBeGreaterThan(b);
  });

  it('finds nothing in a grey picture: greys carry no mood', () => {
    expect(vibrantFromPixels(field([128, 128, 128, 255], 64), 4)).toBeNull();
  });

  it('ignores near-black, blown highlights and transparent pixels', () => {
    const px = [
      ...field([10, 10, 30, 255], 16), // near-black
      ...field([250, 250, 240, 255], 16), // blown out
      ...field([40, 160, 220, 10], 16), // transparent
    ];
    expect(vibrantFromPixels(px, 4)).toBeNull();
  });

  it('the loudest hue wins over a bigger but duller one', () => {
    const px = [
      ...field([120, 110, 100, 255], 40), // lots of dull tan (s < 0.18 mostly filters anyway)
      ...field([30, 140, 200, 255], 12), // a saturated teal-blue minority
    ];
    const hex = vibrantFromPixels(px, 4);
    expect(hex).toBeTruthy();
    const b = parseInt(hex?.slice(5, 7) ?? '0', 16);
    const r = parseInt(hex?.slice(1, 3) ?? '0', 16);
    expect(b).toBeGreaterThan(r);
  });
});

describe('vibrantTintOf', () => {
  it('remembers at most TINT_CACHE_CAP pictures, forgetting the oldest first', async () => {
    const urls = Array.from({ length: TINT_CACHE_CAP + 10 }, (_, i) => `/api/images/${String(i).padStart(32, '0')}`);
    for (const u of urls) void vibrantTintOf(u);
    expect(tintCacheSize()).toBe(TINT_CACHE_CAP);
    // the same url again is a hit, not a new entry
    void vibrantTintOf(urls[urls.length - 1]);
    expect(tintCacheSize()).toBe(TINT_CACHE_CAP);
    await Promise.all(urls.map((u) => vibrantTintOf(u).catch(() => null)));
  });
});
