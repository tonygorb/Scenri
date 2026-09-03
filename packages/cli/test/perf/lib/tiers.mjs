/**
 * The four fixture tiers, as data.
 *
 * Counts come from the data model and the real library on 2026-09-03 (3 brands,
 * 487 nodes, 785 images), not from round numbers: SMALL mirrors it, MEDIUM is a
 * heavy active user, LARGE a studio with a 600-product store import (a 576-product
 * brand is a real report), STRESS the stated ceiling of 50 workspaces and 100k
 * shots. Ratios (edits, keepers, archived, errors, recorded sizes) are the real
 * library's own.
 */
export const FIXTURE_VERSION = 1;
export const POOL_VERSION = 1;

export const RATIOS = { edit: 0.24, kept: 0.065, archived: 0.023, error: 0.015, rendered: 0.55 };

export const TIERS = {
  small: { brands: [480, 15, 1], sets: 15, memberships: 600, catalog: null, presenters: 4, scenes: 3, maxEditDepth: 4 },
  medium: {
    brands: [2000, 800, 300, 100, 20],
    sets: 40,
    memberships: 1600,
    catalog: { brand: 0, products: 150 },
    presenters: 10,
    scenes: 10,
    maxEditDepth: 4,
  },
  large: {
    brands: [6000, 2500, 1000, 500, 500, 500, 100, 100, 100, 100, 100, 100],
    sets: 80,
    memberships: 3200,
    catalog: { brand: 0, products: 600 },
    presenters: 30,
    scenes: 30,
    maxEditDepth: 4,
  },
  stress: {
    brands: [
      25000,
      10000,
      ...Array(4).fill(5000),
      ...Array(10).fill(2000),
      ...Array(20).fill(1000),
      ...Array(14).fill(500),
    ],
    sets: 200,
    memberships: 8000,
    catalog: { brand: 0, products: 2000 },
    presenters: 60,
    scenes: 60,
    maxEditDepth: 8,
  },
};

/** Manual products on the biggest brand of every tier (the real library holds 12). */
export const BIG_BRAND_PRODUCTS = 12;

export const TIER_NAMES = Object.keys(TIERS);

export function totalNodes(tier) {
  return TIERS[tier].brands.reduce((a, b) => a + b, 0);
}
