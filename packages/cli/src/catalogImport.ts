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
  type ImportStage,
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
      // In batches, so the products show up as they arrive rather than all at
      // the end. Reading 2,199 gymshark pages is about sixteen minutes, and
      // fetching every one before writing a single row is how the task came to
      // read "0 of 2,199" for the whole of it.
      patch({ stage: 'fetching_products', message: `Importing ${only.length} products`, discovered: only.length });
      const ctx = { fetchImpl: fetchImpl ?? fetch, baseUrl: url, signal };
      const detection = await detectPlatform(ctx);
      const tally: Tally = { fetched: 0, upserted: 0, imagesDone: 0, imagesTotal: 0, errors: [] };
      let readAny = false;

      for (let at = 0; at < only.length; ) {
        if (signal.aborted) break;
        const size = at === 0 ? Math.min(FIRST_BATCH, only.length) : IMPORT_BATCH;
        const slice = only.slice(at, at + size);
        at += size;
        const products = dedupeProducts(
          await fetchProductPages(ctx, slice, {
            concurrency: 4,
            maxBytes: 1_500_000,
            onProduct: (n) => {
              if (n % 10 === 0) patch({ fetched: tally.fetched + n });
            },
          }),
        );
        if (!products.length) continue;
        readAny = true;
        await persistProducts(deps, jobId, brandId, url, detection.platform, products, {
          discovered: only.length,
          warnings: [],
          signal,
          // Never sweep a chosen set. `markMissingUnavailable` flags everything
          // outside this batch as gone, which is right for a full catalog
          // refresh and destructive when someone imports twelve products and
          // then twelve more.
          sweep: false,
          tally,
          finalize: at >= only.length,
        });
      }

      if (signal.aborted) return;
      if (!readAny) {
        patch({
          stage: 'failed',
          message: 'None of the chosen products could be read',
          errors: [{ code: 'no_products_fetched', message: 'None of the chosen products could be read' }],
          finished: true,
        });
      }
      return;
    }

    patch({ stage: 'discovering', message: 'Detecting store platform' });

    // The adapters emit once per product fetched, and `updateJob` rewrites the
    // whole row, so a 2203-product store used to mean 2203 row writes. A stage
    // change or a message is always worth recording; a bare count is worth it
    // every tenth.
    let lastStage = '';
    let lastMessage: string | null = null;
    // The high-water mark, because aborting `fetchAll` throws away the
    // products it had and the pipeline's closing emit then reports zero.
    let mostRead = 0;
    const result = await runCatalogIngestion({
      url,
      fetchImpl,
      signal,
      onProgress: (p: JobProgress) => {
        // Progress never ends a job. The pipeline reports `partial` mid-run
        // when a fetch fails and then carries on, and writing that through
        // closed the job where it stood: `finished_at` set, counters frozen,
        // and the real ending - cancelled, completed - refused as a write to
        // an already-finished row. How a run ends is decided below, once.
        const reported = p.stage === 'queued' ? 'discovering' : p.stage;
        const stage: ImportStage = TERMINAL.has(reported) ? 'fetching_products' : reported;
        const message = p.message ?? null;
        mostRead = Math.max(mostRead, p.fetched);
        const notable = stage !== lastStage || message !== lastMessage || p.fetched % 10 === 0;
        if (!notable) return;
        lastStage = stage;
        lastMessage = message;
        patch({
          stage,
          platform: p.platform,
          discovered: p.discovered,
          fetched: p.fetched,
          warnings: p.warnings,
          errors: p.errors,
          message,
        });
      },
    });

    if (signal.aborted) {
      // Aborting mid-fetch makes the pipeline throw `fetch_failed: aborted`
      // and then conclude `no_products_fetched`, which reads as "this store
      // could not be read" about a store that was answering perfectly. Both
      // describe the stop, not the site, so neither is kept.
      patch({
        stage: 'cancelled',
        fetched: mostRead,
        errors: [],
        message: mostRead ? `Stopped after reading ${mostRead} products` : 'Stopped before anything was saved',
        finished: true,
      });
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
    // Stopping during discovery throws out of the pipeline, and the throw is
    // the stop rather than a fault of the site's.
    if (signal.aborted) {
      patch({ stage: 'cancelled', errors: [], message: 'Stopped before anything was saved', finished: true });
      return;
    }
    patch({
      stage: 'failed',
      message: String(err?.message ?? err),
      errors: [{ code: 'import_failed', message: String(err?.message ?? err) }],
      finished: true,
    });
  }
}

/**
 * How many pictures of one product are worth keeping on this machine.
 *
 * Measured on gymshark.com: a product page offers about eleven images, and
 * Scenri re-encodes each to PNG, which turns a 262 KB source JPEG into 2.8 MB.
 * The whole catalog at eleven each is 24,233 images and roughly 70 GB. Three
 * is a front, a back and a detail - enough to recognise and to shoot with -
 * and the rest of the URLs stay recorded, so a product can be filled out later
 * without crawling the store again.
 */
export const IMAGES_PER_PRODUCT = 3;

/**
 * Products read and written per round of a chosen import.
 *
 * Small enough that the first ones appear within a few seconds of a large
 * store, big enough that the per-batch bookkeeping is not the cost.
 */
/** Stages that mean a job is over. Only `runJob` may write one. */
const TERMINAL: ReadonlySet<string> = new Set(['completed', 'partial', 'no_catalog', 'cancelled', 'failed']);

const IMPORT_BATCH = 25;

/**
 * The first round is small, so the first products land in seconds.
 *
 * Time to the first visible product matters more than total time: a wall that
 * starts filling at three seconds reads as alive, and the same import behind
 * one twenty-five-page round does not.
 */
const FIRST_BATCH = 5;

/**
 * What a job has done so far, across however many batches it takes.
 *
 * A 2,200-product store is about sixteen minutes of reading, and the old shape
 * fetched every page before writing a single row - so the task said "0 of
 * 2,199" for the whole of it and nothing appeared on the products page until
 * the end. Batches share this, and each one writes.
 */
interface Tally {
  fetched: number;
  upserted: number;
  imagesDone: number;
  imagesTotal: number;
  errors: unknown[];
}

interface PersistOptions {
  discovered: number;
  /** Accumulated across batches; a single-batch run just passes a fresh one. */
  tally?: Tally;
  /** False while more batches are coming, so the job is not closed early. */
  finalize?: boolean;
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
  /** Pictures kept per product. Defaults to `IMAGES_PER_PRODUCT`. */
  imagesPerProduct?: number;
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
  const tally = opts.tally ?? { fetched: 0, upserted: 0, imagesDone: 0, imagesTotal: 0, errors: [] };
  const finalize = opts.finalize ?? true;
  const patch = (p: Parameters<typeof core.catalog.updateJob>[1]) => core.catalog.updateJob(jobId, p);

  const source = core.catalog.upsertSource(brandId, baseUrl, platform);
  patch({ sourceId: source.id, platform });
  core.catalog.setSourceStatus(source.id, 'importing');

  tally.fetched += products.length;
  patch({ stage: 'fetching_products', fetched: tally.fetched, message: 'Saving products' });
  let upserted = tally.upserted;
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
      // `raw` is the whole crawled payload, 14.2 KB a product on gymshark and
      // 32 MB across its catalog, written to sqlite and read back by nothing.
      raw: null,
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
    if (upserted % 10 === 0) patch({ upserted, fetched: tally.fetched });
  }
  tally.upserted = upserted;
  patch({ upserted, fetched: tally.fetched });
  if (opts.sweep) core.catalog.markMissingUnavailable(source.id, seenKeys);

  // Download images, the first few of each product only.
  //
  // Capped on the image's own position rather than by counting as we go. A
  // running count is per call, so the second batch of an import saw the images
  // the first batch had deliberately skipped as fresh work and fetched them -
  // forty products asked for 170 pictures instead of 120. Position is a fact
  // about the image, so it says the same thing on every batch and on every
  // re-import.
  const cap = opts.imagesPerProduct ?? IMAGES_PER_PRODUCT;
  const pending = core.catalog.listImagesNeedingAssets(brandId, 50_000).filter((img) => img.position < cap);
  const errors = [...(core.catalog.getJob(jobId)?.errors ?? [])] as any[];
  const imagesBefore = tally.imagesDone;
  tally.imagesTotal += pending.length;
  let imagesDone = 0;
  // Counted across the whole import, not per batch. Reporting this batch's own
  // numbers made the row jump back to 0 of 25 every time a new one started.
  patch({
    stage: 'processing_assets',
    imagesTotal: tally.imagesTotal,
    imagesDone: tally.imagesDone,
    message: `Downloading ${tally.imagesTotal.toLocaleString()} images`,
  });

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
        // Keep the bytes the store served.
        //
        // This re-encoded every picture to PNG, which turned a 269 KB jpeg into
        // 2.90 MB: gymshark's 6,603 pictures were 19.1 GB on disk and 1.9
        // minutes of encoding, for a format nothing asks for. Display reads the
        // WebP thumbnail derivative and generation reads the file through
        // sharp, which sniffs whatever it finds.
        //
        // `metadata()` is also the validation: bytes that are not a picture
        // throw here, exactly as the decode used to.
        const probe = await sharp(buf).metadata();
        const turned = (probe.orientation ?? 1) > 1;
        // The one case worth paying for: an EXIF-rotated photograph looks wrong
        // everywhere if the bytes are kept as they are.
        const keep = turned ? await sharp(buf).rotate().toBuffer() : buf;
        const meta = turned ? await sharp(keep).metadata() : probe;
        const hash = core.images.save(keep, meta.format ?? probe.format ?? 'png');
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
        tally.imagesDone = imagesBefore + imagesDone;
        if (imagesDone % 5 === 0 || imagesDone === pending.length) {
          patch({ imagesDone: tally.imagesDone, imagesTotal: tally.imagesTotal, errors });
        }
      }
    },
    signal,
  );

  if (signal.aborted) {
    // Stopping something you started is not a failure, and a red row for it
    // reads as one. The products already written stay written.
    patch({ stage: 'cancelled', message: `Stopped after ${upserted} products`, errors, finished: true });
    core.catalog.setSourceStatus(source.id, 'partial', true);
    return;
  }

  tally.errors = errors;
  if (!finalize) {
    // More batches to come: record what this one did and leave the job open.
    patch({ upserted, fetched: tally.fetched, imagesDone: tally.imagesDone, imagesTotal: tally.imagesTotal, errors });
    core.catalog.setSourceStatus(source.id, 'importing');
    return;
  }

  // Deliberately not `listImagesNeedingAssets` again: the images this run
  // chose to skip are not missing, they are the ones past the cap.
  const stillMissing = pending.filter((img) => !img.assetRef).length - imagesDone;
  const partial =
    !!errors.length || stillMissing > 0 || (opts.discovered > 0 && tally.upserted < opts.discovered * 0.9);

  patch({
    stage: partial ? 'partial' : 'completed',
    upserted,
    imagesDone: tally.imagesDone,
    imagesTotal: tally.imagesTotal,
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
