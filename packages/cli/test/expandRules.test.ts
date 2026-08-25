import { describe, it, expect } from 'vitest';
import { planExpand, expandInstruction } from '../src/expandRules.js';

const SQUARE = { width: 1024, height: 1024 };

describe('planning an expansion', () => {
  // The guarantee rests on this: the source is surrounded, never scaled, so
  // every one of its pixels survives at its own resolution.
  it('keeps every row when the frame grows wider', () => {
    const plan = planExpand(SQUARE, 16 / 9)!;
    expect(plan.axis).toBe('width');
    expect(plan.height).toBe(1024);
    expect(plan.width).toBeGreaterThan(1024);
    expect(plan.width / plan.height).toBeCloseTo(16 / 9, 2);
    // centred, so the picture does not lurch sideways when its frame grows
    expect(plan.left).toBe(Math.round((plan.width - 1024) / 2));
    expect(plan.top).toBe(0);
  });

  it('keeps every column when the frame grows taller', () => {
    const plan = planExpand(SQUARE, 9 / 16)!;
    expect(plan.axis).toBe('height');
    expect(plan.width).toBe(1024);
    expect(plan.height).toBeGreaterThan(1024);
    expect(plan.width / plan.height).toBeCloseTo(9 / 16, 2);
    expect(plan.left).toBe(0);
    expect(plan.top).toBe(Math.round((plan.height - 1024) / 2));
  });

  it('leaves the source room to sit at its own size, exactly', () => {
    for (const ratio of [16 / 9, 9 / 16, 4 / 5, 5 / 4]) {
      const plan = planExpand(SQUARE, ratio);
      if (!plan) continue;
      expect(plan.width).toBeGreaterThanOrEqual(SQUARE.width);
      expect(plan.height).toBeGreaterThanOrEqual(SQUARE.height);
      expect(plan.left + SQUARE.width).toBeLessThanOrEqual(plan.width);
      expect(plan.top + SQUARE.height).toBeLessThanOrEqual(plan.height);
    }
  });

  it('does nothing when the shape already matches', () => {
    expect(planExpand(SQUARE, 1)).toBeNull();
    expect(planExpand({ width: 1024, height: 576 }, 16 / 9)).toBeNull();
  });

  // Any ratio is reachable by growing one axis, so THIS op never costs a
  // pixel: a 16:9 asked for as a square grows taller rather than losing its
  // sides. Cutting down to the shape instead is the other op — cropRules.ts —
  // and the caller chooses between them explicitly.
  it('reaches any shape by growing; cutting down is cropRules, not this op', () => {
    const wide = planExpand({ width: 1820, height: 1024 }, 1)!;
    expect(wide.axis).toBe('height');
    expect(wide.width).toBe(1820);
    expect(wide.height).toBeGreaterThan(1024);

    const tall = planExpand({ width: 1024, height: 1820 }, 1)!;
    expect(tall.axis).toBe('width');
    expect(tall.height).toBe(1820);
    expect(tall.width).toBeGreaterThan(1024);
  });

  it('refuses nonsense rather than guessing', () => {
    expect(planExpand({ width: 0, height: 1024 }, 1.5)).toBeNull();
    expect(planExpand(SQUARE, 0)).toBeNull();
  });

  it('lands on a multiple of eight, like every other frame in the product', () => {
    for (const ratio of [16 / 9, 9 / 16, 4 / 5, 3 / 2]) {
      const plan = planExpand(SQUARE, ratio);
      if (!plan) continue;
      expect(plan.width % 8).toBe(0);
      expect(plan.height % 8).toBe(0);
    }
  });
});

describe('what the engine is asked for', () => {
  it('describes the margin, and forbids touching the picture', () => {
    const plan = planExpand(SQUARE, 16 / 9)!;
    const text = expandInstruction(plan, '');
    expect(text).toContain('to the left and right');
    expect(text).toContain('Do not change, move, rescale or reinterpret anything already in the picture');
    expect(text).toContain('do not add a subject, a product or a person');
  });

  it('names the other axis when the frame grows the other way', () => {
    const plan = planExpand(SQUARE, 9 / 16)!;
    expect(expandInstruction(plan, '')).toContain('above and below');
  });

  it('carries the user own words when they gave any', () => {
    const plan = planExpand(SQUARE, 16 / 9)!;
    expect(expandInstruction(plan, 'more of the same stone ledge')).toContain('more of the same stone ledge');
  });
});
