import { describe, it, expect } from 'vitest';
import { matchesQuery, facetMode, pageSlice } from '../src/layout/library/libraryRules.js';

describe('matchesQuery', () => {
  it('matches a single term as a case-insensitive substring', () => {
    expect(matchesQuery('Marble Quarry Plinth', 'quarry')).toBe(true);
    expect(matchesQuery('Marble Quarry Plinth', 'QUARRY')).toBe(true);
    expect(matchesQuery('Marble Quarry Plinth', 'canyon')).toBe(false);
  });

  it('requires every whitespace-separated term to match — AND, not OR', () => {
    expect(matchesQuery('Cool minimal white-blonde pixie', 'cool pixie')).toBe(true);
    expect(matchesQuery('Cool minimal white-blonde pixie', 'cool canyon')).toBe(false);
  });

  it('an empty or whitespace-only query matches everything', () => {
    expect(matchesQuery('anything', '')).toBe(true);
    expect(matchesQuery('anything', '   ')).toBe(true);
  });

  it('collapses repeated whitespace between terms', () => {
    expect(matchesQuery('Marble Quarry Plinth', 'marble   plinth')).toBe(true);
  });

  it('ignores accents on either side — a keyboard without an accent key still finds the record', () => {
    expect(matchesQuery('Rose Quartz Plinth', 'rosé')).toBe(true);
    expect(matchesQuery('Rosé Bottle Still', 'rose')).toBe(true);
    expect(matchesQuery('Café Terrace Morning', 'cafe terrace')).toBe(true);
    expect(matchesQuery('Cafe Terrace Morning', 'café')).toBe(true);
  });

  it('matches a plural query against a singular catalog entry', () => {
    expect(matchesQuery('Renewal Serum 30ml', 'serums')).toBe(true);
    expect(matchesQuery('Amber Candle', 'candles')).toBe(true);
  });

  it('needs no stemming for the other direction — substring already covers it', () => {
    expect(matchesQuery('Renewal Serums', 'serum')).toBe(true);
  });

  it('will not stem a short term into a substring of everything', () => {
    // 's'.slice(0, -1) is '', which is inside every haystack there is.
    expect(matchesQuery('Marble Quarry Plinth', 'zs')).toBe(false);
    expect(matchesQuery('Marble Quarry Plinth', 'xs')).toBe(false);
    // …but a real four-letter plural still stems.
    expect(matchesQuery('Aluminium Can Chill', 'cans')).toBe(true);
  });

  it('still requires every term when one of them is stemmed', () => {
    expect(matchesQuery('Renewal Serum 30ml', 'serums canyon')).toBe(false);
  });
});

describe('facetMode', () => {
  it('is "none" below two distinct values — a single tab is not a filter', () => {
    expect(facetMode(0)).toBe('none');
    expect(facetMode(1)).toBe('none');
  });

  it("is \"tabs\" from two values up, any count — Scenes' 10 verticals, Presenters' 16 categories, Products' sparse 2", () => {
    expect(facetMode(2)).toBe('tabs');
    expect(facetMode(10)).toBe('tabs');
    expect(facetMode(16)).toBe('tabs');
  });
});

describe('pageSlice', () => {
  const items = Array.from({ length: 130 }, (_, i) => i);

  it('returns the first N items and how many remain', () => {
    const { visible, remaining } = pageSlice(items, 60);
    expect(visible).toHaveLength(60);
    expect(visible[0]).toBe(0);
    expect(visible[59]).toBe(59);
    expect(remaining).toBe(70);
  });

  it('remaining is never negative when shown exceeds the item count', () => {
    const { visible, remaining } = pageSlice(items, 1000);
    expect(visible).toHaveLength(130);
    expect(remaining).toBe(0);
  });
});
