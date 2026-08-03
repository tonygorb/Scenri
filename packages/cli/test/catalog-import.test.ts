import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCore, type EngineAdapter } from '@scenri/core';
import { createDemoEngine } from '@scenri/engine-demo';
import { buildServer } from '../src/server.js';

function registryWith(...adapters: EngineAdapter[]) {
  const byId = new Map(adapters.map((a) => [a.capabilities().id, a]));
  return { all: () => adapters, get: (id: string) => byId.get(id) ?? null };
}

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

function shopifyFetch(input: any) {
  const url = String(input);
  if (url.includes('/products.json')) {
    const page = Number(new URL(url).searchParams.get('page') ?? '1');
    if (page > 1) return Promise.resolve(new Response(JSON.stringify({ products: [] }), { status: 200 }));
    return Promise.resolve(
      new Response(
        JSON.stringify({
          products: [
            {
              id: 1,
              title: 'House Blend',
              handle: 'house-blend',
              body_html: '<p>coffee</p>',
              vendor: 'Acme',
              product_type: 'Coffee',
              tags: 'flagship',
              variants: [{ id: 11, title: 'Default', sku: 'HB', price: '18.00', available: true }],
              images: [{ src: 'https://cdn.example/blend.jpg', position: 1 }],
            },
            {
              id: 2,
              title: 'Espresso',
              handle: 'espresso',
              body_html: '<p>shot</p>',
              vendor: 'Acme',
              product_type: 'Coffee',
              tags: '',
              variants: [{ id: 22, title: 'Default', sku: 'ES', price: '16.00', available: true }],
              images: [{ src: 'https://cdn.example/espresso.jpg', position: 1 }],
            },
          ],
        }),
        { status: 200 },
      ),
    );
  }
  if (url.includes('sitemap')) return Promise.resolve(new Response('<urlset></urlset>', { status: 200 }));
  if (url.includes('.jpg'))
    return Promise.resolve(new Response(PNG, { status: 200, headers: { 'content-type': 'image/jpeg' } }));
  return Promise.resolve(new Response('', { status: 404 }));
}

describe('catalog import API', () => {
  let home: string;
  let core: ReturnType<typeof createCore>;
  let app: Awaited<ReturnType<typeof buildServer>>;

  beforeEach(async () => {
    home = mkdtempSync(join(tmpdir(), 'bt-cli-cat-'));
    core = createCore(home);
    app = buildServer({
      core,
      engines: registryWith(createDemoEngine((b) => core.images.save(b))),
      fetchImpl: shopifyFetch as any,
    });
    await app.ready();
  });
  afterEach(async () => {
    await app.close();
    core.close();
    rmSync(home, { recursive: true, force: true });
  });

  it('imports full catalog into unified library without duplicates on re-run', async () => {
    const brand = await app.inject({
      method: 'POST',
      url: '/api/brands',
      payload: { brand: { specVersion: '0.1', meta: { name: 'Acme', website: 'https://shop.example' } } },
    });
    const brandId = brand.json().id;

    const start = await app.inject({
      method: 'POST',
      url: `/api/brands/${brandId}/catalog/import`,
      payload: { url: 'https://shop.example' },
    });
    expect(start.statusCode).toBe(200);
    const jobId = start.json().jobId;

    // poll until finished
    let job: any;
    for (let i = 0; i < 80; i++) {
      await new Promise((r) => setTimeout(r, 50));
      const res = await app.inject({ method: 'GET', url: `/api/brands/${brandId}/catalog/jobs/${jobId}` });
      job = res.json();
      if (job.finishedAt || job.stage === 'completed' || job.stage === 'partial' || job.stage === 'failed') break;
    }
    expect(['completed', 'partial']).toContain(job.stage);
    expect(job.upserted).toBe(2);
    expect(job.platform).toBe('shopify');

    const lib1 = await app.inject({ method: 'GET', url: `/api/brands/${brandId}/products-library` });
    expect(lib1.json().products).toHaveLength(2);
    expect(lib1.json().products.every((p: any) => p.shots?.length > 0)).toBe(true);

    // re-import is idempotent
    const start2 = await app.inject({
      method: 'POST',
      url: `/api/brands/${brandId}/catalog/import`,
      payload: { url: 'https://shop.example' },
    });
    const jobId2 = start2.json().jobId;
    for (let i = 0; i < 80; i++) {
      await new Promise((r) => setTimeout(r, 50));
      const res = await app.inject({ method: 'GET', url: `/api/brands/${brandId}/catalog/jobs/${jobId2}` });
      job = res.json();
      if (job.finishedAt || job.stage === 'completed' || job.stage === 'partial' || job.stage === 'failed') break;
    }
    const lib2 = await app.inject({ method: 'GET', url: `/api/brands/${brandId}/products-library` });
    expect(lib2.json().products).toHaveLength(2);
  });
});
