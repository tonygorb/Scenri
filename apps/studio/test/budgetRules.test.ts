import { describe, expect, it } from 'vitest';
import { readCap } from '../src/views/settings/budgetRules.js';

describe('readCap', () => {
  it('reads dollars the way people type them', () => {
    expect(readCap('20')).toBe(20);
    expect(readCap('$20')).toBe(20);
    expect(readCap('$ 20')).toBe(20);
    expect(readCap(' 20$ ')).toBe(20);
    expect(readCap('12.50')).toBe(12.5);
    expect(readCap('.5')).toBe(0.5);
    expect(readCap('0')).toBe(0);
    expect(readCap('1,000')).toBe(1000);
    expect(readCap('$1,250.75')).toBe(1250.75);
  });

  it('reads an empty field as no cap', () => {
    expect(readCap('')).toBeNull();
    expect(readCap('   ')).toBeNull();
  });

  it('refuses what is not an amount rather than guessing', () => {
    for (const raw of ['twenty', '20,50', '-5', '1e3', '20 dollars', '$', '1,00', '12.5.1']) {
      expect(readCap(raw), raw).toBeUndefined();
    }
  });
});
