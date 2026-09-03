import type { DB } from '../db.js';

export type CatalogPlatform = 'shopify' | 'woocommerce' | 'webflow' | 'generic' | 'unknown';
export type ImportStage =
  | 'queued'
  | 'discovering'
  | 'fetching_products'
  | 'processing_assets'
  | 'completed'
  | 'partial'
  | 'failed';

export interface CatalogSourceRow {
  id: string;
  brandId: string;
  url: string;
  platform: CatalogPlatform;
  status: string;
  lastImportAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CatalogProductRow {
  id: string;
  sourceId: string;
  brandId: string;
  externalKey: string;
  title: string;
  descriptionHtml: string | null;
  url: string;
  handle: string | null;
  vendor: string | null;
  productType: string | null;
  tags: string[];
  category: string | null;
  price: number | null;
  compareAtPrice: number | null;
  currency: string | null;
  available: boolean | null;
  status: 'active' | 'unavailable';
  raw: unknown;
  /** Set here, never by an import: the store has no column for any of them. */
  variant: string | null;
  material: string | null;
  dimensions: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CatalogVariantRow {
  id: string;
  productId: string;
  externalKey: string;
  title: string | null;
  sku: string | null;
  price: number | null;
  compareAtPrice: number | null;
  currency: string | null;
  available: boolean | null;
  options: Record<string, string>;
}

export interface CatalogImageRow {
  id: string;
  productId: string;
  sourceUrl: string;
  assetRef: string | null;
  width: number | null;
  height: number | null;
  position: number;
  alt: string | null;
  /** Which side of the object this shows, when it was added here rather than crawled. */
  angle: string | null;
  /** Taken out of the reference set by the user. Still here; just not used. */
  excluded: boolean;
}

export interface CatalogCollectionRow {
  id: string;
  sourceId: string;
  externalKey: string;
  title: string;
  url: string | null;
}

export interface ImportJobRow {
  id: string;
  brandId: string;
  sourceId: string | null;
  url: string;
  platform: CatalogPlatform;
  stage: ImportStage;
  discovered: number;
  fetched: number;
  upserted: number;
  imagesDone: number;
  imagesTotal: number;
  errors: unknown[];
  warnings: string[];
  message: string | null;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
}

/** Unified product shape for library + generation. */
export interface LibraryProduct {
  id: string;
  name: string;
  origin: 'manual' | 'catalog';
  url?: string | null;
  descriptionHtml?: string | null;
  vendor?: string | null;
  productType?: string | null;
  tags?: string[];
  category?: string | null;
  variant?: string | null;
  material?: string | null;
  dimensions?: string | null;
  price?: number | null;
  compareAtPrice?: number | null;
  currency?: string | null;
  available?: boolean | null;
  status?: string;
  /**
   * `angle` is the structured slot key (e.g. "three-quarter", "sole-detail")
   * that a brief can target; `alt` is free descriptive text. These used to be
   * collapsed into `alt`, which silently destroyed `angle` for every
   * user-uploaded product: the ProductPage checklist could never match a slot,
   * and compileBrief's angle selection could never fire outside demo products.
   */
  shots: {
    file: string;
    locked?: boolean;
    angle?: string | null;
    alt?: string | null;
    /** Added here rather than crawled — the only kind of imported image that is ours to delete. */
    local?: boolean;
  }[];
  /**
   * Store images the user took out of the set. Never sent to an engine, kept
   * so the page can offer them back — a colourway set arrives as one product,
   * and the ones that are the wrong colour have to go somewhere.
   */
  hiddenShots?: {
    file: string;
    locked?: boolean;
    angle?: string | null;
    alt?: string | null;
    local?: boolean;
  }[];
  variants?: CatalogVariantRow[];
}

export function rowSource(r: any): CatalogSourceRow {
  return {
    id: r.id,
    brandId: r.brand_id,
    url: r.url,
    platform: r.platform,
    status: r.status,
    lastImportAt: r.last_import_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function rowProduct(r: any): CatalogProductRow {
  return {
    id: r.id,
    sourceId: r.source_id,
    brandId: r.brand_id,
    externalKey: r.external_key,
    title: r.title,
    descriptionHtml: r.description_html,
    url: r.url,
    handle: r.handle,
    vendor: r.vendor,
    productType: r.product_type,
    tags: JSON.parse(r.tags || '[]'),
    category: r.category,
    price: r.price,
    compareAtPrice: r.compare_at_price,
    currency: r.currency,
    available: r.available == null ? null : !!r.available,
    status: r.status,
    raw: r.raw ? JSON.parse(r.raw) : null,
    variant: r.variant ?? null,
    material: r.material ?? null,
    dimensions: r.dimensions ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function rowJob(r: any): ImportJobRow {
  return {
    id: r.id,
    brandId: r.brand_id,
    sourceId: r.source_id,
    url: r.url,
    platform: r.platform,
    stage: r.stage,
    discovered: r.discovered,
    fetched: r.fetched,
    upserted: r.upserted,
    imagesDone: r.images_done,
    imagesTotal: r.images_total,
    errors: JSON.parse(r.errors || '[]'),
    warnings: JSON.parse(r.warnings || '[]'),
    message: r.message,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    finishedAt: r.finished_at,
  };
}

/* Row-level reads shared by the method groups, so no group calls another through `this`. */
export const jobById = (db: DB, id: string): ImportJobRow | null => {
  const r = db.prepare('SELECT * FROM import_jobs WHERE id=?').get(id) as any;
  return r ? rowJob(r) : null;
};
export const productById = (db: DB, id: string): CatalogProductRow | null => {
  const r = db.prepare('SELECT * FROM catalog_products WHERE id=?').get(id) as any;
  return r ? rowProduct(r) : null;
};
export const productsFor = (db: DB, brandId: string): CatalogProductRow[] =>
  (
    db
      .prepare(
        "SELECT * FROM catalog_products WHERE brand_id=? AND status!='unavailable' ORDER BY title COLLATE NOCASE",
      )
      .all(brandId) as any[]
  ).map(rowProduct);
export const rowVariant = (r: any): CatalogVariantRow => ({
  id: r.id,
  productId: r.product_id,
  externalKey: r.external_key,
  title: r.title,
  sku: r.sku,
  price: r.price,
  compareAtPrice: r.compare_at_price,
  currency: r.currency,
  available: r.available == null ? null : !!r.available,
  options: JSON.parse(r.options || '{}'),
});
export const rowImage = (r: any): CatalogImageRow => ({
  id: r.id,
  productId: r.product_id,
  sourceUrl: r.source_url,
  assetRef: r.asset_ref,
  width: r.width,
  height: r.height,
  position: r.position,
  alt: r.alt,
  angle: r.angle ?? null,
  excluded: !!r.excluded,
});
/** Every active product's variants in a brand, keyed by product, in one query. */
export const variantsForBrand = (db: DB, brandId: string): Map<string, CatalogVariantRow[]> => {
  const out = new Map<string, CatalogVariantRow[]>();
  const rows = db
    .prepare(
      `SELECT v.* FROM catalog_variants v JOIN catalog_products p ON p.id = v.product_id
        WHERE p.brand_id=? AND p.status!='unavailable' ORDER BY v.product_id, v.rowid`,
    )
    .all(brandId) as any[];
  for (const r of rows) {
    const list = out.get(r.product_id) ?? [];
    list.push(rowVariant(r));
    out.set(r.product_id, list);
  }
  return out;
};
/** Every active product's images in a brand, keyed by product and in position order, in one query. */
export const imagesForBrand = (db: DB, brandId: string): Map<string, CatalogImageRow[]> => {
  const out = new Map<string, CatalogImageRow[]>();
  const rows = db
    .prepare(
      `SELECT i.* FROM catalog_images i JOIN catalog_products p ON p.id = i.product_id
        WHERE p.brand_id=? AND p.status!='unavailable' ORDER BY i.product_id, i.position`,
    )
    .all(brandId) as any[];
  for (const r of rows) {
    const list = out.get(r.product_id) ?? [];
    list.push(rowImage(r));
    out.set(r.product_id, list);
  }
  return out;
};
export const variantsFor = (db: DB, productId: string): CatalogVariantRow[] =>
  (db.prepare('SELECT * FROM catalog_variants WHERE product_id=?').all(productId) as any[]).map((r) => ({
    id: r.id,
    productId: r.product_id,
    externalKey: r.external_key,
    title: r.title,
    sku: r.sku,
    price: r.price,
    compareAtPrice: r.compare_at_price,
    currency: r.currency,
    available: r.available == null ? null : !!r.available,
    options: JSON.parse(r.options || '{}'),
  }));
export const imagesFor = (db: DB, productId: string): CatalogImageRow[] =>
  (db.prepare('SELECT * FROM catalog_images WHERE product_id=? ORDER BY position').all(productId) as any[]).map(
    (r) => ({
      id: r.id,
      productId: r.product_id,
      sourceUrl: r.source_url,
      assetRef: r.asset_ref,
      width: r.width,
      height: r.height,
      position: r.position,
      alt: r.alt,
      angle: r.angle ?? null,
      excluded: !!r.excluded,
    }),
  );
