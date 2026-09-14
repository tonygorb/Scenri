import { detectPlatform, adapterFor } from './detect.js';
import { dedupeProducts } from './normalize.js';
import { normalizeStoreUrl, originOf } from './url.js';
import type {
  AdapterContext,
  CatalogAdapter,
  CatalogProduct,
  DetectResult,
  FetchImpl,
  ImportError,
  ImportStage,
  JobProgress,
  Platform,
} from './types.js';

export interface RunCatalogOptions {
  url: string;
  fetchImpl?: FetchImpl;
  signal?: AbortSignal;
  onProgress?: (p: JobProgress) => void;
}

export interface CatalogRunResult {
  baseUrl: string;
  detection: DetectResult;
  products: CatalogProduct[];
  progress: JobProgress;
}

/**
 * What a store said about itself, before a single product page was read.
 *
 * Split out of `runCatalogIngestion` so a caller can crawl the addresses in
 * batches and persist as it goes, rather than holding a whole catalogue in
 * memory to hand over at the end. `runCatalogIngestion` is the same function
 * it always was, built on this.
 */
export interface CatalogDiscovery {
  baseUrl: string;
  detection: DetectResult;
  adapter: CatalogAdapter;
  ctx: AdapterContext;
  /** Product page addresses, when the platform is discovered by crawling. */
  productUrls: string[];
  /** Identifiers the platform's own bulk API answers to, when there is one. */
  productKeys: string[];
  /**
   * Whether reading this catalogue means one page request per product.
   *
   * The adapter says so (`DiscoverResult.byPage`); this only adds that there
   * has to be something to crawl.
   */
  byPage: boolean;
  /** What the store claims to hold, which can exceed what discovery listed. */
  estimatedTotal: number;
  progress: JobProgress;
  /** Set when there is nothing to import; the caller decides how to say so. */
  empty: ImportError | null;
  /** Everything at once, for a platform whose catalogue is a JSON API rather than pages. */
  fetchAll(): Promise<CatalogProduct[]>;
  emit(patch: Partial<JobProgress> & { stage?: ImportStage }): void;
}

function baseProgress(platform: Platform = 'unknown'): JobProgress {
  return {
    stage: 'queued',
    platform,
    discovered: 0,
    fetched: 0,
    upserted: 0,
    imagesDone: 0,
    imagesTotal: 0,
    errors: [],
    warnings: [],
  };
}

/** Detect + discover. Reading the products is the caller's next move. */
export async function discoverCatalog(opts: RunCatalogOptions): Promise<CatalogDiscovery> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const progress = baseProgress();
  const emit = (patch: Partial<JobProgress> & { stage?: ImportStage }) => {
    Object.assign(progress, patch);
    opts.onProgress?.({ ...progress });
  };

  let baseUrl: string;
  try {
    baseUrl = normalizeStoreUrl(opts.url);
  } catch (err: any) {
    emit({ stage: 'failed', errors: [...progress.errors, { code: 'bad_url', message: String(err?.message ?? err) }] });
    throw err;
  }
  baseUrl = originOf(baseUrl);

  const ctx = {
    fetchImpl,
    baseUrl,
    signal: opts.signal,
    onProgress: (u: Partial<JobProgress>) => emit(u),
  };

  emit({ stage: 'discovering', message: 'Detecting store platform' });
  const detection = await detectPlatform(ctx);
  emit({
    platform: detection.platform,
    message: `Detected ${detection.platform}`,
    warnings: [...detection.signals.map((s) => `signal:${s}`)],
  });

  const adapter = adapterFor(detection.platform);
  let discovered: Awaited<ReturnType<typeof adapter.discover>>;
  try {
    discovered = await adapter.discover({ ...ctx, baseUrl: detection.baseUrl });
  } catch (err: any) {
    const error: ImportError = { code: 'discover_failed', message: String(err?.message ?? err) };
    emit({ stage: 'failed', errors: [...progress.errors, error] });
    throw err;
  }

  emit({
    stage: 'discovering',
    discovered: discovered.estimatedTotal ?? discovered.productUrls.length,
    warnings: [...progress.warnings, ...discovered.warnings],
    message: `Found ${discovered.estimatedTotal ?? discovered.productUrls.length} products`,
  });

  const estimatedTotal = discovered.estimatedTotal ?? discovered.productUrls.length;
  let empty: ImportError | null = null;
  if (!estimatedTotal) {
    empty = {
      code: 'empty_catalog',
      message:
        detection.platform === 'generic'
          ? 'No public product catalog found. This store may be JavaScript-rendered or require authentication.'
          : `No products discovered on this ${detection.platform} store.`,
    };
    emit({ stage: 'failed', errors: [...progress.errors, empty] });
  }

  return {
    baseUrl: detection.baseUrl,
    detection,
    adapter,
    ctx: { ...ctx, baseUrl: detection.baseUrl },
    productUrls: discovered.productUrls,
    productKeys: discovered.productKeys,
    byPage: (discovered.byPage ?? false) && discovered.productUrls.length > 0,
    estimatedTotal,
    progress,
    empty,
    emit,
    async fetchAll() {
      emit({ stage: 'fetching_products', message: 'Fetching product details' });
      try {
        return dedupeProducts(await adapter.fetchAll({ ...ctx, baseUrl: detection.baseUrl }, discovered));
      } catch (err: any) {
        emit({
          stage: 'partial',
          errors: [...progress.errors, { code: 'fetch_failed', message: String(err?.message ?? err), retryable: true }],
        });
        return [];
      }
    },
  };
}

/** Discover + fetch + normalize + dedupe. Persistence/assets are the caller's job. */
export async function runCatalogIngestion(opts: RunCatalogOptions): Promise<CatalogRunResult> {
  const d = await discoverCatalog(opts);
  const { detection, progress, emit } = d;
  if (d.empty) return { baseUrl: d.baseUrl, detection, products: [], progress };

  const products = await d.fetchAll();
  emit({
    stage: products.length ? 'fetching_products' : progress.stage,
    fetched: products.length,
    discovered: Math.max(progress.discovered, products.length),
    message: `Fetched ${products.length} products`,
  });

  if (!products.length) {
    // Two different facts, and they used to share a message. Nothing on a
    // site we never identified as a shop looked like a product: that is a
    // statement about the site, and a brand does not need one. A storefront
    // we DID identify, coming back with nothing, is a real problem and the
    // person who runs it needs to see it.
    const guessing = detection.platform === 'generic';
    emit({
      stage: 'failed',
      errors: [
        ...progress.errors,
        guessing
          ? { code: 'empty_catalog', message: 'No shop found on this site.' }
          : {
              code: 'no_products_fetched',
              message: `Found pages on this ${detection.platform} store but could not read a product from any of them. The store may be blocking automated readers.`,
            },
      ],
    });
  }

  return { baseUrl: detection.baseUrl, detection, products, progress };
}
