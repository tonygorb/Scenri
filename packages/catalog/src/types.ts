export type Platform = 'shopify' | 'woocommerce' | 'webflow' | 'generic' | 'unknown';

export type ImportStage =
  | 'queued'
  | 'discovering'
  | 'fetching_products'
  | 'processing_assets'
  | 'completed'
  | 'partial'
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
}

export interface AdapterContext {
  fetchImpl: typeof fetch;
  baseUrl: string;
  signal?: AbortSignal;
  onProgress?: (update: Partial<JobProgress>) => void;
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
