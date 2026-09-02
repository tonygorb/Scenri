import { describe, expect, it } from 'vitest';
import { fitCount } from '../src/composer/sourceFit.js';

describe('fitCount', () => {
  it('shows the whole row when it fits, chip or no chip', () => {
    expect(fitCount([60, 60, 60], 4, 40, 200)).toBe(3);
  });
  it('reserves the chip as soon as anything is left over', () => {
    // 60+4+60 = 124, +4+40 chip = 168 fits; a third card would need 232
    expect(fitCount([60, 60, 60, 60], 4, 40, 200)).toBe(2);
  });
  it('a leftover of one still needs the chip when the card itself does not fit', () => {
    expect(fitCount([90, 90, 90], 4, 40, 200)).toBe(1);
  });
  it('shows nothing but the chip when not even one card fits beside it', () => {
    expect(fitCount([180, 180], 4, 40, 200)).toBe(0);
  });
  it('an empty row fits trivially', () => {
    expect(fitCount([], 4, 40, 200)).toBe(0);
  });
});
