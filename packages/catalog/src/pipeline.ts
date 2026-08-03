import { detectPlatform, adapterFor } from './detect.js';
import { dedupeProducts } from './normalize.js';
import { normalizeStoreUrl, originOf } from './url.js';
import type {
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

/** Discover + fetch + normalize + dedupe. Persistence/assets are the caller's job. */
export async function runCatalogIngestion(opts: RunCatalogOptions): Promise<CatalogRunResult> {
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

  if (!(discovered.estimatedTotal ?? discovered.productUrls.length)) {
    emit({
      stage: 'failed',
      errors: [
        ...progress.errors,
        {
          code: 'empty_catalog',
          message:
            detection.platform === 'generic'
              ? 'No public product catalog found. This store may be JavaScript-rendered or require authentication.'
              : `No products discovered on this ${detection.platform} store.`,
        },
      ],
    });
    return { baseUrl: detection.baseUrl, detection, products: [], progress };
  }

  emit({ stage: 'fetching_products', message: 'Fetching product details' });
  let products: CatalogProduct[] = [];
  try {
    products = await adapter.fetchAll({ ...ctx, baseUrl: detection.baseUrl }, discovered);
  } catch (err: any) {
    emit({
      stage: 'partial',
      errors: [...progress.errors, { code: 'fetch_failed', message: String(err?.message ?? err), retryable: true }],
    });
  }

  products = dedupeProducts(products);
  emit({
    stage: products.length ? 'fetching_products' : progress.stage,
    fetched: products.length,
    discovered: Math.max(progress.discovered, products.length),
    message: `Fetched ${products.length} products`,
  });

  if (!products.length) {
    emit({
      stage: 'failed',
      errors: [
        ...progress.errors,
        { code: 'no_products_fetched', message: 'Discovery found URLs but no product payloads could be parsed.' },
      ],
    });
  }

  return { baseUrl: detection.baseUrl, detection, products, progress };
}
