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

  /**
   * The fields on this page are the ones the store has no column for, and the
   * angles a user shot themselves have no counterpart in a crawl. Both used to
   * be silently reverted every time the store was re-imported.
   */
  it('a re-import keeps what the user set: fields, order, and their own angles', () => {
    const brand = core.store.createBrand({ specVersion: '0.1', meta: { name: 'Acme' } } as any);
    const source = core.catalog.upsertSource(brand.id, 'https://acme.example', 'shopify');
    const crawl = (title: string, images: { sourceUrl: string; position: number; assetRef?: string }[]) =>
      core.catalog.upsertProduct({
        sourceId: source.id,
        brandId: brand.id,
        externalKey: '7',
        title,
        url: 'https://acme.example/products/lamp',
        productType: 'Lighting',
        images,
      });

    const first = crawl('Lamp', [
      { sourceUrl: 'https://img/a.jpg', position: 0, assetRef: `asset:${'a'.repeat(32)}` },
      { sourceUrl: 'https://img/b.jpg', position: 1, assetRef: `asset:${'b'.repeat(32)}` },
    ]);

    core.catalog.updateProduct(first.id, {
      category: 'furniture',
      material: 'Oak and linen',
      dimensions: '300 × 300 × 480 mm',
    });
    core.catalog.addLocalImage(first.id, `asset:${'c'.repeat(32)}`, 'back');
    // the user's own angle, promoted ahead of both packshots
    core.catalog.setImageOrder(first.id, [
      `asset:${'c'.repeat(32)}`,
      `asset:${'a'.repeat(32)}`,
      `asset:${'b'.repeat(32)}`,
    ]);

    // the store runs again, and reports its two images in its own order
    const again = crawl('Lamp (2024)', [
      { sourceUrl: 'https://img/a.jpg', position: 0 },
      { sourceUrl: 'https://img/b.jpg', position: 1 },
      { sourceUrl: 'https://img/d.jpg', position: 2, assetRef: `asset:${'d'.repeat(32)}` },
    ]);

    expect(again.id).toBe(first.id);
    expect(again.title).toBe('Lamp (2024)');
    // ours, untouched
    expect(again.category).toBe('furniture');
    expect(again.material).toBe('Oak and linen');
    expect(again.dimensions).toBe('300 × 300 × 480 mm');

    const images = core.catalog.listImages(first.id);
    // the user's angle is still here, still first, still carrying its angle;
    // a genuinely new store image is appended rather than inserted
    expect(images.map((i) => i.assetRef)).toEqual([
      `asset:${'c'.repeat(32)}`,
      `asset:${'a'.repeat(32)}`,
      `asset:${'b'.repeat(32)}`,
      `asset:${'d'.repeat(32)}`,
    ]);
    expect(images[0].angle).toBe('back');
    expect(images.map((i) => i.position)).toEqual([0, 1, 2, 3]);

    const [entry] = core.catalog.listLibraryProducts(brand.id, brand.json).filter((p) => p.origin === 'catalog');
    expect(entry.shots[0].local).toBe(true);
    expect(entry.shots[1].local).toBe(false);
  });

  /**
   * The colourway case: a store sends one image per colour of one product, and
   * three colours of a thing are not three views of it. Whatever the user takes
   * out has to stay out — including across the next import, which would
   * otherwise hand every one of them straight back.
   */
  it('a store image set aside stays out, and stays out through a re-import', () => {
    const brand = core.store.createBrand({ specVersion: '0.1', meta: { name: 'Acme' } } as any);
    const source = core.catalog.upsertSource(brand.id, 'https://acme.example', 'shopify');
    const colours = ['a', 'b', 'c', 'd', 'e'];
    const crawl = () =>
      core.catalog.upsertProduct({
        sourceId: source.id,
        brandId: brand.id,
        externalKey: '9',
        title: 'Pebble',
        url: 'https://acme.example/products/pebble',
        images: colours.map((c, i) => ({
          sourceUrl: `https://img/${c}.jpg`,
          position: i,
          assetRef: `asset:${c.repeat(32)}`,
        })),
      });
    const p = crawl();

    // keep the first two, set the other three aside
    core.catalog.setImageOrder(p.id, [`asset:${'a'.repeat(32)}`, `asset:${'b'.repeat(32)}`]);
    const kept = () => core.catalog.listLibraryProducts(brand.id, brand.json).find((x) => x.origin === 'catalog')!;
    expect(kept().shots.map((s) => s.file)).toEqual([`asset:${'a'.repeat(32)}`, `asset:${'b'.repeat(32)}`]);
    expect(kept().hiddenShots?.length).toBe(3);
    // nothing was deleted — a store image is not ours to delete
    expect(core.catalog.listImages(p.id)).toHaveLength(5);

    crawl();
    expect(kept().shots.map((s) => s.file)).toEqual([`asset:${'a'.repeat(32)}`, `asset:${'b'.repeat(32)}`]);
    expect(kept().hiddenShots?.length).toBe(3);

    // and naming one again is how it comes back
    core.catalog.setImageOrder(p.id, [`asset:${'a'.repeat(32)}`, `asset:${'b'.repeat(32)}`, `asset:${'d'.repeat(32)}`]);
    expect(kept().shots).toHaveLength(3);
    expect(kept().hiddenShots?.length).toBe(2);
  });

  /** Content addressing means a store listing one file twice is one reference. */
  it('the same image listed twice is one reference', () => {
    const brand = core.store.createBrand({ specVersion: '0.1', meta: { name: 'Acme' } } as any);
    const source = core.catalog.upsertSource(brand.id, 'https://acme.example', 'shopify');
    const p = core.catalog.upsertProduct({
      sourceId: source.id,
      brandId: brand.id,
      externalKey: '10',
      title: 'Twice',
      url: 'https://acme.example/products/twice',
      images: [
        { sourceUrl: 'https://img/one.jpg', position: 0, assetRef: `asset:${'f'.repeat(32)}` },
        { sourceUrl: 'https://img/two.jpg', position: 1, assetRef: `asset:${'f'.repeat(32)}` },
      ],
    });
    expect(core.catalog.listImages(p.id)).toHaveLength(2);
    const entry = core.catalog.listLibraryProducts(brand.id, brand.json).find((x) => x.origin === 'catalog')!;
    expect(entry.shots).toHaveLength(1);
  });

  it("only the user's own angles can be removed from an imported product", () => {
    const brand = core.store.createBrand({ specVersion: '0.1', meta: { name: 'Acme' } } as any);
    const source = core.catalog.upsertSource(brand.id, 'https://acme.example', 'shopify');
    const p = core.catalog.upsertProduct({
      sourceId: source.id,
      brandId: brand.id,
      externalKey: '8',
      title: 'Vase',
      url: 'https://acme.example/products/vase',
      images: [{ sourceUrl: 'https://img/v.jpg', position: 0, assetRef: `asset:${'e'.repeat(32)}` }],
    });
    core.catalog.addLocalImage(p.id, `asset:${'f'.repeat(32)}`);

    // asking for neither of them: the store's comes back, ours does not
    core.catalog.setImageOrder(p.id, []);
    expect(core.catalog.listImages(p.id).map((i) => i.assetRef)).toEqual([`asset:${'e'.repeat(32)}`]);
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
