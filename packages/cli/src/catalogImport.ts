import sharp from 'sharp';
import {
  runCatalogIngestion,
  mapPool,
  httpGet,
  normalizeStoreUrl,
  detectPlatform,
  dedupeProducts,
  fetchProductPages,
  type CatalogProduct,
  type JobProgress,
  type Platform,
} from '@scenri/catalog';
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

export interface StartImportOptions {
  /**
   * Import exactly these product pages instead of discovering a catalog.
   *
   * This is how a chosen set of candidates becomes products: the same job,
   * the same writer, no second path and no second model.
   */
  only?: string[];
}

/** Start an async catalog import job. Returns immediately with the job id. */
export function startCatalogImport(
  deps: CatalogImportDeps,
  brandId: string,
  url: string,
  opts: StartImportOptions = {},
): { jobId: string } {
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

  void runJob(deps, job.id, brandId, normalized, ctrl.signal, opts.only).finally(() => {
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
  only?: string[],
): Promise<void> {
  const { core, fetchImpl } = deps;
  const patch = (p: Parameters<typeof core.catalog.updateJob>[1]) => core.catalog.updateJob(jobId, p);

  try {
    // A chosen set of products skips discovery entirely: the pages are
    // already known, and re-crawling a store to find what someone just
    // pointed at would be both slower and ruder.
    if (only?.length) {
      patch({ stage: 'fetching_products', message: `Importing ${only.length} products`, discovered: only.length });
      const ctx = { fetchImpl: fetchImpl ?? fetch, baseUrl: url, signal };
      const detection = await detectPlatform(ctx);
      const products = dedupeProducts(
        await fetchProductPages(ctx, only, {
          concurrency: 4,
          maxBytes: 1_500_000,
          onProduct: (fetched) => patch({ fetched }),
        }),
      );
      if (!products.length) {
        patch({
          stage: 'failed',
          message: 'None of the chosen products could be read',
          errors: [{ code: 'no_products_fetched', message: 'None of the chosen products could be read' }],
          finished: true,
        });
        return;
      }
      await persistProducts(deps, jobId, brandId, url, detection.platform, products, {
        discovered: only.length,
        warnings: [],
        signal,
        // Never sweep a selective import. `markMissingUnavailable` flags
        // everything outside this batch as gone, which is right for a full
        // catalog refresh and destructive when someone imports twelve
        // products and then twelve more.
        sweep: false,
      });
      return;
    }

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

    if (!result.products.length) {
      const source = core.catalog.upsertSource(brandId, result.baseUrl, result.detection.platform);
      patch({ sourceId: source.id, platform: result.detection.platform });
      // Two different outcomes, and they used to be the same one. Nothing
      // discoverable means there is no shop here, which is a fact about the
      // site and not a fault: a portfolio, an agency page or a company
      // homepage is a perfectly good brand source. URLs that WERE found and
      // then would not parse is a real failure, and a shop owner needs to see
      // it. (The line this replaces read `x === 'failed' ? 'failed' : 'failed'`
      // - someone meant to make this distinction and it collapsed.)
      const noShop = result.progress.errors.some((e) => e.code === 'empty_catalog');
      patch({
        stage: noShop ? 'no_catalog' : 'failed',
        errors: noShop ? [] : result.progress.errors,
        warnings: result.progress.warnings,
        message: noShop ? 'No shop found on this site' : (result.progress.errors[0]?.message ?? 'No products imported'),
        finished: true,
      });
      core.catalog.setSourceStatus(source.id, noShop ? 'empty' : 'failed', true);
      return;
    }

    await persistProducts(deps, jobId, brandId, result.baseUrl, result.detection.platform, result.products, {
      discovered: result.progress.discovered,
      warnings: result.progress.warnings,
      signal,
      sweep: true,
    });
  } catch (err: any) {
    patch({
      stage: 'failed',
      message: String(err?.message ?? err),
      errors: [{ code: 'import_failed', message: String(err?.message ?? err) }],
      finished: true,
    });
  }
}

interface PersistOptions {
  discovered: number;
  warnings: string[];
  signal: AbortSignal;
  /**
   * Whether products absent from this batch should be marked unavailable.
   *
   * True for a full catalog run, where an item that has vanished from the
   * store has genuinely gone. False for a selective import, where everything
   * the person did not tick this time is still perfectly real.
   */
  sweep: boolean;
}

/**
 * Write products, fetch their pictures, and finish the job.
 *
 * The canonical boundary: `upsertProduct` is the only writer of catalog rows
 * on this path, and images land locally as content-addressed PNGs, so nothing
 * saved here depends on the source site still being up.
 */
async function persistProducts(
  deps: CatalogImportDeps,
  jobId: string,
  brandId: string,
  baseUrl: string,
  platform: Platform,
  products: CatalogProduct[],
  opts: PersistOptions,
): Promise<void> {
  const { core, fetchImpl } = deps;
  const { signal } = opts;
  const patch = (p: Parameters<typeof core.catalog.updateJob>[1]) => core.catalog.updateJob(jobId, p);

  const source = core.catalog.upsertSource(brandId, baseUrl, platform);
  patch({ sourceId: source.id, platform });
  core.catalog.setSourceStatus(source.id, 'importing');

  patch({ stage: 'fetching_products', fetched: products.length, message: 'Saving products' });
  let upserted = 0;
  const seenKeys: string[] = [];

  for (const p of products) {
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
    if (upserted % 10 === 0) patch({ upserted, fetched: products.length });
  }
  patch({ upserted, fetched: products.length });
  if (opts.sweep) core.catalog.markMissingUnavailable(source.id, seenKeys);

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
  const partial =
    !!errors.length || stillMissing > 0 || (opts.discovered > 0 && products.length < opts.discovered * 0.9);

  patch({
    stage: partial ? 'partial' : 'completed',
    upserted,
    imagesDone,
    imagesTotal: pending.length,
    errors,
    warnings: opts.warnings,
    message: partial
      ? `Imported ${upserted} products with ${errors.length} issue${errors.length === 1 ? '' : 's'}`
      : `Imported ${upserted} products`,
    finished: true,
  });
  core.catalog.setSourceStatus(source.id, partial ? 'partial' : 'ready', true);
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

/** The store's HTML description, flattened to prompt-safe prose. */
function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The opening sentence, or a clean truncation when the first one runs long. */
function firstSentence(text: string, max: number): string {
  if (text.length <= max) return text;
  const stop = text.slice(0, max + 1).search(/[.!?](\s|$)/);
  if (stop > 40) return text.slice(0, stop + 1);
  const cut = text.lastIndexOf(' ', max);
  return `${text.slice(0, cut > 40 ? cut : max).trimEnd()}\u2026`;
}

/**
 * The distinct colour names a product's variants declare, in store order.
 * Only meaningful from two up: one colour is not a colorway story, and a
 * store with no colour option contributes nothing.
 */
function colorwaysOf(variants: { options?: Record<string, string> }[] | undefined): string[] {
  const seen: string[] = [];
  for (const v of variants ?? []) {
    const key = Object.keys(v.options ?? {}).find((k) => /colou?r/i.test(k));
    const val = key ? String((v.options as Record<string, string>)[key]).trim() : '';
    if (val && !seen.includes(val)) seen.push(val);
    if (seen.length >= 12) break;
  }
  return seen.length >= 2 ? seen : [];
}

export function brandJsonWithCatalogProducts(core: Core, brandId: string): any {
  const brand = core.store.getBrand(brandId);
  if (!brand) return null;
  const json = { ...(brand.json as any) };
  const library = core.catalog.listLibraryProducts(brandId, brand.json);
  // Present catalog + manual as products[] for brief compilation
  json.products = library.map((p) => {
    const colorways = colorwaysOf((p as any).variants);
    return {
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
      // The store's own words, the way the 0.6.9 fix gave demo products
      // theirs: the description is what anchors scale when dimensions are
      // absent, and imported products shipped with neither.
      ...((p as any).descriptionHtml
        ? { description: firstSentence(stripHtml(String((p as any).descriptionHtml)), 300) }
        : {}),
      // The declared colorways, so the compiler can say a colour difference
      // between references is a colorway rather than lighting.
      ...(colorways.length ? { colorways } : {}),
    };
  });
  return json;
}

/** How many imports are mid-flight — the update path refuses to restart over one. */
export function runningImportCount(): number {
  return running.size;
}
