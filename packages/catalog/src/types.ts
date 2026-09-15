export type Platform = 'shopify' | 'woocommerce' | 'webflow' | 'generic' | 'unknown';

export type ImportStage =
  | 'queued'
  | 'discovering'
  | 'fetching_products'
  | 'processing_assets'
  | 'completed'
  | 'partial'
  | 'cancelled'
  | 'failed';

export interface CatalogVariant {
  externalKey: string;
  title?: string;
  sku?: string | null;
  price?: number | null;
  compareAtPrice?: number | null;
  currency?: string | null;
  available?: boolean | null;
  options?: Record<string, string>;
}

export interface CatalogImage {
  url: string;
  position: number;
  width?: number | null;
  height?: number | null;
  alt?: string | null;
}

export interface CatalogProduct {
  externalKey: string;
  title: string;
  descriptionHtml?: string | null;
  url: string;
  handle?: string | null;
  vendor?: string | null;
  productType?: string | null;
  tags?: string[];
  category?: string | null;
  price?: number | null;
  compareAtPrice?: number | null;
  currency?: string | null;
  available?: boolean | null;
  variants?: CatalogVariant[];
  images?: CatalogImage[];
  collections?: string[];
  raw?: unknown;
}

export interface CatalogCollection {
  externalKey: string;
  title: string;
  url?: string | null;
  productKeys: string[];
}

export interface DetectResult {
  platform: Platform;
  confidence: number;
  baseUrl: string;
  signals: string[];
}

export interface DiscoverResult {
  productKeys: string[];
  productUrls: string[];
  estimatedTotal: number | null;
  collections?: CatalogCollection[];
  warnings: string[];
  /**
   * What discovery learned that changes how fetching should work.
   *
   * `json-blocked` means the platform's own product API answered but refused
   * us, so the per-product API calls it would normally make are a wasted
   * request each - 2202 of them, in the case this was written for.
   */
  hints?: string[];
  /**
   * Whether reading this catalogue means one page request per product.
   *
   * True for a sitemap crawl, and for a Shopify store whose `products.json`
   * refused us (gymshark.com does). Those runs take minutes, so the caller
   * reads them in batches and writes each one down before asking for the next:
   * products appear while the import is still going, and the heap never holds
   * a whole catalogue. False for a platform answering its own bulk API, where
   * the catalogue is a handful of paged requests and already bounded.
   */
  byPage?: boolean;
}

export interface AdapterContext {
  fetchImpl: typeof fetch;
  baseUrl: string;
  signal?: AbortSignal;
  onProgress?: (update: Partial<JobProgress>) => void;
  /**
   * `Date.now()` past which discovery stops listing and works with what it has.
   *
   * The scan has always had a budget, but it only ever reached the page reads:
   * detection and discovery ran unbounded underneath it, so a store whose
   * catalogue was slow to list could spend minutes before the budget was
   * consulted once. A partial list is a result; an open-ended wait is not.
   */
  deadline?: number;
}

export interface JobProgress {
  stage: ImportStage;
  platform: Platform;
  discovered: number;
  fetched: number;
  upserted: number;
  imagesDone: number;
  imagesTotal: number;
  errors: ImportError[];
  warnings: string[];
  message?: string;
}

export interface ImportError {
  code: string;
  message: string;
  url?: string;
  externalKey?: string;
  retryable?: boolean;
}

export interface CatalogAdapter {
  platform: Exclude<Platform, 'unknown'>;
  detect(ctx: AdapterContext): Promise<DetectResult | null>;
  discover(ctx: AdapterContext): Promise<DiscoverResult>;
  fetchAll(ctx: AdapterContext, discovered: DiscoverResult): Promise<CatalogProduct[]>;
}

export type FetchImpl = typeof fetch;

/**
 * What a bounded look at a website concluded about commerce.
 *
 * Deliberately not a boolean. "No products" and "a shop we could not read"
 * are different facts that need different words on screen, and reporting the
 * second as the first is how a working store came to ring a red bell.
 */
export type CommerceVerdict = 'none' | 'found' | 'likely' | 'blocked';

/** Where a product count came from, because a count that lies is worse than none. */
export type CountSource = 'api' | 'sitemap' | 'listing' | 'preview' | 'none';

export interface ScanBudget {
  /** Product pages actually read. The count never costs this. */
  maxPreviewPages: number;
  maxBytesPerPage: number;
  maxTotalBytes: number;
  budgetMs: number;
  concurrency: number;
  /** Time the preview is owed even when discovery has spent the whole budget. */
  previewFloorMs: number;
}

export interface ScanResult {
  baseUrl: string;
  platform: Platform;
  signals: string[];
  verdict: CommerceVerdict;
  /** How many products the site appears to have, which is not how many were read. */
  count: number;
  countSource: CountSource;
  /** Read and parsed: a preview, never the catalog. */
  candidates: CatalogProduct[];
  /** Every product URL discovery found, so an import need not discover again. */
  candidateUrls: string[];
  /** True when there is more catalog than the preview shows. */
  truncated: boolean;
  warnings: string[];
  /** What the look actually cost: pages requested, bytes kept, wall clock. */
  spent: { pages: number; bytes: number; ms: number };
}
