import { describe, expect, it } from 'vitest';
import { defaultReshapeOp, reshapeOpFor } from '../src/composer/reshape.js';

describe('reshapeOpFor', () => {
  // This table is duplicated verbatim in packages/cli/test/reshapeRules.test.ts:
  // the composer's copy of the rule and the server's are pinned to one answer
  // table, so the hint can never promise an op the server will refuse.
  const table: Array<[string, number, number, 'extend' | 'crop']> = [
    ['square to landscape', 1, 16 / 9, 'extend'],
    ['square to story', 1, 9 / 16, 'extend'],
    ['square to portrait', 1, 4 / 5, 'extend'],
    ['portrait to landscape', 4 / 5, 16 / 9, 'extend'],
    ['portrait to story', 4 / 5, 9 / 16, 'extend'],
    ['landscape to square', 16 / 9, 1, 'crop'],
    ['landscape to portrait', 16 / 9, 4 / 5, 'crop'],
    ['story to portrait', 9 / 16, 4 / 5, 'crop'],
    ['landscape to story', 16 / 9, 9 / 16, 'crop'],
    ['story to landscape', 9 / 16, 16 / 9, 'crop'],
  ];
  for (const [name, src, target, want] of table) {
    it(`${name} is ${want}`, () => {
      expect(reshapeOpFor(src, target)).toBe(want);
    });
  }

  it('nonsense ratios stay the safe default', () => {
    expect(reshapeOpFor(0, 16 / 9)).toBe('extend');
    expect(reshapeOpFor(1, 0)).toBe('extend');
  });

  it('only the over-bound ties differ from the unbounded default', () => {
    // The bound changes exactly the two orientation flips; everything the
    // unbounded rule called crop stays crop, and every ordinary extend stays.
    expect(defaultReshapeOp(16 / 9, 9 / 16)).toBe('extend');
    expect(reshapeOpFor(16 / 9, 9 / 16)).toBe('crop');
    expect(defaultReshapeOp(1, 16 / 9)).toBe('extend');
    expect(reshapeOpFor(1, 16 / 9)).toBe('extend');
  });
});
