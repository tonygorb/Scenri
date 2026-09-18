import { describe, expect, it } from 'vitest';
import { byName, findBrands } from '../src/layout/bar/brandMenuRules.js';

interface B {
  id: string;
  slug: string;
  name: string;
}
const b = (id: string, name: string, slug = id): B => ({ id, slug, name });
const name = (x: B) => x.name;
const ids = (xs: B[]) => xs.map((x) => x.id);

describe('byName', () => {
  it('orders by the name a person reads, ignoring case', () => {
    expect(ids(byName([b('v', 'vela'), b('a', 'Aurelia'), b('c', 'castro')], name))).toEqual(['a', 'c', 'v']);
  });

  it('lets the slug settle two brands that share a name', () => {
    const two = [b('2', 'Nike.com', 'nike-com-2'), b('1', 'Nike.com', 'nike-com')];
    expect(ids(byName(two, name))).toEqual(['1', '2']);
  });

  it('never reorders the list it was given', () => {
    const list = [b('v', 'Vela'), b('a', 'Aer')];
    byName(list, name);
    expect(ids(list)).toEqual(['v', 'a']);
  });
});

describe('findBrands', () => {
  const brands = [b('n', 'Nocturne', 'nocturne'), b('o', 'Olivar'), b('x', 'Aer', 'north-aer')];

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
