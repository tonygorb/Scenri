import { describe, it, expect } from 'vitest';
import { planCrop, defaultReshapeOp } from '../src/cropRules.js';

describe('planning a crop', () => {
  it('cuts the sides evenly for a narrower shape, keeping every row', () => {
    const plan = planCrop({ width: 1600, height: 900 }, 1)!;
    expect(plan).toEqual({ left: 350, top: 0, width: 900, height: 900, axis: 'width' });
  });

  it('cuts top and bottom evenly for a shorter shape, keeping every column', () => {
    const plan = planCrop({ width: 1024, height: 1280 }, 16 / 9)!;
    expect(plan.axis).toBe('height');
    expect(plan.width).toBe(1024);
    expect(plan.height).toBe(576);
    expect(plan.left).toBe(0);
    expect(plan.top).toBe(352);
    expect(plan.width / plan.height).toBeCloseTo(16 / 9, 2);
  });

  it('handles odd dimensions exactly, without rounding conventions', () => {
    const plan = planCrop({ width: 1023, height: 767 }, 1)!;
    expect(plan).toEqual({ left: 128, top: 0, width: 767, height: 767, axis: 'width' });
    // the region never exceeds the source
    expect(plan.left + plan.width).toBeLessThanOrEqual(1023);
  });

  it('is a no-op within one percent of the shape it already has', () => {
    expect(planCrop({ width: 1024, height: 1024 }, 1)).toBeNull();
    expect(planCrop({ width: 1024, height: 1024 }, 1.009)).toBeNull();
    expect(planCrop({ width: 1024, height: 1024 }, 1.02)).not.toBeNull();
  });

  it('refuses nonsense rather than planning from it', () => {
    expect(planCrop({ width: 0, height: 100 }, 1)).toBeNull();
    expect(planCrop({ width: 100, height: 100 }, 0)).toBeNull();
    expect(planCrop({ width: 100, height: 100 }, Number.NaN)).toBeNull();
  });

  it('reaches an extreme shape by cutting one axis, never both', () => {
    const plan = planCrop({ width: 4000, height: 500 }, 9 / 16)!;
    expect(plan.height).toBe(500);
    expect(plan.width).toBe(281);
    expect(plan.top).toBe(0);
  });
});

describe('the default reshape op', () => {
  it('extends toward a more directional shape', () => {
    expect(defaultReshapeOp(1, 16 / 9)).toBe('extend');
    expect(defaultReshapeOp(1, 9 / 16)).toBe('extend');
    expect(defaultReshapeOp(4 / 5, 16 / 9)).toBe('extend');
  });

  it('crops toward a squarer shape', () => {
    expect(defaultReshapeOp(16 / 9, 1)).toBe('crop');
    expect(defaultReshapeOp(9 / 16, 4 / 5)).toBe('crop');
  });

  it('the equally-directional tie defaults to extend, the pixel-keeping op', () => {
    expect(defaultReshapeOp(16 / 9, 9 / 16)).toBe('extend');
  });
});
