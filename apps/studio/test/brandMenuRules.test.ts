import { describe, expect, it } from 'vitest';
import { byName, findBrands, recentOthers } from '../src/layout/bar/brandMenuRules.js';

interface B {
  id: string;
  slug: string;
  name: string;
  updatedAt: string;
}
const b = (id: string, name: string, updatedAt = '2026-09-01T00:00:00Z', slug = id): B => ({
  id,
  slug,
  name,
  updatedAt,
});
const name = (x: B) => x.name;
const ids = (xs: B[]) => xs.map((x) => x.id);

describe('byName', () => {
  it('orders by the name a person reads, ignoring case', () => {
    expect(ids(byName([b('v', 'vela'), b('a', 'Aurelia'), b('c', 'castro')], name))).toEqual(['a', 'c', 'v']);
  });

  it('lets the slug settle two brands that share a name', () => {
    const two = [b('2', 'Nike.com', undefined, 'nike-com-2'), b('1', 'Nike.com', undefined, 'nike-com')];
    expect(ids(byName(two, name))).toEqual(['1', '2']);
  });

  it('never reorders the list it was given', () => {
    const list = [b('v', 'Vela'), b('a', 'Aer')];
    byName(list, name);
    expect(ids(list)).toEqual(['v', 'a']);
  });
});

describe('recentOthers', () => {
  const brands = [
    b('cur', 'Current', '2026-09-18T00:00:00Z'),
    b('a', 'Aer', '2026-09-01T00:00:00Z'),
    b('b', 'Bucherer', '2026-09-10T00:00:00Z'),
    b('c', 'Castro', '2026-09-05T00:00:00Z'),
    b('d', 'Halde', '2026-09-12T00:00:00Z'),
    b('e', 'Vela', '2026-09-03T00:00:00Z'),
  ];

  it('leads with what this browser opened last, never the brand you are in', () => {
    expect(ids(recentOthers(brands, ['cur', 'c', 'e', 'a', 'b'], 'cur'))).toEqual(['c', 'e', 'a', 'b']);
  });

  it('fills from the most recently edited while there is no history yet', () => {
    expect(ids(recentOthers(brands, [], 'cur'))).toEqual(['d', 'b', 'c', 'e']);
    expect(ids(recentOthers(brands, ['a'], 'cur'))).toEqual(['a', 'd', 'b', 'c']);
  });

  it('skips a remembered id whose brand is gone', () => {
    expect(ids(recentOthers(brands, ['gone', 'e'], 'cur', 2))).toEqual(['e', 'd']);
  });

  it('holds no more than it was asked for, and fewer when there are fewer', () => {
    expect(recentOthers(brands, [], 'cur', 2)).toHaveLength(2);
    expect(ids(recentOthers([b('cur', 'Current'), b('a', 'Aer')], [], 'cur'))).toEqual(['a']);
  });
});

describe('findBrands', () => {
  const brands = [b('n', 'Nocturne', undefined, 'nocturne'), b('o', 'Olivar'), b('x', 'Aer', undefined, 'north-aer')];

  it('matches the name or the slug, and lists the hits A to Z', () => {
    expect(ids(findBrands(brands, 'no', name))).toEqual(['x', 'n']);
    expect(ids(findBrands(brands, '  OLI ', name))).toEqual(['o']);
  });

  it('holds every brand, A to Z, for an empty query', () => {
    expect(ids(findBrands(brands, '', name))).toEqual(['x', 'n', 'o']);
  });

  it('holds nothing when nothing matches', () => {
    expect(findBrands(brands, 'zz', name)).toEqual([]);
  });
});
