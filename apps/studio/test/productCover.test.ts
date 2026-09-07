import { describe, expect, it } from 'vitest';
import { coverOf, productCoverUrl } from '../src/productCover.js';

/**
 * The one answer to "which picture stands for this product", for every card,
 * chip, tile and picker. A product's cover is display media: a real photograph
 * chosen by rule, or the one the user picked. Never a drawn view, never a
 * generation of its own, and never read by the compiler.
 */
const H = (c: string) => `asset:${c.repeat(32)}`;

describe('coverOf', () => {
  it('honours a cover the user chose', () => {
    expect(coverOf({ cover: H('c'), shots: [{ file: H('a'), angle: 'three-quarter' }] })).toBe(H('c'));
  });

  it('prefers the three-quarter photograph, then the front, then the first photograph', () => {
    expect(
      coverOf({
        shots: [
          { file: H('a'), angle: 'front' },
          { file: H('b'), angle: 'three-quarter' },
        ],
      }),
    ).toBe(H('b'));
    expect(
      coverOf({
        shots: [
          { file: H('a'), angle: 'side' },
          { file: H('b'), angle: 'front' },
        ],
      }),
    ).toBe(H('b'));
    expect(coverOf({ shots: [{ file: H('a'), angle: 'label' }, { file: H('b') }] })).toBe(H('a'));
  });

  it('never stands a drawn view in for the product while a photograph exists', () => {
    expect(
      coverOf({
        shots: [
          { file: H('a'), angle: 'three-quarter', source: 'derived' },
          { file: H('b'), angle: 'side' },
        ],
      }),
    ).toBe(H('b'));
  });

  it('falls back to the first reference of any kind, and to nothing at all', () => {
    expect(coverOf({ shots: [{ file: H('a'), source: 'derived' }] })).toBe(H('a'));
    expect(coverOf({ shots: [] })).toBeNull();
    expect(coverOf({})).toBeNull();
  });
});

describe('productCoverUrl', () => {
  it('serves the cover at a derivative width, never the original', () => {
    const p = { shots: [{ file: H('b'), angle: 'three-quarter' }] };
    expect(productCoverUrl(p, 'tile')).toBe(`/api/images/${'b'.repeat(32)}/thumb?w=640`);
    expect(productCoverUrl(p, 'micro')).toBe(`/api/images/${'b'.repeat(32)}/thumb?w=160`);
    expect(productCoverUrl({ shots: [] }, 'tile')).toBeNull();
  });
});
