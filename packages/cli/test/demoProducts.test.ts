import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { createCore, type Core, type EngineAdapter } from '@scenri/core';
import {
  loadDemoProducts,
  demoProductResolver,
  demoProductFacetsOf,
  resolveDemoProductImages,
  type DemoProduct,
} from '../src/demoProducts.js';
import { buildServer } from '../src/server.js';
import type { FastifyInstance } from 'fastify';

const base: DemoProduct = {
  id: 'ok',
  name: 'Ok',
  category: 'beauty',
  description: 'd',
  width: 10,
  height: 10,
};

describe('shipped demo product catalog', () => {
  // The naming migration's invariants for products. `name` is a short display
  // label; `promptName` is the descriptive noun phrase the engine is sent and
  // is the single most load-bearing string in the whole compile.
  it('every shipped product carries a frozen promptName', () => {
    const { demoProducts, warnings } = loadDemoProducts();
    expect(warnings).toEqual([]);
    expect(demoProducts).toHaveLength(44);
    for (const p of demoProducts) {
      expect(p.promptName, `${p.id} has no promptName`).toBeTruthy();
    }
  });

  it('display names are short, unique, and separate from the brand', () => {
    const { demoProducts } = loadDemoProducts();
    const names = demoProducts.map((p) => p.name);
    expect(new Set(names).size, `duplicate product names: ${names.filter((n, i) => names.indexOf(n) !== i)}`).toBe(
      names.length,
    );
    for (const p of demoProducts) {
      expect(p.brand, `${p.id} has no brand`).toBeTruthy();
      // The point of the split: a chip-sized label. The old catalog reached 55
      // characters because the name was doing the prompt's job as well.
      expect(p.name.length, `${p.id} name is too long for a chip: "${p.name}"`).toBeLessThanOrEqual(24);
    }
  });

  it('a renamed product records the name it used to answer to, and keeps keywords', () => {
    const { demoProducts } = loadDemoProducts();
    for (const p of demoProducts) {
      if (p.promptName && p.promptName !== p.name) {
        expect(p.legacyNames ?? [], `${p.id} renamed without a legacy alias`).toContain(p.promptName);
      }
      expect((p.keywords ?? []).length, `${p.id} has no keywords`).toBeGreaterThanOrEqual(5);
    }
  });
});

describe('demo product loader', () => {
  it('loads valid demo products and skips bad files with a warning', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sc-demoproduct-'));
    writeFileSync(join(dir, 'ok.json'), JSON.stringify(base));
    writeFileSync(join(dir, 'bad.json'), '{nope');
    writeFileSync(join(dir, 'incomplete.json'), JSON.stringify({ id: 'x' }));
    writeFileSync(join(dir, 'nocategory.json'), JSON.stringify({ ...base, id: 'nocategory', category: '' }));
    const { demoProducts, warnings } = loadDemoProducts(dir);
    expect(demoProducts.map((p) => p.id)).toEqual(['ok']);
    expect(warnings).toHaveLength(3);
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it('resolves by id, and answers undefined for an unknown one', () => {
    const resolve = demoProductResolver([base]);
    expect(resolve('ok')?.name).toBe('Ok');
    expect(resolve('never-existed')).toBeUndefined();
  });

  it('reports the categories actually in use, sorted', () => {
    const { categories } = demoProductFacetsOf([base, { ...base, id: 'two', category: 'apparel' }]);
    expect(categories).toEqual(['apparel', 'beauty']);
  });
});

describe('resolveDemoProductImages', () => {
  let templatesDir: string;
  let home: string;
  let core: Core;

  beforeEach(async () => {
    templatesDir = mkdtempSync(join(tmpdir(), 'sc-demoproduct-templates-'));
    const refDir = join(templatesDir, 'previews', 'demo-products', 'ok');
    mkdirSync(refDir, { recursive: true });
    const jpg = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#a1b2c3' } })
      .jpeg()
      .toBuffer();
    writeFileSync(join(refDir, 'front.jpg'), jpg);
    home = mkdtempSync(join(tmpdir(), 'sc-demoproduct-home-'));
    core = createCore(home);
  });

  afterEach(() => {
    core.close();
    rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    rmSync(templatesDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it('hashes the hero photo into the image store on first use, idempotently', async () => {
    const first = await resolveDemoProductImages(core, templatesDir, base);
    expect(first?.shots).toHaveLength(1);
    expect(first?.shots[0].file).toMatch(/^asset:[a-f0-9]{32}$/);
    const second = await resolveDemoProductImages(core, templatesDir, base);
    expect(second?.shots[0].file).toBe(first?.shots[0].file);
  });

  it('answers null when the hero photo is missing', async () => {
    const resolved = await resolveDemoProductImages(core, templatesDir, { ...base, id: 'no-photo' });
    expect(resolved).toBeNull();
  });

  it('forwards description and category, the scale and apparel-guard inputs', async () => {
    // description is the only size-carrying text a demo product has, and
    // category is what arms the compiler's apparel guard; both were dropped
    // here, which is the giant-cream-jar mechanism.
    const resolved = await resolveDemoProductImages(core, templatesDir, base);
    expect(resolved?.description).toBe('d');
    expect(resolved?.category).toBe('beauty');
  });
});

describe('demo product catalog + brief resolution', () => {
  let templatesDir: string;
  let home: string;
  let core: Core;
  let app: FastifyInstance;

  const spy: EngineAdapter = {
    capabilities: () => ({
      id: 'spy',
      displayName: 'Spy',
      localOnly: false,
      supportsEdit: true,
      supportsMask: false,
      maxReferenceImages: 2,
    }),
    isAvailable: async () => ({ ok: true }),
    costEstimate: async () => 0,
    generate: async () => ({ images: [], costUsd: 0 }),
    edit: async () => ({ images: [], costUsd: 0 }),
  };

  beforeEach(async () => {
    templatesDir = mkdtempSync(join(tmpdir(), 'sc-demoproduct-api-templates-'));
    mkdirSync(join(templatesDir, 'demo-products'), { recursive: true });
    writeFileSync(
      join(templatesDir, 'demo-products', 'aurelia.json'),
      JSON.stringify({ ...base, id: 'aurelia', name: 'Aurelia Serum' }),
    );
    const refDir = join(templatesDir, 'previews', 'demo-products', 'aurelia');
    mkdirSync(refDir, { recursive: true });
    const jpg = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#ddccbb' } })
      .jpeg()
      .toBuffer();
    // 'aurelia' inherits category 'beauty' from `base`, whose primary
    // (thumbnail) angle is 'three-quarter' — see primaryAngleFor().
    writeFileSync(join(refDir, 'three-quarter.jpg'), jpg);

    home = mkdtempSync(join(tmpdir(), 'sc-demoproduct-api-home-'));
    core = createCore(home);
    app = buildServer({
      core,
      engines: { all: () => [spy], get: (id) => (id === 'spy' ? spy : null) },
      templatesDir,
    });
  });

  afterEach(async () => {
    await app.drain();
    rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    rmSync(templatesDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  const newBrand = async () =>
    (
      await app.inject({
        method: 'POST',
        url: '/api/brands',
        payload: { brand: { specVersion: '0.1', meta: { name: 'Acme' } } },
      })
    ).json();

  it('lists the catalog with facets and a thumbnail url', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/demo-products' });
    const body = res.json();
    expect(body.demoProducts).toHaveLength(1);
    expect(body.demoProducts[0].name).toBe('Aurelia Serum');
    expect(body.demoProducts[0].previewUrl).toMatch(/^\/api\/demo-product-thumbnails\/aurelia\.jpg\?v=\d+$/);
    expect(body.categories).toContain('beauty');
  });

  it('serves the thumbnail and 404s an unknown one', async () => {
    const ok = await app.inject({ method: 'GET', url: '/api/demo-product-thumbnails/aurelia.jpg' });
    expect(ok.statusCode).toBe(200);
    expect(ok.headers['content-type']).toBe('image/jpeg');
    const missing = await app.inject({ method: 'GET', url: '/api/demo-product-thumbnails/nope.jpg' });
    expect(missing.statusCode).toBe(404);
    // the picker and the cards ask for a derivative width through the same route
    const sized = await app.inject({ method: 'GET', url: '/api/demo-product-thumbnails/aurelia.jpg?v=1&w=320' });
    expect(sized.statusCode).toBe(200);
    expect(sized.headers['content-type']).toBe('image/webp');
    expect(sized.headers.etag).toMatch(/^"demo-aurelia-\d+-w320"$/);
    expect((await app.inject({ method: 'GET', url: '/api/demo-product-thumbnails/aurelia.jpg?w=7' })).statusCode).toBe(
      400,
    );
  });

  it('a brief can name a curated demo product directly, with no upload step first', async () => {
    const brand = await newBrand();
    const res = await app.inject({
      method: 'POST',
      url: '/api/brief/preview',
      payload: {
        brandId: brand.id,
        engineId: 'spy',
        brief: {
          tokens: [
            { t: 'product', id: 'aurelia' },
            { t: 'text', v: 'on a marble counter' },
          ],
        },
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.prompt).toContain('Aurelia Serum');
    expect(body.referenceCount).toBeGreaterThan(0);

    // resolving the demo product is a read-through cache, not a catalog write —
    // the brand's own products[] stays exactly as it started
    const brands = await app.inject({ method: 'GET', url: '/api/brands' });
    const brandNow = brands.json().find((b: any) => b.id === brand.id);
    expect(brandNow.json.products ?? []).toHaveLength(0);
  });

  it('a brief naming an unknown demo product warns instead of failing', async () => {
    const brand = await newBrand();
    const res = await app.inject({
      method: 'POST',
      url: '/api/brief/preview',
      payload: {
        brandId: brand.id,
        engineId: 'spy',
        brief: { tokens: [{ t: 'product', id: 'nope' }] },
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().warnings).toContain('A product in this brief is no longer in the brand kit.');
  });

  it('a real per-brand product with the same id takes priority over the demo catalog', async () => {
    const brand = await newBrand();
    const upload = await app.inject({
      method: 'POST',
      url: `/api/brands/${brand.id}/products`,
      headers: { 'content-type': `multipart/form-data; boundary=----b` },
      payload: Buffer.concat([
        Buffer.from(`------b\r\ncontent-disposition: form-data; name="name"\r\n\r\nReal Aurelia\r\n`),
        Buffer.from(
          `------b\r\ncontent-disposition: form-data; name="file"; filename="shot.png"\r\ncontent-type: image/png\r\n\r\n`,
        ),
        await sharp({ create: { width: 8, height: 8, channels: 3, background: '#112233' } })
          .png()
          .toBuffer(),
        Buffer.from(`\r\n------b--\r\n`),
      ]),
    });
    expect(upload.statusCode).toBe(200);
    const productId = upload.json().json.products[0].id;

    const res = await app.inject({
      method: 'POST',
      url: '/api/brief/preview',
      payload: {
        brandId: brand.id,
        engineId: 'spy',
        brief: { tokens: [{ t: 'product', id: productId }] },
      },
    });
    expect(res.json().prompt).toContain('Real Aurelia');
  });
});
