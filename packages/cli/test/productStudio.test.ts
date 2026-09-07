import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { createCore, type Core } from '@scenri/core';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';

/**
 * The product studio's server half: one read of the photographs into the
 * identity sheet, with the views the photographs do not cover planned from
 * it. What the studio shows and offers is decided here, deterministically,
 * so the same photographs always get the same offer.
 */
describe('product studio: analyze', () => {
  let home: string;
  let core: Core;
  let app: FastifyInstance;
  let seen: any[];

  const SHEET = {
    promptName: 'Amber Glass Dropper Bottle',
    description: 'A 30 ml amber glass dropper bottle with a black rubber bulb.',
    materials: 'amber glass, black rubber bulb',
    primaryColors: 'deep amber; matte black',
    preservationNotes: 'Keep the collar-to-bottle proportion.',
    negativeConstraints: 'Never invent lettering on the label.',
    category: 'beauty',
    conflict: '',
    coverage: ['A photograph of the label would pin the lettering.'],
  };

  const analyzer = (available: boolean) => ({
    isAvailable: async () => (available ? { ok: true } : { ok: false, reason: 'Codex is not installed' }),
    analyze: async (req: any) => {
      seen.push(req);
      return { ...SHEET, angles: req.imagePaths.map(() => 'front') };
    },
  });

  const start = (available: boolean) =>
    buildServer({ core, engines: { all: () => [], get: () => null }, analyzer: analyzer(available) as any });

  const png = (tint: string) =>
    sharp({ create: { width: 32, height: 40, channels: 3, background: tint } })
      .png()
      .toBuffer();

  beforeEach(() => {
    seen = [];
    home = mkdtempSync(join(tmpdir(), 'sc-pstudio-'));
    core = createCore(home);
    app = start(true);
  });
  afterEach(async () => {
    await app.drain();
    rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  const newBrand = async () =>
    (
      await app.inject({
        method: 'POST',
        url: '/api/brands',
        payload: { brand: { specVersion: '0.1', meta: { name: 'Acme' } } },
      })
    ).json();

  const analyze = (brandId: string, imageHashes: string[]) =>
    app.inject({ method: 'POST', url: `/api/brands/${brandId}/product-studio/analyze`, payload: { imageHashes } });

  it('reads the photographs into a sheet, labels each one, and plans only the views they do not cover', async () => {
    const brand = await newBrand();
    const hashes = [core.images.save(await png('#334466')), core.images.save(await png('#554466'))];

    const res = await analyze(brand.id, hashes);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.available).toBe(true);
    expect(body.sheet).toMatchObject({ promptName: 'Amber Glass Dropper Bottle', category: 'beauty' });
    expect(body.angles).toEqual(['front', 'front']);
    // beauty asks for three-quarter, front and label: front is covered, a
    // label is never drawn, and two photographs leave room for one view
    expect(body.plan).toEqual(['three-quarter']);
    expect(body.conflict).toBe('');
    expect(body.coverage).toEqual(['A photograph of the label would pin the lettering.']);

    expect(seen).toHaveLength(1);
    expect(seen[0].kind).toBe('product');
    expect(seen[0].imagePaths).toHaveLength(2);
    expect(seen[0].vocabulary.productCategories).toContain('beauty');
    expect(seen[0].vocabulary.angleKeys).toEqual(expect.arrayContaining(['lateral-side', 'label', 'three-quarter']));
  });

  it('says so when nothing can read the photographs, and still plans from nothing known', async () => {
    // a drained server closes its core, so the no-analyzer server gets a fresh one
    await app.drain();
    rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    home = mkdtempSync(join(tmpdir(), 'sc-pstudio-'));
    core = createCore(home);
    app = start(false);
    const brand = await newBrand();
    const hashes = [core.images.save(await png('#334466'))];

    const res = await analyze(brand.id, hashes);
    const body = res.json();
    expect(body).toMatchObject({ available: false, reason: 'Codex is not installed' });
    expect(res.statusCode).toBe(200);
    expect(body.sheet).toBeNull();
    expect(body.angles).toEqual(['other']);
    // one unlabelled photograph under the fallback plan leaves room for two views
    expect(body.plan).toEqual(['three-quarter', 'front']);
    expect(seen).toHaveLength(0);
  });

  it('refuses an image that is not in the store, and an empty set', async () => {
    const brand = await newBrand();
    expect((await analyze(brand.id, ['f'.repeat(32)])).statusCode).toBe(400);
    expect((await analyze(brand.id, [])).statusCode).toBe(400);
  });
});

/**
 * Save is the one write every product has always used, widened: a shot may
 * name its angle and its provenance, the sheet rides beside the name, and a
 * cover may be chosen. A drawn view is accepted only when this brand kept it
 * as a candidate, so nothing can launder an arbitrary image into "derived".
 */
describe('product studio: save', () => {
  let home: string;
  let core: Core;
  let app: FastifyInstance;

  const png = (tint: string) =>
    sharp({ create: { width: 32, height: 40, channels: 3, background: tint } })
      .png()
      .toBuffer();

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'sc-psave-'));
    core = createCore(home);
    app = buildServer({ core, engines: { all: () => [], get: () => null } });
  });
  afterEach(async () => {
    await app.drain();
    rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  const newBrand = async () =>
    (
      await app.inject({
        method: 'POST',
        url: '/api/brands',
        payload: { brand: { specVersion: '0.1', meta: { name: 'Acme' } } },
      })
    ).json();

  it('writes the photographs, the sheet and the cover in one write and answers with the id', async () => {
    const brand = await newBrand();
    const [a, b] = [core.images.save(await png('#334466')), core.images.save(await png('#554466'))];
    const res = await app.inject({
      method: 'POST',
      url: `/api/brands/${brand.id}/products`,
      payload: {
        name: 'Serum',
        category: 'beauty',
        shots: [
          { hash: a, angle: 'front' },
          { hash: b, angle: 'label' },
        ],
        cover: a,
        dimensions: '30 ml, 95 mm tall',
        sheet: {
          promptName: 'Amber Glass Dropper Bottle',
          description: 'A 30 ml amber glass dropper bottle.',
          materials: 'amber glass',
          primaryColors: 'deep amber',
          preservationNotes: 'Keep the proportion.',
          negativeConstraints: 'Never invent lettering.',
          colorways: ['amber'],
        },
      },
    });
    expect(res.statusCode).toBe(200);
    const { productId } = res.json();
    const product = (core.store.getBrand(brand.id)!.json as any).products.find((p: any) => p.id === productId);
    expect(product.shots).toEqual([
      { file: `asset:${a}`, angle: 'front', locked: true },
      { file: `asset:${b}`, angle: 'label', locked: true },
    ]);
    expect(product.cover).toBe(`asset:${a}`);
    expect(product).toMatchObject({
      name: 'Serum',
      category: 'beauty',
      dimensions: '30 ml, 95 mm tall',
      promptName: 'Amber Glass Dropper Bottle',
      description: 'A 30 ml amber glass dropper bottle.',
      materials: 'amber glass',
      primaryColors: 'deep amber',
      preservationNotes: 'Keep the proportion.',
      negativeConstraints: 'Never invent lettering.',
      colorways: ['amber'],
    });
    // the library reads it back the way the compiler will see it
    const lib = core.catalog.listLibraryProducts(brand.id, core.store.getBrand(brand.id)!.json);
    expect(lib[0].shots.map((s) => s.source)).toEqual(['photo', 'photo']);
    expect(lib[0].promptName).toBe('Amber Glass Dropper Bottle');
  });

  it('refuses a drawn view this brand never kept, and a product with no photograph', async () => {
    const brand = await newBrand();
    const [a, b] = [core.images.save(await png('#334466')), core.images.save(await png('#554466'))];
    const forged = await app.inject({
      method: 'POST',
      url: `/api/brands/${brand.id}/products`,
      payload: {
        name: 'Serum',
        shots: [
          { hash: a, angle: 'front' },
          { hash: b, angle: 'three-quarter', source: 'derived' },
        ],
      },
    });
    expect(forged.statusCode).toBe(400);
    const noPhoto = await app.inject({
      method: 'POST',
      url: `/api/brands/${brand.id}/products`,
      payload: { name: 'Serum', shots: [{ hash: a, source: 'derived' }] },
    });
    expect(noPhoto.statusCode).toBe(400);
  });

  it('still takes the old shape, so every existing caller keeps working', async () => {
    const brand = await newBrand();
    const a = core.images.save(await png('#334466'));
    const res = await app.inject({
      method: 'POST',
      url: `/api/brands/${brand.id}/products`,
      payload: { name: 'Blend', imageHashes: [a] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().productId).toMatch(/^p-/);
  });
});
