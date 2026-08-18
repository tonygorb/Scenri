import type { FastifyInstance } from 'fastify';
import type { Core } from '@scenri/core';
import { cancelCatalogImport, startCatalogImport } from '../catalogImport.js';

export function registerCatalogImportRoutes(
  app: FastifyInstance,
  deps: { core: Core; fetchImpl?: typeof fetch },
): void {
  const { core, fetchImpl } = deps;
  // ---- catalog import (store URL → full product library)
  app.get('/api/brands/:id/products-library', async (req, reply) => {
    const brand = core.store.getBrand((req.params as any).id);
    if (!brand) return reply.status(404).send({ error: 'brand not found' });
    const products = core.catalog.listLibraryProducts(brand.id, brand.json);
    const source = core.catalog.getSourceForBrand(brand.id);
    return { products, source };
  });
  app.get('/api/brands/:id/catalog/source', async (req, reply) => {
    const brand = core.store.getBrand((req.params as any).id);
    if (!brand) return reply.status(404).send({ error: 'brand not found' });
    return { source: core.catalog.getSourceForBrand(brand.id) };
  });
  app.post('/api/brands/:id/catalog/import', async (req, reply) => {
    const brandId = (req.params as any).id;
    const brand = core.store.getBrand(brandId);
    if (!brand) return reply.status(404).send({ error: 'brand not found' });
    const url = String((req.body as any)?.url ?? (brand.json as any)?.meta?.website ?? '');
    if (!url.trim()) return reply.status(400).send({ error: 'url required' });
    try {
      return startCatalogImport({ core, fetchImpl }, brandId, url);
    } catch (err: any) {
      return reply.status(err.statusCode ?? 500).send({ error: err.message ?? 'import failed' });
    }
  });
  app.get('/api/brands/:id/catalog/jobs/:jobId', async (req, reply) => {
    const brandId = (req.params as any).id;
    const job = core.catalog.getJob((req.params as any).jobId);
    if (!job || job.brandId !== brandId) return reply.status(404).send({ error: 'job not found' });
    return job;
  });
  app.get('/api/brands/:id/catalog/jobs', async (req, reply) => {
    const brand = core.store.getBrand((req.params as any).id);
    if (!brand) return reply.status(404).send({ error: 'brand not found' });
    return { jobs: core.catalog.listJobs(brand.id) };
  });
  app.post('/api/brands/:id/catalog/jobs/:jobId/cancel', async (req, reply) => {
    const brandId = (req.params as any).id;
    const job = core.catalog.getJob((req.params as any).jobId);
    if (!job || job.brandId !== brandId) return reply.status(404).send({ error: 'job not found' });
    cancelCatalogImport(job.id);
    return { ok: true };
  });
  app.delete('/api/brands/:id/catalog/products/:productId', async (req, reply) => {
    const brand = core.store.getBrand((req.params as any).id);
    if (!brand) return reply.status(404).send({ error: 'brand not found' });
    const pid = String((req.params as any).productId).replace(/^cat-/, '');
    const row = core.catalog.getProduct(pid);
    if (!row || row.brandId !== brand.id) return reply.status(404).send({ error: 'product not found' });
    core.catalog.deleteCatalogProduct(pid);
    return { ok: true };
  });
  // Catalog products: the fields this app invents. Name, price, vendor and
  // variants come from the store and are refreshed by every import, so they
  // are not editable here. Material and dimensions have no store column at
  // all, and they are the two the compiler turns into finish and true-scale
  // directives — so an imported product can earn them like a manual one.
  app.patch('/api/brands/:id/catalog/products/:productId', async (req, reply) => {
    const brand = core.store.getBrand((req.params as any).id);
    if (!brand) return reply.status(404).send({ error: 'brand not found' });
    const pid = String((req.params as any).productId).replace(/^cat-/, '');
    const row = core.catalog.getProduct(pid);
    if (!row || row.brandId !== brand.id) return reply.status(404).send({ error: 'product not found' });
    const body = (req.body ?? {}) as Record<string, unknown>;
    const patch: Record<string, string | null> = {};
    for (const f of ['category', 'variant', 'material', 'dimensions'] as const) {
      if (f in body) patch[f] = body[f] == null ? null : String(body[f]).slice(0, 500) || null;
    }
    const updated = core.catalog.updateProduct(pid, patch);
    return { product: updated };
  });
}
