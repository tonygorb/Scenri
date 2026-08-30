import { describe, it, expect } from 'vitest';
import { variationPlan } from '../src/variationPlan.js';

const full = { hasPresenter: true, hasProduct: true, hasMark: true, cameraFixed: false };

describe('variationPlan', () => {
  it('leaves a single image alone', () => {
    // A Generate 1 has nothing to be consistent WITH, and every golden fixture
    // asserts its prompt byte for byte.
    expect(variationPlan(1, full)).toEqual([]);
    expect(variationPlan(0, full)).toEqual([]);
    expect(variationPlan(Number.NaN, full)).toEqual([]);
  });

  it('gives one clause per requested image', () => {
    expect(variationPlan(2, full)).toHaveLength(2);
    expect(variationPlan(4, full)).toHaveLength(4);
    expect(variationPlan(8, full)).toHaveLength(8);
  });

  it('never numbers a slot or names another slot', () => {
    // The counter is the bug. A rising take number reads as "go further" and
    // the drift grew with the output index.
    for (const clause of variationPlan(8, full)) {
      expect(clause).not.toMatch(/\btake \d/i);
      expect(clause).not.toMatch(/\bvariant \d/i);
      expect(clause).not.toMatch(/\b\d+ of \d+\b/);
      expect(clause).not.toMatch(/\bfirst\b|\bsecond\b|\bthird\b|\bfourth\b/i);
      expect(clause).not.toMatch(/\banother\b|\bthe other\b|\bprevious\b|\bdifferent from\b/i);
    }
  });

  it('locks the same things in every slot, word for word', () => {
    const plan = variationPlan(4, full);
    const locks = plan.map((c) => c.split('. ').slice(1).join('. '));
    expect(new Set(locks).size).toBe(1);
    for (const clause of plan) {
      expect(clause).toContain('the same wardrobe garment for garment');
      expect(clause).toContain('The person is the one in the character references and nobody else');
      expect(clause).toContain('The product is the one in the product references and no other');
      expect(clause).toContain('The brand mark stays exactly as drawn');
    }
  });

  it('reads the first slot as the brief as written, not as a departure', () => {
    const [first, ...rest] = variationPlan(4, full);
    expect(first).toContain('the straight read of the brief');
    for (const clause of rest) expect(clause).not.toContain('the straight read of the brief');
  });

  it('varies the photography and only the photography', () => {
    const moves = variationPlan(4, full).map((c) => c.split('. ')[0]);
    expect(new Set(moves).size).toBe(4);
  });

  it('locks nothing that is not attached', () => {
    // No presenter selected means no identity was chosen, so a generic figure
    // is free to vary. Enforcing sameness there would invent a lock the user
    // never asked for.
    const generic = variationPlan(3, { hasPresenter: false, hasProduct: false, hasMark: false, cameraFixed: false });
    for (const clause of generic) {
      expect(clause).not.toContain('The person is the one in the character references');
      expect(clause).not.toContain('The product is the one in the product references');
      expect(clause).not.toContain('brand mark');
      // The shoot itself still holds together.
      expect(clause).toContain('one continuous shoot');
    }
  });

  it('narrows to the brief when the brief already chose the camera', () => {
    const fixed = variationPlan(4, { ...full, cameraFixed: true });
    for (const clause of fixed.slice(1)) expect(clause).toContain('Keep the camera the direction asks for');
    expect(fixed[0]).toContain('the straight read of the brief');
    // and the open ladder does move the camera
    for (const clause of variationPlan(4, full).slice(1))
      expect(clause).not.toContain('Keep the camera the direction asks for');
  });

  it('is deterministic', () => {
    expect(variationPlan(4, full)).toEqual(variationPlan(4, full));
  });
});
