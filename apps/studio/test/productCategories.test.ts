import { describe, it, expect } from 'vitest';
import {
  categoryLabel,
  categoryOf,
  effectiveCategory,
  OTHER_CATEGORY,
  PRODUCT_CATEGORIES,
  suggestCategory,
} from '../src/productCategories.js';

describe('PRODUCT_CATEGORIES', () => {
  it('every category has a unique key and at least one reference angle', () => {
    const keys = PRODUCT_CATEGORIES.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const c of PRODUCT_CATEGORIES) expect(c.angles.length).toBeGreaterThan(0);
  });

  it('different categories carry different angle plans — a category system, not one list repeated', () => {
    const fragrance = PRODUCT_CATEGORIES.find((c) => c.key === 'fragrance')!;
    const footwear = PRODUCT_CATEGORIES.find((c) => c.key === 'footwear')!;
    const furniture = PRODUCT_CATEGORIES.find((c) => c.key === 'furniture')!;
    expect(fragrance.angles.map((a) => a.key)).not.toEqual(footwear.angles.map((a) => a.key));
    expect(footwear.angles.map((a) => a.key)).not.toEqual(furniture.angles.map((a) => a.key));
  });

  it('"other" is registered and reachable both as a fallback and as an ordinary lookup', () => {
    expect(OTHER_CATEGORY.key).toBe('other');
    expect(categoryOf('other')).toBe(OTHER_CATEGORY);
  });
});

describe('categoryOf', () => {
  it('resolves a known key to its category', () => {
    expect(categoryOf('footwear').label).toBe('Footwear');
  });

  it('falls back to Other for an unknown, null or undefined key', () => {
    expect(categoryOf('not-a-real-category')).toBe(OTHER_CATEGORY);
    expect(categoryOf(null)).toBe(OTHER_CATEGORY);
    expect(categoryOf(undefined)).toBe(OTHER_CATEGORY);
  });
});

describe('categoryLabel', () => {
  it('returns the human label for a known key', () => {
    expect(categoryLabel('beauty')).toBe('Beauty / skincare');
  });

  it('echoes back an unrecognized key rather than silently relabeling it as Other — a label is display only, never a silent recategorization', () => {
    expect(categoryLabel('mystery-key')).toBe('mystery-key');
  });

  it('is null for no category, not the word "Other" — an unset category and an explicit Other are different facts', () => {
    expect(categoryLabel(null)).toBeNull();
    expect(categoryLabel(undefined)).toBeNull();
  });
});

describe('suggestCategory', () => {
  it('matches on productType', () => {
    expect(suggestCategory('Eau de Parfum', [])).toBe('fragrance');
    expect(suggestCategory('Running Shoe', [])).toBe('footwear');
    expect(suggestCategory('Accent Chair', [])).toBe('furniture');
  });

  it('falls back to tags when productType does not match anything', () => {
    expect(suggestCategory(null, ['handbag', 'leather'])).toBe('accessories');
  });

  it('is case-insensitive', () => {
    expect(suggestCategory('PERFUME', [])).toBe('fragrance');
  });

  it('returns undefined — not "other" — when nothing matches, so a real guess is never confused with an unresolved one', () => {
    expect(suggestCategory('Miscellaneous Bundle', ['misc'])).toBeUndefined();
  });

  it('returns undefined for empty/missing input rather than matching on empty string', () => {
    expect(suggestCategory(null, null)).toBeUndefined();
    expect(suggestCategory('', [])).toBeUndefined();
  });

  it('every suggested key is a real PRODUCT_CATEGORIES key', () => {
    const keys = new Set(PRODUCT_CATEGORIES.map((c) => c.key));
    const samples = [
      suggestCategory('perfume', []),
      suggestCategory('sneaker', []),
      suggestCategory('dress', []),
      suggestCategory('chair', []),
      suggestCategory('serum', []),
      suggestCategory('headphones', []),
      suggestCategory('wallet', []),
      suggestCategory('soda', []),
      suggestCategory('necklace', []),
      suggestCategory('snack', []),
    ];
    for (const s of samples) {
      expect(s).toBeDefined();
      expect(keys.has(s!)).toBe(true);
    }
  });

  it('matches jewelry before accessories, since accessories no longer claims the "jewelry" keyword', () => {
    expect(suggestCategory('Sterling Silver Ring', [])).toBe('jewelry');
    expect(suggestCategory(null, ['jewelry', 'gift'])).toBe('jewelry');
  });

  it('matches food distinctly from beverage', () => {
    expect(suggestCategory('Trail Mix Snack', [])).toBe('food');
    expect(suggestCategory('Cold Brew Coffee', [])).toBe('beverage');
  });
});

describe('effectiveCategory', () => {
  it('uses the stored category when it is a real key', () => {
    expect(effectiveCategory({ category: 'footwear', productType: 'Perfume' })).toBe('footwear');
  });

  it('falls through to a suggestion when the stored category is stale/unrecognized, not a dead bucket', () => {
    expect(effectiveCategory({ category: 'sneakers-legacy', productType: 'Running Shoe' })).toBe('footwear');
  });

  it('falls through to a suggestion when nothing is stored', () => {
    expect(effectiveCategory({ category: null, productType: 'Eau de Parfum' })).toBe('fragrance');
  });

  it('is null when there is no stored category and nothing to suggest from', () => {
    expect(effectiveCategory({ category: null, productType: null, tags: [] })).toBeNull();
  });
});
