import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCore, type Core } from '../src/index.js';

let home: string;
let core: Core;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'sc-cat-'));
  core = createCore(home);
});
afterEach(() => {
  core.close();
  rmSync(home, { recursive: true, force: true });
});

describe('catalog store', () => {
  it('upserts products idempotently and merges library', () => {
    const brand = core.store.createBrand({
      specVersion: '0.1',
      meta: { name: 'Acme' },
      products: [{ id: 'p-manual', name: 'Manual', shots: [{ file: `asset:${'a'.repeat(32)}`, locked: true }] }],
    } as any);

    const source = core.catalog.upsertSource(brand.id, 'https://acme.example', 'shopify');
    const first = core.catalog.upsertProduct({
      sourceId: source.id,
      brandId: brand.id,
      externalKey: '99',
      title: 'Candle',
      url: 'https://acme.example/products/candle',
      price: 20,
      images: [{ sourceUrl: 'https://img/candle.jpg', position: 0 }],
      variants: [{ externalKey: 'v1', sku: 'C-1', price: 20 }],
    });
    expect(first.title).toBe('Candle');

    const second = core.catalog.upsertProduct({
      sourceId: source.id,
      brandId: brand.id,
      externalKey: '99',
      title: 'Candle Updated',
      url: 'https://acme.example/products/candle',
      price: 22,
      images: [{ sourceUrl: 'https://img/candle.jpg', position: 0, assetRef: `asset:${'b'.repeat(32)}` }],
    });
    expect(second.id).toBe(first.id);
    expect(second.title).toBe('Candle Updated');
    expect(core.catalog.listImages(second.id)[0].assetRef).toContain('asset:');

    core.catalog.markMissingUnavailable(source.id, ['99']);
    // add another then mark missing
    core.catalog.upsertProduct({
      sourceId: source.id,
      brandId: brand.id,
      externalKey: '100',
      title: 'Gone',
      url: 'https://acme.example/products/gone',
    });
    core.catalog.markMissingUnavailable(source.id, ['99']);
    expect(core.catalog.listProducts(brand.id).map((p) => p.externalKey)).toEqual(['99']);

    const library = core.catalog.listLibraryProducts(brand.id, brand.json);
    expect(library.some((p) => p.origin === 'manual' && p.id === 'p-manual')).toBe(true);
    expect(library.some((p) => p.origin === 'catalog' && p.id.startsWith('cat-'))).toBe(true);
  });

  it('tracks import job progress', () => {
    const brand = core.store.createBrand({ specVersion: '0.1', meta: { name: 'Acme' } } as any);
    const job = core.catalog.createJob({ brandId: brand.id, url: 'https://acme.example' });
    expect(job.stage).toBe('queued');
    const updated = core.catalog.updateJob(job.id, {
      stage: 'discovering',
      discovered: 10,
      platform: 'shopify',
      message: 'Found 10',
    })!;
    expect(updated.discovered).toBe(10);
    const done = core.catalog.updateJob(job.id, { stage: 'completed', upserted: 10, finished: true })!;
    expect(done.finishedAt).toBeTruthy();
  });
});
