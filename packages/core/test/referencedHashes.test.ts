import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCore, type Core } from '../src/index.js';

/**
 * The whole store's answer to imageReferenced, read once: what a sweep over
 * every stored picture asks instead of asking per picture.
 */

let home: string;
let core: Core;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'sc-refs-'));
  core = createCore(home);
});
afterEach(() => {
  core.close();
  rmSync(home, { recursive: true, force: true });
});

const h = (c: string) => c.repeat(32);

describe('referencedHashes', () => {
  it('finds a hash in every source imageReferenced reads, and in the brand documents', () => {
    const brand = core.store.createBrand({
      specVersion: '0.1',
      meta: { name: 'Acme' },
      characters: [{ id: 'up-a', name: 'Ria', shots: [{ file: `asset:${h('1')}` }] }],
    } as any);
    const ws = core.store.workspaceFor(brand.id);
    const shot = core.store.addNode({
      projectId: ws.id,
      parentId: null,
      kind: 'generation',
      prompt: 'x',
      engineId: 'demo',
    });
    core.store.completeNode(shot.id, { images: [h('2')], costUsd: 0 });
    const edit = core.store.addNode({ projectId: ws.id, parentId: null, kind: 'edit', prompt: 'x', engineId: 'demo' });
    core.store.setBrief(edit.id, { sourceImage: h('3') });
    const source = core.catalog.upsertSource(brand.id, 'https://acme.example', 'shopify');
    const product = core.catalog.upsertProduct({
      sourceId: source.id,
      brandId: brand.id,
      externalKey: 'p1',
      title: 'Mug',
      url: 'https://acme.example/products/mug',
      price: 12,
      images: [],
      variants: [],
    });
    core.catalog.addLocalImage(product.id, `asset:${h('4')}`);
    core.store.putPresenterDraft({ id: 'pd-1', brandId: brand.id, json: { sources: [h('5')] } });

    const refs = core.store.referencedHashes();
    for (const c of ['1', '2', '3', '4', '5']) expect(refs.has(h(c))).toBe(true);
    expect(refs.has(h('6'))).toBe(false);
    // every hash it reports agrees with the per-hash question, brand documents aside
    for (const c of ['2', '3', '4', '5']) expect(core.store.imageReferenced(h(c))).toBe(true);
  });

  it('never finds less than LIKE would: any case, and inside a longer run of hex', () => {
    const brand = core.store.createBrand({ specVersion: '0.1', meta: { name: 'Acme' } } as any);
    const ws = core.store.workspaceFor(brand.id);
    const edit = core.store.addNode({ projectId: ws.id, parentId: null, kind: 'edit', prompt: 'x', engineId: 'demo' });
    const inside = `${'a'.repeat(31)}b`;
    core.store.setBrief(edit.id, { a: `ff${inside}0`, b: h('c').toUpperCase() });

    const refs = core.store.referencedHashes();
    expect(core.store.imageReferenced(inside)).toBe(true);
    expect(refs.has(inside)).toBe(true);
    expect(core.store.imageReferenced(h('c'))).toBe(true);
    expect(refs.has(h('c'))).toBe(true);
  });

  it('is empty on an empty library', () => {
    expect(core.store.referencedHashes().size).toBe(0);
  });
});
