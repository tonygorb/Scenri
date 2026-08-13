import { describe, it, expect } from 'vitest';
import { isRecommendedScene, isRecommendedPresenter } from '../src/compat.js';

describe('isRecommendedScene', () => {
  it("is recommended when the product category maps to one of the scene's verticals", () => {
    expect(isRecommendedScene({ verticals: ['Fragrance', 'Beauty'] }, 'fragrance')).toBe(true);
  });

  it('is not recommended when the mapped vertical is absent', () => {
    expect(isRecommendedScene({ verticals: ['Apparel'] }, 'fragrance')).toBe(false);
  });

  it('is never recommended with no product category — a hint requires a product, not a guess', () => {
    expect(isRecommendedScene({ verticals: ['Fragrance'] }, null)).toBe(false);
    expect(isRecommendedScene({ verticals: ['Fragrance'] }, undefined)).toBe(false);
  });

  it('"other" never matches any vertical — it has no real-world equivalent to alias to', () => {
    expect(isRecommendedScene({ verticals: ['Fragrance', 'Beauty', 'Apparel', 'Accessories'] }, 'other')).toBe(false);
  });

  it('a category with no vertical alias (none currently unmapped, but the guard itself) never false-positives', () => {
    expect(isRecommendedScene({ verticals: [] }, 'fragrance')).toBe(false);
  });

  it('a beverage product matches a scene spelled "Food & drink" — real scene data never says "Beverages"', () => {
    expect(isRecommendedScene({ verticals: ['Food & drink'] }, 'beverage')).toBe(true);
  });

  it('a food product also matches "Food & drink"', () => {
    expect(isRecommendedScene({ verticals: ['Food & drink'] }, 'food')).toBe(true);
  });

  it('a jewelry product matches a "Jewelry" scene', () => {
    expect(isRecommendedScene({ verticals: ['Jewelry'] }, 'jewelry')).toBe(true);
  });
});

describe('isRecommendedPresenter', () => {
  it("is recommended when the product category maps to one of the presenter's suitable categories", () => {
    expect(isRecommendedPresenter({ suitableCategories: ['Footwear', 'Sport'] }, 'footwear')).toBe(true);
  });

  it('is not recommended when the mapped category is absent', () => {
    expect(isRecommendedPresenter({ suitableCategories: ['Beauty'] }, 'footwear')).toBe(false);
  });

  it('is never recommended with no product category', () => {
    expect(isRecommendedPresenter({ suitableCategories: ['Beauty'] }, null)).toBe(false);
  });

  it('"other" never matches', () => {
    expect(isRecommendedPresenter({ suitableCategories: ['Beauty', 'Footwear'] }, 'other')).toBe(false);
  });

  it('an electronics product matches an "Electronics" presenter — the roster no longer says "Technology"', () => {
    expect(isRecommendedPresenter({ suitableCategories: ['Electronics'] }, 'electronics')).toBe(true);
    expect(isRecommendedPresenter({ suitableCategories: ['Technology'] }, 'electronics')).toBe(false);
  });

  it('a footwear product also matches an "Apparel"-suitable presenter', () => {
    expect(isRecommendedPresenter({ suitableCategories: ['Apparel'] }, 'footwear')).toBe(true);
  });

  it('a beverage product matches a presenter suitable for "Food & drink"', () => {
    expect(isRecommendedPresenter({ suitableCategories: ['Food & drink'] }, 'beverage')).toBe(true);
  });
});
