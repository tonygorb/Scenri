import { describe, expect, it } from 'vitest';
import { findIngredient } from '../src/composer/ingredientOptions.js';

const src = {
  products: [{ id: 'p1', name: 'Own Serum' }],
  demoProducts: [
    { id: 'p1', name: 'Demo Serum' },
    { id: 'd2', name: 'Demo Only' },
  ] as never,
  cast: [{ id: 'c1', name: 'Own Cast' }],
  presenters: [
    { id: 'c1', name: 'Stock Twin' },
    { id: 'astrid', name: 'Astrid' },
  ] as never,
  scenes: [
    { id: 's1', name: 'Own Scene', custom: true },
    { id: 's1', name: 'Catalog Scene' },
    { id: 's2', name: 'Catalog' },
  ] as never,
};

// One rule, every surface: the brand's own record beats the shipped one of
// the same id, and what does not exist resolves to nulls, never to a guess.
describe('findIngredient', () => {
  it('own before shipped, for each kind', () => {
    expect(findIngredient({ t: 'product', id: 'p1' }, src)).toMatchObject({
      kind: 'product',
      product: { name: 'Own Serum' },
      demo: null,
    });
    expect(findIngredient({ t: 'product', id: 'd2' }, src)).toMatchObject({
      kind: 'product',
      product: null,
      demo: { name: 'Demo Only' },
    });
    expect(findIngredient({ t: 'character', id: 'c1' }, src)).toMatchObject({
      kind: 'presenter',
      character: { name: 'Own Cast' },
      presenter: null,
    });
    expect(findIngredient({ t: 'character', id: 'astrid' }, src)).toMatchObject({
      kind: 'presenter',
      character: null,
      presenter: { name: 'Astrid' },
    });
    expect(findIngredient({ t: 'template', id: 's1' }, src)).toMatchObject({
      kind: 'scene',
      scene: { name: 'Own Scene' },
      custom: true,
    });
    expect(findIngredient({ t: 'template', id: 's2' }, src)).toMatchObject({
      kind: 'scene',
      scene: { name: 'Catalog' },
      custom: false,
    });
  });
  it('resolves a thing that is gone to nulls, and a non-ingredient to nothing', () => {
    expect(findIngredient({ t: 'product', id: 'nope' }, src)).toEqual({ kind: 'product', product: null, demo: null });
    expect(findIngredient({ t: 'color', hex: '#fff' }, src)).toBeNull();
  });
});
