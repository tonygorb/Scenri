import sharp from 'sharp';
import { runCatalogIngestion, mapPool, httpGet, normalizeStoreUrl, type JobProgress } from '@scenri/catalog';
import type { Core } from '@scenri/core';

export interface CatalogImportDeps {
  core: Core;
  fetchImpl?: typeof fetch;
}

const running = new Map<string, AbortController>();

export function cancelCatalogImport(jobId: string): boolean {
  const ctrl = running.get(jobId);
  if (!ctrl) return false;
  ctrl.abort();
  return true;
}

/** Start an async catalog import job. Returns immediately with the job id. */
export function startCatalogImport(deps: CatalogImportDeps, brandId: string, url: string): { jobId: string } {
  const { core } = deps;
  if (!core.store.getBrand(brandId)) throw Object.assign(new Error('brand not found'), { statusCode: 404 });

  let normalized: string;
  try {
    normalized = normalizeStoreUrl(url);
  } catch (err: any) {
    throw Object.assign(new Error(err?.message ?? 'invalid url'), { statusCode: 400 });
  }

  const job = core.catalog.createJob({ brandId, url: normalized });
  const ctrl = new AbortController();
  running.set(job.id, ctrl);

  void runJob(deps, job.id, brandId, normalized, ctrl.signal).finally(() => {
    running.delete(job.id);
  });

  return { jobId: job.id };
}

async function runJob(
  deps: CatalogImportDeps,
  jobId: string,
  brandId: string,
  url: string,
  signal: AbortSignal,
): Promise<void> {
  const { core, fetchImpl } = deps;
  const patch = (p: Parameters<typeof core.catalog.updateJob>[1]) => core.catalog.updateJob(jobId, p);

  try {
    patch({ stage: 'discovering', message: 'Detecting store platform' });

    const result = await runCatalogIngestion({
      url,
      fetchImpl,
      signal,
      onProgress: (p: JobProgress) => {
        patch({
          stage: p.stage === 'queued' ? 'discovering' : p.stage,
          platform: p.platform,
          discovered: p.discovered,
          fetched: p.fetched,
          warnings: p.warnings,
          errors: p.errors,
          message: p.message ?? null,
        });
      },
    });

    if (signal.aborted) {
      patch({ stage: 'failed', message: 'Import cancelled', finished: true });
      return;
    }

    const source = core.catalog.upsertSource(brandId, result.baseUrl, result.detection.platform);
    patch({ sourceId: source.id, platform: result.detection.platform });
    core.catalog.setSourceStatus(source.id, 'importing');

    if (!result.products.length) {
      const stage = result.progress.stage === 'failed' ? 'failed' : 'failed';
      patch({
        stage,
        errors: result.progress.errors,
        warnings: result.progress.warnings,
        message: result.progress.errors[0]?.message ?? 'No products imported',
        finished: true,
      });
      core.catalog.setSourceStatus(source.id, 'failed', true);
      return;
    }

    patch({ stage: 'fetching_products', fetched: result.products.length, message: 'Saving products' });
    let upserted = 0;
    const seenKeys: string[] = [];

    for (const p of result.products) {
      if (signal.aborted) break;
      core.catalog.upsertProduct({
        sourceId: source.id,
        brandId,
        externalKey: p.externalKey,
        title: p.title,
        descriptionHtml: p.descriptionHtml,
        url: p.url,
        handle: p.handle,
        vendor: p.vendor,
        productType: p.productType,
        tags: p.tags,
        category: p.category,
        price: p.price,
        compareAtPrice: p.compareAtPrice,
        currency: p.currency,
        available: p.available,
        raw: p.raw,
        variants: p.variants,
        images: (p.images ?? []).map((img) => ({
          sourceUrl: img.url,
          position: img.position,
          width: img.width,
          height: img.height,
          alt: img.alt,
        })),
        collections: (p.collections ?? []).map((c) => ({
          externalKey: c,
          title: c,
        })),
      });
      seenKeys.push(p.externalKey);
      upserted++;
      if (upserted % 10 === 0) patch({ upserted, fetched: result.products.length });
    }
    patch({ upserted, fetched: result.products.length });
    core.catalog.markMissingUnavailable(source.id, seenKeys);

    // Download images
    const pending = core.catalog.listImagesNeedingAssets(brandId, 50_000);
    patch({
      stage: 'processing_assets',
      imagesTotal: pending.length,
      imagesDone: 0,
      message: `Downloading ${pending.length} images`,
    });

    const errors = [...(core.catalog.getJob(jobId)?.errors ?? [])] as any[];
    let imagesDone = 0;

    await mapPool(
      pending,
      6,
      async (img) => {
        if (signal.aborted) return;
        try {
          const res = await httpGet(img.sourceUrl, { fetchImpl, signal, timeoutMs: 40_000, retries: 2 });
          if (!res.ok) {
            errors.push({ code: 'image_http', message: `HTTP ${res.status}`, url: img.sourceUrl });
            return;
          }
          const buf = Buffer.from(await res.arrayBuffer());
          if (!buf.length) {
            errors.push({ code: 'image_empty', message: 'Empty image', url: img.sourceUrl });
            return;
          }
          const png = await sharp(buf).rotate().png().toBuffer();
          const meta = await sharp(png).metadata();
          const hash = core.images.save(png);
          core.catalog.setImageAsset(img.productId, img.sourceUrl, `asset:${hash}`, {
            width: meta.width,
            height: meta.height,
          });
        } catch (err: any) {
          if (signal.aborted) return;
          errors.push({
            code: 'image_failed',
            message: String(err?.message ?? err),
            url: img.sourceUrl,
            retryable: true,
          });
        } finally {
          imagesDone++;
          if (imagesDone % 5 === 0 || imagesDone === pending.length) {
            patch({ imagesDone, imagesTotal: pending.length, errors });
          }
        }
      },
      signal,
    );

    if (signal.aborted) {
      patch({ stage: 'failed', message: 'Import cancelled', errors, finished: true });
      core.catalog.setSourceStatus(source.id, 'failed', true);
      return;
    }

    const stillMissing = core.catalog.listImagesNeedingAssets(brandId, 1).length;
    const productCount = result.products.length;
    const partial =
      !!errors.length ||
      stillMissing > 0 ||
      (result.progress.discovered > 0 && productCount < result.progress.discovered * 0.9);

    patch({
      stage: partial ? 'partial' : 'completed',
      upserted,
      imagesDone,
      imagesTotal: pending.length,
      errors,
      warnings: result.progress.warnings,
      message: partial
        ? `Imported ${upserted} products with ${errors.length} issue${errors.length === 1 ? '' : 's'}`
        : `Imported ${upserted} products`,
      finished: true,
    });
    core.catalog.setSourceStatus(source.id, partial ? 'partial' : 'ready', true);
  } catch (err: any) {
    patch({
      stage: 'failed',
      message: String(err?.message ?? err),
      errors: [{ code: 'import_failed', message: String(err?.message ?? err) }],
      finished: true,
    });
  }
}

/** Resolve a library product id (manual or cat-*) into generation-friendly shape. */
export function resolveLibraryProduct(
  core: Core,
  brandId: string,
  productId: string,
): {
  id: string;
  name: string;
  shots: { file: string; locked?: boolean }[];
} | null {
  const brand = core.store.getBrand(brandId);
  if (!brand) return null;
  const library = core.catalog.listLibraryProducts(brandId, brand.json);
  return library.find((p) => p.id === productId) ?? null;
}

export function brandJsonWithCatalogProducts(core: Core, brandId: string): any {
  const brand = core.store.getBrand(brandId);
  if (!brand) return null;
  const json = { ...(brand.json as any) };
  const library = core.catalog.listLibraryProducts(brandId, brand.json);
  // Present catalog + manual as products[] for brief compilation
  json.products = library.map((p) => ({
    id: p.id,
    name: p.name,
    shots: p.shots,
    notes: p.url ?? undefined,
    // Forwarded so the compiler can state real-world material and size. These
    // were dropped here, which is part of why a watch could render plate-sized:
    // nothing downstream ever knew how big the object actually is.
    ...(p.category ? { category: p.category } : {}),
    ...(p.variant ? { variant: p.variant } : {}),
    ...(p.material ? { material: p.material } : {}),
    ...(p.dimensions ? { dimensions: p.dimensions } : {}),
  }));
  return json;
}

/** How many imports are mid-flight — the update path refuses to restart over one. */
export function runningImportCount(): number {
  return running.size;
}
