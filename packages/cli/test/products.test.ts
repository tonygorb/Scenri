import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { createCore, type Core } from '@scenri/core';
import { buildServer } from '../src/server.js';
import type { FastifyInstance } from 'fastify';

/**
 * The routes a product's reference set is edited through.
 *
 * The compiler reads meaning straight off that set — `shots[0]` is the
 * essential attachment, only the first PRODUCT_REF_MAX reach an engine — so
 * "which images, in what order" is a correctness contract, not a preference.
 * These cover the guardrails and the one asymmetry that matters: an image the
 * user uploaded is theirs to delete, an image the store sent is not, because
 * the next import would fetch it straight back.
 */
describe('product references', () => {
  let home: string;
  let core: Core;
  let app: FastifyInstance;

  const png = (tint: string) =>
    sharp({ create: { width: 32, height: 40, channels: 3, background: tint } })
      .png()
      .toBuffer();

  beforeEach(async () => {
    home = mkdtempSync(join(tmpdir(), 'sc-products-'));
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

  const savePhoto = async (tint: string) => core.images.save(await png(tint));
  const brandJson = (id: string) => core.store.getBrand(id)?.json as any;

  /** A manual product with `n` distinct references, angled so order is visible. */
  const manualProduct = async (brandId: string, angles: string[]) => {
    const hashes = await Promise.all(angles.map((_, i) => savePhoto(`#${(0x33 + i * 0x22).toString(16)}4466`)));
    const res = await app.inject({
      method: 'POST',
      url: `/api/brands/${brandId}/products`,
      payload: { name: 'House Blend', imageHashes: hashes },
    });
    const { productId } = res.json();
    // The create route takes hashes only, so the angles are set afterwards —
    // they exist here purely so a reorder can be asserted by name.
    const json = brandJson(brandId);
    json.products = json.products.map((p: any) =>
      p.id === productId ? { ...p, shots: p.shots.map((s: any, i: number) => ({ ...s, angle: angles[i] })) } : p,
    );
    core.store.updateBrand(brandId, json);
    return { productId, files: hashes.map((h) => `asset:${h}`) };
  };

  const shotsOf = (brandId: string, productId: string) =>
    brandJson(brandId).products.find((p: any) => p.id === productId).shots as any[];

  /** An imported product, seeded through the store rather than an HTTP route. */
  const catalogProduct = async (brandId: string, count: number) => {
    const source = core.catalog.upsertSource(brandId, 'https://acme.example', 'shopify');
    const hashes = await Promise.all(
      Array.from({ length: count }, (_, i) => savePhoto(`#${(0x44 + i * 0x11).toString(16)}2288`)),
    );
    const row = core.catalog.upsertProduct({
      sourceId: source.id,
      brandId,
      externalKey: 'sku-1',
      title: 'Pebble Harmony',
      url: 'https://acme.example/products/pebble',
      images: hashes.map((h, i) => ({ sourceUrl: `https://cdn/${i}.jpg`, position: i, assetRef: `asset:${h}` })),
    });
    return { row, id: `cat-${row.id}`, files: hashes.map((h) => `asset:${h}`), source };
  };

  const library = (brandId: string) => {
    const brand = core.store.getBrand(brandId)!;
    return core.catalog.listLibraryProducts(brandId, brand.json);
  };

  /**
   * The shots route takes a file the way a browser sends one. Fastify's inject
   * has no FormData, so the body is spelled out: one field, one file part.
   */
  const multipart = (file: Buffer, field?: string, value?: string) => {
    const boundary = '----scenritest';
    const head = Buffer.from(
      `${field ? `--${boundary}\r\nContent-Disposition: form-data; name="${field}"\r\n\r\n${value}\r\n` : ''}` +
        `--${boundary}\r\n` +
        'Content-Disposition: form-data; name="file"; filename="angle.png"\r\n' +
        'Content-Type: image/png\r\n\r\n',
    );
    const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
    return {
      payload: Buffer.concat([head, file, tail]),
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    };
  };

  const putShots = (brandId: string, productId: string, files: string[]) =>
    app.inject({ method: 'PUT', url: `/api/brands/${brandId}/products/${productId}/shots`, payload: { files } });

  /* ------------------------------------------------------------ guardrails */

  it('refuses to leave a product with nothing to generate from', async () => {
    const brand = await newBrand();
    const { productId } = await manualProduct(brand.id, ['front', 'side']);

    const res = await putShots(brand.id, productId, []);
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/at least one reference/i);
    expect(shotsOf(brand.id, productId)).toHaveLength(2);
  });

  it('refuses a set that names the same image twice, or one the product never had', async () => {
    const brand = await newBrand();
    const { productId, files } = await manualProduct(brand.id, ['front', 'side']);

    const dupe = await putShots(brand.id, productId, [files[0], files[0]]);
    expect(dupe.statusCode).toBe(400);
    expect(dupe.json().error).toMatch(/duplicate/i);

    const stranger = await putShots(brand.id, productId, [`asset:${'0'.repeat(32)}`]);
    expect(stranger.statusCode).toBe(400);
    expect(stranger.json().error).toMatch(/unknown reference/i);
    // "not on this product" is not the same as "not on this machine": an image
    // this brand already holds may be named, which is how an undo works.
    const elsewhere = await savePhoto('#0099ff');
    const readmit = await putShots(brand.id, productId, [...files, `asset:${elsewhere}`]);
    expect(readmit.statusCode).toBe(200);
    await putShots(brand.id, productId, files);

    // Neither attempt may have moved anything.
    expect(shotsOf(brand.id, productId).map((s) => s.angle)).toEqual(['front', 'side']);
  });

  it('404s for a product that is not in this brand', async () => {
    const brand = await newBrand();
    const { files } = await manualProduct(brand.id, ['front']);
    const res = await putShots(brand.id, 'p-nothere', files);
    expect(res.statusCode).toBe(404);
  });

  /* --------------------------------------------------------------- manual */

  it('reorders a manual set and carries each shot across whole', async () => {
    const brand = await newBrand();
    const { productId, files } = await manualProduct(brand.id, ['front', 'side', 'detail']);

    const res = await putShots(brand.id, productId, [files[2], files[0], files[1]]);
    expect(res.statusCode).toBe(200);

    const shots = shotsOf(brand.id, productId);
    expect(shots.map((s) => s.angle)).toEqual(['detail', 'front', 'side']);
    // angle and locked belong to the image, not to its position: re-deriving
    // them from the new order would quietly drop both.
    expect(shots.every((s) => s.locked === true)).toBe(true);
  });

  it('deletes an image the user uploaded, because that one is theirs', async () => {
    const brand = await newBrand();
    const { productId, files } = await manualProduct(brand.id, ['front', 'side']);

    await putShots(brand.id, productId, [files[0]]);
    expect(shotsOf(brand.id, productId).map((s) => s.angle)).toEqual(['front']);
  });

  it('takes a removed image back, in the place it came from', async () => {
    const brand = await newBrand();
    const { productId, files } = await manualProduct(brand.id, ['front', 'side', 'detail']);

    // what Undo does: the write that removed it, run again with the old list
    await putShots(brand.id, productId, [files[0], files[2]]);
    expect(shotsOf(brand.id, productId)).toHaveLength(2);

    const back = await putShots(brand.id, productId, files);
    expect(back.statusCode).toBe(200);
    expect(shotsOf(brand.id, productId).map((s) => s.file)).toEqual(files);
    // the entry is rebuilt the way an upload arrives; nothing pretends the
    // angle survived a round trip through a delete
    expect(shotsOf(brand.id, productId).every((s) => s.locked === true)).toBe(true);
  });

  /* -------------------------------------------------------------- catalog */

  it('sets a store image aside instead of deleting it, and gives it back when named again', async () => {
    const brand = await newBrand();
    const { row, id, files } = await catalogProduct(brand.id, 4);

    const res = await putShots(brand.id, id, [files[0], files[1]]);
    expect(res.statusCode).toBe(200);

    const entry = () => library(brand.id).find((p) => p.origin === 'catalog')!;
    expect(entry().shots.map((s) => s.file)).toEqual([files[0], files[1]]);
    expect(entry().hiddenShots?.map((s) => s.file)).toEqual([files[2], files[3]]);
    // nothing was destroyed: the next import would have brought them back anyway
    expect(core.catalog.listImages(row.id)).toHaveLength(4);

    await putShots(brand.id, id, [files[0], files[1], files[3]]);
    expect(entry().shots.map((s) => s.file)).toEqual([files[0], files[1], files[3]]);
    expect(entry().hiddenShots?.map((s) => s.file)).toEqual([files[2]]);
  });

  it('takes an angle of its own onto an imported product, and keeps it through the next import', async () => {
    const brand = await newBrand();
    const { row, id, files, source } = await catalogProduct(brand.id, 2);
    const mine = await png('#118844');

    const res = await app.inject({
      method: 'POST',
      url: `/api/brands/${brand.id}/products/${id}/shots`,
      ...multipart(mine, 'angle', 'back'),
    });
    expect(res.statusCode).toBe(200);

    const entry = () => library(brand.id).find((p) => p.origin === 'catalog')!;
    expect(entry().shots).toHaveLength(3);
    const ours = entry().shots.find((s) => s.local);
    expect(ours, 'the uploaded angle is marked as ours, not the store’s').toBeTruthy();

    // the store crawls again and reports only its own two
    core.catalog.upsertProduct({
      sourceId: source.id,
      brandId: brand.id,
      externalKey: 'sku-1',
      title: 'Pebble Harmony',
      url: 'https://acme.example/products/pebble',
      images: files.map((f, i) => ({ sourceUrl: `https://cdn/${i}.jpg`, position: i, assetRef: f })),
    });
    expect(entry().shots.map((s) => s.file)).toContain(ours!.file);
    expect(core.catalog.listImages(row.id)).toHaveLength(3);
  });

  it('writes the four fields a store has no column for, and nothing else', async () => {
    const brand = await newBrand();
    const { row, id } = await catalogProduct(brand.id, 1);

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/brands/${brand.id}/catalog/products/${id}`,
      payload: {
        category: 'beverage',
        material: 'matte aluminium',
        dimensions: '66 × 66 × 115 mm',
        variant: 'Midnight',
        title: 'Hacked',
        price: 999,
      },
    });
    expect(res.statusCode).toBe(200);

    const after = core.catalog.getProduct(row.id)!;
    expect(after.category).toBe('beverage');
    expect(after.material).toBe('matte aluminium');
    expect(after.dimensions).toBe('66 × 66 × 115 mm');
    expect(after.variant).toBe('Midnight');
    // the store owns these, and a page cannot overwrite them
    expect(after.title).toBe('Pebble Harmony');
    expect(after.price).toBeNull();
  });
});
