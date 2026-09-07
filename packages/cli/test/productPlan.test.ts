import { describe, expect, it } from 'vitest';
import { DERIVABLE_ANGLES, plannedViews } from '../src/productPlan.js';

/**
 * Which views Scenri offers to draw for a product, from what its photographs
 * already show. Small on purpose: the category's own angle list, minus what
 * the photographs cover, kept to the angles a rotation of the visible object
 * can honestly supply, and capped so photographs plus drawn views never exceed
 * what a brief attaches.
 */
describe('plannedViews', () => {
  it('offers the angles a category asks for that no photograph covers', () => {
    expect(plannedViews('fragrance', ['three-quarter'])).toEqual(['front', 'side']);
    expect(plannedViews('beauty', ['front'])).toEqual(['three-quarter']);
  });

  it('offers nothing when the photographs already cover the plan', () => {
    expect(plannedViews('fragrance', ['front', 'side', 'three-quarter'])).toEqual([]);
  });

  it('never plans a face the photographs cannot vouch for: no back, label or detail', () => {
    expect(plannedViews('electronics', ['front'])).toEqual(['three-quarter']);
    expect(plannedViews('apparel', ['front'])).toEqual([]);
    expect(plannedViews('beauty', ['three-quarter', 'front'])).toEqual([]);
    for (const angle of ['back', 'label', 'detail', 'detail-fabric', 'clasp-detail', 'packaging-label']) {
      expect(DERIVABLE_ANGLES).not.toContain(angle);
    }
  });

  it('caps drawn views so photographs plus drawn views stay within what a brief attaches', () => {
    // one unlabelled photograph covers nothing known: two of the three views are offered
    expect(plannedViews('footwear', ['other'])).toEqual(['three-quarter', 'lateral-side']);
    // two photographs leave room for exactly one drawn view
    expect(plannedViews('fragrance', ['other', 'other'])).toEqual(['three-quarter']);
    // three photographs leave no room at all, whatever they show
    expect(plannedViews('fragrance', ['other', 'other', 'other'])).toEqual([]);
  });

  it('reads an unknown or missing category as other, and a missing label as other', () => {
    expect(plannedViews('gadgets', ['front'])).toEqual(['three-quarter', 'side']);
    expect(plannedViews(null, [null])).toEqual(['three-quarter', 'front']);
  });
});
