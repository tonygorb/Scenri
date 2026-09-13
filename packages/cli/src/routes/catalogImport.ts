import type { FastifyInstance } from 'fastify';
import type { Core } from '@scenri/core';
import { cancelCatalogImport, startCatalogImport } from '../catalogImport.js';
import { getScan, startCatalogScan } from '../catalogScan.js';
import { fetchProductPages } from '@scenri/catalog';

export function registerCatalogImportRoutes(
  app: FastifyInstance,
  deps: { core: Core; fetchImpl?: typeof fetch },
): void {
  const { core, fetchImpl } = deps;
  // ---- catalog import (store URL → full product library)
  // The library the studio reads, in the shape it reads.
  //
  // This returned every product with every image, every hidden image and every
  // variant: 0.78 MB for 600 products, 2.9 MB at gymshark's 2,201, of which a
  // card uses one field. The light shape is 177 bytes a product. The whole
  // product, with all of its pictures, is one request away below.
  app.get('/api/brands/:id/products-library', async (req, reply) => {
    const brand = core.store.getBrand((req.params as any).id);
    if (!brand) return reply.status(404).send({ error: 'brand not found' });
    const products = core.catalog.listLibraryIndex(brand.id, brand.json);
    const source = core.catalog.getSourceForBrand(brand.id);
    return { products, source };
  });
  app.get('/api/brands/:id/products-library/:productId', async (req, reply) => {
    const brand = core.store.getBrand((req.params as any).id);
    if (!brand) return reply.status(404).send({ error: 'brand not found' });
    const product = core.catalog.libraryProduct(brand.id, brand.json, String((req.params as any).productId));
    if (!product) return reply.status(404).send({ error: 'product not found' });
    return { product };
  });
  app.get('/api/brands/:id/catalog/source', async (req, reply) => {
    const brand = core.store.getBrand((req.params as any).id);
    if (!brand) return reply.status(404).send({ error: 'brand not found' });
    return { source: core.catalog.getSourceForBrand(brand.id) };
  });
  // A bounded look for a shop. Writes nothing: it answers how many products
  // a site appears to have and reads a couple of dozen as a preview, so the
  // person can see what they would be importing before anything is imported.
  app.post('/api/brands/:id/catalog/scan', async (req, reply) => {
    const brandId = (req.params as any).id;
    const brand = core.store.getBrand(brandId);
    if (!brand) return reply.status(404).send({ error: 'brand not found' });
    const url = String((req.body as any)?.url ?? (brand.json as any)?.meta?.website ?? '');
    if (!url.trim()) return reply.status(400).send({ error: 'url required' });
    try {
      return startCatalogScan({ core, fetchImpl }, brandId, url);
    } catch (err: any) {
      return reply.status(err.statusCode ?? 500).send({ error: err.message ?? 'scan failed' });
    }
  });
  app.get('/api/brands/:id/catalog/scans/:scanId', async (req, reply) => {
    const brandId = (req.params as any).id;
    const scan = getScan((req.params as any).scanId);
    if (!scan || scan.brandId !== brandId) return reply.status(404).send({ error: 'scan not found' });
    return scan;
  });
  // Details for a handful of products the chooser has scrolled to.
  //
  // Discovery hands back every product URL for free, because a sitemap is a
  // list of addresses. Turning an address into a card costs one page read, so
  // those are paid for as someone scrolls rather than all at once.
  app.post('/api/brands/:id/catalog/details', async (req, reply) => {
    const brand = core.store.getBrand((req.params as any).id);
    if (!brand) return reply.status(404).send({ error: 'brand not found' });
    const asked = (req.body as any)?.urls;
    if (!Array.isArray(asked) || asked.some((u) => typeof u !== 'string')) {
      return reply.status(400).send({ error: 'urls must be a list of product addresses' });
    }
    const urls = (asked as string[]).slice(0, 48);
    if (!urls.length) return { products: [] };
    // The origin comes from the brand's own website, never from the request.
    //
    // Taking it from the first url sent - which is what this did - made the
    // same-origin filter below self-referential: it proved the addresses
    // agreed with each other and nothing else, so a caller could hand over
    // `http://169.254.169.254/...` and have the server fetch it and hand the
    // contents back. The brand's website is the only origin this route has
    // any business reading.
    const site = String((brand.json as any)?.meta?.website ?? '');
    let origin: string;
    try {
      origin = new URL(site.startsWith('http') ? site : `https://${site}`).origin;
    } catch {
      return reply.status(400).send({ error: 'this brand has no website to read products from' });
    }
    const sameSite = urls.filter((u) => {
      try {
        return new URL(u).origin === origin;
      } catch {
        return false;
      }
    });
    if (!sameSite.length) {
      return reply.status(400).send({ error: 'none of those products belong to this site' });
    }
    // Measured against gymshark.com, the same sixteen warmed product pages at
    // each setting, milliseconds per page: 4 -> 276, 8 -> 180 and 159,
    // 12 -> 124, 16 -> 114 and 78. Fourteen of the sixteen parsed at every
    // setting, so the two that did not are those pages rather than pressure,
    // and reading harder costs nothing in what comes back.
    //
    // Twelve, with the studio holding at most two of these requests open at a
    // time, so a live shop sees at most twenty-four reads at once. That is the
    // politeness ceiling and it is the binding one: the curve was still
    // improving at sixteen.
    //
    // 512 KB rather than 1.5 MB. A card needs the title, one picture and a
    // price, and those are in the JSON-LD near the top: 345 ms a page at
    // 1.5 MB against 283 at 512 KB, with all eight products still parsed.
    // (128 KB parsed none of them, so the block does sit past that.)
    const products = await fetchProductPages({ fetchImpl: fetchImpl ?? fetch, baseUrl: origin }, sameSite, {
      concurrency: 12,
      maxBytes: 512_000,
    });
    return { products };
  });
  app.post('/api/brands/:id/catalog/import', async (req, reply) => {
    const brandId = (req.params as any).id;
    const brand = core.store.getBrand(brandId);
    if (!brand) return reply.status(404).send({ error: 'brand not found' });
    const url = String((req.body as any)?.url ?? (brand.json as any)?.meta?.website ?? '');
    if (!url.trim()) return reply.status(400).send({ error: 'url required' });
    // Given a chosen set, import exactly those pages. Given none, crawl the
    // catalog as before - the Products page has always meant the whole store.
    const asked = (req.body as any)?.urls;
    let only: string[] | undefined;
    if (asked != null) {
      if (!Array.isArray(asked) || asked.some((u) => typeof u !== 'string')) {
        return reply.status(400).send({ error: 'urls must be a list of product addresses' });
      }
      // Same origin as the store being imported, so a chosen list cannot
      // become a way to point the importer at somewhere else entirely.
      let origin: string;
      try {
        origin = new URL(url.startsWith('http') ? url : `https://${url}`).origin;
      } catch {
        return reply.status(400).send({ error: 'url required' });
      }
      only = (asked as string[]).filter((u) => {
        try {
          return new URL(u).origin === origin;
        } catch {
          return false;
        }
      });
      if (!only.length) return reply.status(400).send({ error: 'none of those products belong to this site' });
      // Truncating a chosen list silently drops products someone picked. Past
      // this many, importing the catalog outright is both cheaper and what
      // they meant, and the studio offers exactly that.
      if (only.length > 2000) {
        return reply.status(400).send({ error: 'That is nearly the whole catalogue. Import everything instead.' });
      }
    }
    try {
      return startCatalogImport({ core, fetchImpl }, brandId, url, { only });
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
