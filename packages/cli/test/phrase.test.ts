import { describe, expect, it } from 'vitest';
import { phrase, str } from '../src/assetRecords.js';

describe('phrase', () => {
  it('leaves anything inside the budget alone', () => {
    expect(phrase('rich auburn, shoulder length', 120)).toBe('rich auburn, shoulder length');
  });

  it('stops at the last whole sentence rather than mid-clause', () => {
    // The real record: `str` stored "...loose ringlets. Worn with".
    const said =
      'Copper-red hair with golden ginger highlights, short to medium in length, densely curled into loose ringlets. Worn with a centre part and volume at the crown.';
    // `str` gave 120 characters ending in a trailing space, and the trim on
    // the way out left the 119-character record seen in the library.
    expect(str(said, 120)).toMatch(/Worn with $/);
    expect(phrase(said, 120)).toBe(
      'Copper-red hair with golden ginger highlights, short to medium in length, densely curled into loose ringlets.',
    );
  });

  it('stops at the last whole word when no sentence ends in range', () => {
    const said =
      'Short sandy blond hair with darker roots and lighter golden strands; softly wavy, thick and textured, worn loosely tousled across the forehead';
    expect(str(said, 120)).toMatch(/tousl$/);
    const out = phrase(said, 120);
    expect(out).toBe(
      'Short sandy blond hair with darker roots and lighter golden strands; softly wavy, thick and textured, worn loosely',
    );
    expect(out.length).toBeLessThanOrEqual(120);
  });

  it('does not hand most of the budget back for one very long word', () => {
    const said = `Blonde. ${'x'.repeat(200)}`;
    expect(phrase(said, 120)).toHaveLength(120);
  });

  it('leaves no punctuation dangling at the new end', () => {
    const said = `${'a'.repeat(100)} tousled, ${'b'.repeat(60)}`;
    expect(phrase(said, 120)).toMatch(/tousled$/);
  });

  it('takes nothing and empty things in its stride', () => {
    expect(phrase(undefined, 120)).toBe('');
    expect(phrase('   ', 120)).toBe('');
    expect(phrase('supercalifragilistic', 5)).toBe('super');
  });
});
