import { describe, it, expect } from 'vitest';
import { marksOf, attachableMarks, markLabel, primaryOf, primaryMark } from '../src/brand/marks.js';

const HASH_A = 'a'.repeat(32);
const HASH_B = 'b'.repeat(32);

const kit = {
  meta: { name: 'Acme Coffee' },
  logos: [
    { role: 'primary', file: `asset:${HASH_A}`, background: 'light' },
    { role: 'wordmark', file: `asset:${HASH_B}` },
    { role: 'mark', file: 'https://cdn.acme.coffee/mark.svg' },
  ],
};

describe('marksOf', () => {
  it('keeps stored order and fills the defaults the schema leaves optional', () => {
    expect(marksOf(kit)).toEqual([
      { hash: HASH_A, file: `asset:${HASH_A}`, role: 'primary', background: 'light', attachable: true },
      { hash: HASH_B, file: `asset:${HASH_B}`, role: 'wordmark', background: 'any', attachable: true },
      { hash: null, file: 'https://cdn.acme.coffee/mark.svg', role: 'mark', background: 'any', attachable: false },
    ]);
  });

  it('shows a mark with an unknown role rather than hiding it', () => {
    const [m] = marksOf({ logos: [{ role: 'favicon', file: `asset:${HASH_A}` }] });
    expect(m.role).toBe('primary');
  });

  it('ignores entries with no file, and a brand with no logos at all', () => {
    expect(marksOf({ logos: [{ role: 'primary' }, { role: 'mark', file: '  ' }] })).toEqual([]);
    expect(marksOf({})).toEqual([]);
    expect(marksOf(undefined)).toEqual([]);
  });

  it('carries clearSpace only when there is one', () => {
    const [m] = marksOf({ logos: [{ role: 'primary', file: `asset:${HASH_A}`, clearSpace: '1x logo height' }] });
    expect(m.clearSpace).toBe('1x logo height');
    expect(marksOf(kit)[0].clearSpace).toBeUndefined();
  });
});

describe('attachableMarks', () => {
  // The compiler resolves an attachment through the content-addressed store, so
  // a perfectly valid https logo is displayable and unusable at the same time.
  it('offers only marks this app actually stored', () => {
    expect(attachableMarks(kit).map((m) => m.hash)).toEqual([HASH_A, HASH_B]);
  });
  it('rejects an asset ref that is not a real hash', () => {
    expect(attachableMarks({ logos: [{ role: 'primary', file: 'asset:nope' }] })).toEqual([]);
  });
});

describe('markLabel', () => {
  it('names the mark the way the compiled prompt names it', () => {
    expect(markLabel(kit, { role: 'wordmark' })).toBe('Acme Coffee wordmark');
    expect(markLabel(kit, { role: 'primary' })).toBe('Acme Coffee logo');
    expect(markLabel(kit, { role: 'monochrome' })).toBe('Acme Coffee monochrome logo');
  });
  it('falls back when the brand has no name yet', () => {
    expect(markLabel({}, { role: 'mark' })).toBe('Brand mark');
  });
});

// Every surface that asks "which is THE logo" resolves it here, so the nav
// avatar, the setup confirmation and Settings can never disagree again.
describe('primaryOf / primaryMark', () => {
  it('the primary tag wins over stored order', () => {
    const tagged = {
      meta: { name: 'Acme Coffee' },
      logos: [
        { role: 'wordmark', file: `asset:${HASH_B}` },
        { role: 'primary', file: `asset:${HASH_A}` },
      ],
    };
    expect(primaryMark(tagged)?.hash).toBe(HASH_A);
  });
  it('falls back to the first mark when nothing is tagged primary', () => {
    const untagged = { logos: [{ role: 'wordmark', file: `asset:${HASH_B}` }] };
    expect(primaryMark(untagged)?.hash).toBe(HASH_B);
  });
  it('is null on an empty kit', () => {
    expect(primaryMark({})).toBeNull();
    expect(primaryOf([])).toBeNull();
  });
  it('returns a non-attachable https primary, which is displayable', () => {
    const scraped = { logos: [{ role: 'primary', file: 'https://cdn.acme.coffee/mark.svg' }] };
    const m = primaryMark(scraped);
    expect(m?.file).toBe('https://cdn.acme.coffee/mark.svg');
    expect(m?.attachable).toBe(false);
  });
  it('returns the same object marksOf produced, so identity filters keep working', () => {
    const marks = marksOf(kit);
    expect(primaryOf(marks)).toBe(marks[0]);
  });
});
