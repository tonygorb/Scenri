import { beforeEach, describe, expect, it } from 'vitest';
import { forgetAll, recall, remember } from '../src/layout/scrollOffsets.js';

describe('scroll offsets', () => {
  beforeEach(() => forgetAll());

  it('gives back where a pane stood', () => {
    remember('k1', 420);
    expect(recall('k1')).toBe(420);
  });

  it('does not throw when a pane is saved many times, as a scroll listener saves it', () => {
    // The regression: `remember` called itself instead of writing to the Map,
    // so one scroll event was a RangeError and nothing was ever recorded.
    for (let i = 0; i < 500; i++) remember('k1', i);
    expect(recall('k1')).toBe(499);
  });

  it('knows nothing about a place never visited', () => {
    expect(recall('nowhere')).toBeUndefined();
  });

  it('keeps the fifty most recent places and lets the oldest go', () => {
    for (let i = 0; i < 60; i++) remember(`k${i}`, i);
    expect(recall('k9')).toBeUndefined();
    expect(recall('k10')).toBe(10);
    expect(recall('k59')).toBe(59);
  });

  it('counts a place seen again as the most recent, so it is not the first let go', () => {
    for (let i = 0; i < 50; i++) remember(`k${i}`, i);
    remember('k0', 999);
    remember('fresh', 1);
    expect(recall('k0')).toBe(999);
    expect(recall('k1')).toBeUndefined();
  });
});
