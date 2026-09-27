import { describe, expect, it } from 'vitest';
import { bayer, thresholdsFor } from '../src/layout/rendering/bayer.js';

/**
 * The swirl's screen is paper.design Dithering's (packages/shaders,
 * dithering.ts, 43cd68db). A slip in the recursion once clustered the order,
 * which drew every dot as a twin, so it is pinned value for value.
 */
const PAPER_4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const PAPER_8 = [
  0, 32, 8, 40, 2, 34, 10, 42, 48, 16, 56, 24, 50, 18, 58, 26, 12, 44, 4, 36, 14, 46, 6, 38, 60, 28, 52, 20, 62, 30, 54,
  22, 3, 35, 11, 43, 1, 33, 9, 41, 51, 19, 59, 27, 49, 17, 57, 25, 15, 47, 7, 39, 13, 45, 5, 37, 63, 31, 55, 23, 61, 29,
  53, 21,
];

describe("the swirl's screen", () => {
  it("is Bayer's, value for value with paper.design's", () => {
    expect(bayer(2)).toEqual([0, 2, 3, 1]);
    expect(bayer(4)).toEqual(PAPER_4);
    expect(bayer(8)).toEqual(PAPER_8);
  });

  it('tiles a box with every threshold once per 8x8, strictly inside 0..1', () => {
    const t = thresholdsFor(8, 16, 16);
    expect(t.every((v) => v > 0 && v < 1)).toBe(true);
    const tile = Array.from({ length: 64 }, (_, i) => t[Math.floor(i / 8) * 16 + (i % 8)]);
    expect(new Set(tile).size).toBe(64);
    // the next tile repeats it
    expect(t[8]).toBe(t[0]);
    expect(t[8 * 16]).toBe(t[0]);
  });
});
