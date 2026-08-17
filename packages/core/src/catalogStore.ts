import { randomUUID } from 'node:crypto';
import type { DB } from './db.js';

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

function rowSource(r: any): CatalogSourceRow {
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

function rowProduct(r: any): CatalogProductRow {
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

function rowJob(r: any): ImportJobRow {
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

export function createCatalogStore(db: DB) {
  return {
    upsertSource(brandId: string, url: string, platform: CatalogPlatform): CatalogSourceRow {
      const existing = db.prepare('SELECT * FROM catalog_sources WHERE brand_id=? AND url=?').get(brandId, url) as any;
      if (existing) {
        db.prepare("UPDATE catalog_sources SET platform=?, updated_at=datetime('now') WHERE id=?").run(
          platform,
          existing.id,
        );
        return rowSource(db.prepare('SELECT * FROM catalog_sources WHERE id=?').get(existing.id));
      }
      const id = randomUUID();
      db.prepare("INSERT INTO catalog_sources (id, brand_id, url, platform, status) VALUES (?,?,?,?, 'idle')").run(
        id,
        brandId,
        url,
        platform,
      );
      return rowSource(db.prepare('SELECT * FROM catalog_sources WHERE id=?').get(id));
    },

    getSourceForBrand(brandId: string): CatalogSourceRow | null {
      const r = db
        .prepare('SELECT * FROM catalog_sources WHERE brand_id=? ORDER BY updated_at DESC LIMIT 1')
        .get(brandId) as any;
      return r ? rowSource(r) : null;
    },

    getSource(id: string): CatalogSourceRow | null {
      const r = db.prepare('SELECT * FROM catalog_sources WHERE id=?').get(id) as any;
      return r ? rowSource(r) : null;
    },

    setSourceStatus(id: string, status: string, touchImport = false): void {
      if (touchImport) {
        db.prepare(
          "UPDATE catalog_sources SET status=?, last_import_at=datetime('now'), updated_at=datetime('now') WHERE id=?",
        ).run(status, id);
      } else {
        db.prepare("UPDATE catalog_sources SET status=?, updated_at=datetime('now') WHERE id=?").run(status, id);
      }
    },

    createJob(input: {
      brandId: string;
      sourceId?: string | null;
      url: string;
      platform?: CatalogPlatform;
    }): ImportJobRow {
      const id = randomUUID();
      db.prepare(
        `INSERT INTO import_jobs (id, brand_id, source_id, url, platform, stage)
         VALUES (?,?,?,?,?,'queued')`,
      ).run(id, input.brandId, input.sourceId ?? null, input.url, input.platform ?? 'unknown');
      return this.getJob(id)!;
    },

    getJob(id: string): ImportJobRow | null {
      const r = db.prepare('SELECT * FROM import_jobs WHERE id=?').get(id) as any;
      return r ? rowJob(r) : null;
    },

    listJobs(brandId: string): ImportJobRow[] {
      return (
        db.prepare('SELECT * FROM import_jobs WHERE brand_id=? ORDER BY created_at DESC').all(brandId) as any[]
      ).map(rowJob);
    },

    updateJob(
      id: string,
      patch: Partial<{
        sourceId: string | null;
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
        finished: boolean;
      }>,
    ): ImportJobRow | null {
      const cur = this.getJob(id);
      if (!cur) return null;
      const stage = patch.stage ?? cur.stage;
      const finished = patch.finished || stage === 'completed' || stage === 'partial' || stage === 'failed';
      db.prepare(
        `UPDATE import_jobs SET
          source_id=?, platform=?, stage=?, discovered=?, fetched=?, upserted=?,
          images_done=?, images_total=?, errors=?, warnings=?, message=?,
          updated_at=datetime('now'),
          finished_at=CASE WHEN ? THEN COALESCE(finished_at, datetime('now')) ELSE finished_at END
         WHERE id=?`,
      ).run(
        patch.sourceId !== undefined ? patch.sourceId : cur.sourceId,
        patch.platform ?? cur.platform,
        stage,
        patch.discovered ?? cur.discovered,
        patch.fetched ?? cur.fetched,
        patch.upserted ?? cur.upserted,
        patch.imagesDone ?? cur.imagesDone,
        patch.imagesTotal ?? cur.imagesTotal,
        JSON.stringify(patch.errors ?? cur.errors),
        JSON.stringify(patch.warnings ?? cur.warnings),
        patch.message !== undefined ? patch.message : cur.message,
        finished ? 1 : 0,
        id,
      );
      return this.getJob(id);
    },

    upsertProduct(input: {
      sourceId: string;
      brandId: string;
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
      raw?: unknown;
      variants?: {
        externalKey: string;
        title?: string;
        sku?: string | null;
        price?: number | null;
        compareAtPrice?: number | null;
        currency?: string | null;
        available?: boolean | null;
        options?: Record<string, string>;
      }[];
      images?: {
        sourceUrl: string;
        assetRef?: string | null;
        width?: number | null;
        height?: number | null;
        position: number;
        alt?: string | null;
      }[];
      collections?: { externalKey: string; title: string; url?: string | null }[];
    }): CatalogProductRow {
      const existing = db
        .prepare('SELECT id FROM catalog_products WHERE source_id=? AND external_key=?')
        .get(input.sourceId, input.externalKey) as { id: string } | undefined;

      const id = existing?.id ?? randomUUID();
      if (existing) {
        db.prepare(
          // `category` is deliberately absent. The store's own taxonomy is
          // `product_type`; `category` is this app's field, set by the user on
          // the product page, and a re-import used to silently revert it.
          `UPDATE catalog_products SET
            title=?, description_html=?, url=?, handle=?, vendor=?, product_type=?, tags=?,
            price=?, compare_at_price=?, currency=?, available=?, status='active', raw=?,
            updated_at=datetime('now')
           WHERE id=?`,
        ).run(
          input.title,
          input.descriptionHtml ?? null,
          input.url,
          input.handle ?? null,
          input.vendor ?? null,
          input.productType ?? null,
          JSON.stringify(input.tags ?? []),
          input.price ?? null,
          input.compareAtPrice ?? null,
          input.currency ?? null,
          input.available == null ? null : input.available ? 1 : 0,
          JSON.stringify(input.raw ?? null),
          id,
        );
      } else {
        db.prepare(
          `INSERT INTO catalog_products (
            id, source_id, brand_id, external_key, title, description_html, url, handle, vendor,
            product_type, tags, category, price, compare_at_price, currency, available, status, raw
          ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'active', ?)`,
        ).run(
          id,
          input.sourceId,
          input.brandId,
          input.externalKey,
          input.title,
          input.descriptionHtml ?? null,
          input.url,
          input.handle ?? null,
          input.vendor ?? null,
          input.productType ?? null,
          JSON.stringify(input.tags ?? []),
          input.category ?? null,
          input.price ?? null,
          input.compareAtPrice ?? null,
          input.currency ?? null,
          input.available == null ? null : input.available ? 1 : 0,
          JSON.stringify(input.raw ?? null),
        );
      }

      // Replace variants
      db.prepare('DELETE FROM catalog_variants WHERE product_id=?').run(id);
      for (const v of input.variants ?? []) {
        db.prepare(
          `INSERT INTO catalog_variants (id, product_id, external_key, title, sku, price, compare_at_price, currency, available, options)
           VALUES (?,?,?,?,?,?,?,?,?,?)`,
        ).run(
          randomUUID(),
          id,
          v.externalKey,
          v.title ?? null,
          v.sku ?? null,
          v.price ?? null,
          v.compareAtPrice ?? null,
          v.currency ?? null,
          v.available == null ? null : v.available ? 1 : 0,
          JSON.stringify(v.options ?? {}),
        );
      }

      /**
       * Merge images without destroying anything the user did here.
       *
       * Two things survive a re-import that a plain replace would wipe. Angles
       * uploaded on the product page carry a `local:` source URL and have no
       * counterpart in the crawl, so they are carried across whole. And the
       * order of the set is the user's: it decides which images reach an
       * engine (PRODUCT_REF_MAX) and which one is the essential reference, so
       * an image already here keeps the position it already had. Only images
       * the store has just added are appended.
       */
      const existingImgs = db.prepare('SELECT * FROM catalog_images WHERE product_id=?').all(id) as any[];
      const byUrl = new Map(existingImgs.map((r) => [r.source_url, r]));
      const maxPos = existingImgs.reduce((m, r) => Math.max(m, r.position ?? 0), -1);
      const local = existingImgs.filter((r) => String(r.source_url ?? '').startsWith('local:'));

      let appended = 0;
      const merged = [
        ...local.map((r) => ({
          id: r.id,
          sourceUrl: r.source_url,
          assetRef: r.asset_ref,
          width: r.width,
          height: r.height,
          alt: r.alt,
          angle: r.angle ?? null,
          excluded: r.excluded ?? 0,
          sort: r.position ?? 0,
        })),
        ...(input.images ?? []).map((img) => {
          const prev = byUrl.get(img.sourceUrl);
          return {
            id: prev?.id ?? randomUUID(),
            sourceUrl: img.sourceUrl,
            assetRef: img.assetRef ?? prev?.asset_ref ?? null,
            width: img.width ?? prev?.width ?? null,
            height: img.height ?? prev?.height ?? null,
            alt: img.alt ?? prev?.alt ?? null,
            angle: prev?.angle ?? null,
            // A crawl re-reporting an image is not the user changing their
            // mind about it.
            excluded: prev?.excluded ?? 0,
            sort: prev ? (prev.position ?? 0) : maxPos + 1 + appended++,
          };
        }),
      ].sort((a, b) => a.sort - b.sort);

      db.prepare('DELETE FROM catalog_images WHERE product_id=?').run(id);
      merged.forEach((img, position) => {
        db.prepare(
          `INSERT INTO catalog_images (id, product_id, source_url, asset_ref, width, height, position, alt, angle, excluded)
           VALUES (?,?,?,?,?,?,?,?,?,?)`,
        ).run(
          img.id,
          id,
          img.sourceUrl,
          img.assetRef,
          img.width,
          img.height,
          position,
          img.alt,
          img.angle,
          img.excluded,
        );
      });

      for (const col of input.collections ?? []) {
        let colRow = db
          .prepare('SELECT id FROM catalog_collections WHERE source_id=? AND external_key=?')
          .get(input.sourceId, col.externalKey) as { id: string } | undefined;
        if (!colRow) {
          const colId = randomUUID();
          db.prepare(
            'INSERT INTO catalog_collections (id, source_id, external_key, title, url) VALUES (?,?,?,?,?)',
          ).run(colId, input.sourceId, col.externalKey, col.title, col.url ?? null);
          colRow = { id: colId };
        } else {
          db.prepare('UPDATE catalog_collections SET title=?, url=? WHERE id=?').run(
            col.title,
            col.url ?? null,
            colRow.id,
          );
        }
        db.prepare('INSERT OR IGNORE INTO catalog_collection_products (collection_id, product_id) VALUES (?,?)').run(
          colRow.id,
          id,
        );
      }

      return this.getProduct(id)!;
    },

    setImageAsset(
      productId: string,
      sourceUrl: string,
      assetRef: string,
      meta?: { width?: number; height?: number },
    ): void {
      db.prepare(
        `UPDATE catalog_images SET asset_ref=?, width=COALESCE(?, width), height=COALESCE(?, height)
         WHERE product_id=? AND source_url=?`,
      ).run(assetRef, meta?.width ?? null, meta?.height ?? null, productId, sourceUrl);
    },

    listImagesNeedingAssets(brandId: string, limit = 500): CatalogImageRow[] {
      return (
        db
          .prepare(
            `SELECT i.* FROM catalog_images i
         JOIN catalog_products p ON p.id = i.product_id
         WHERE p.brand_id=? AND (i.asset_ref IS NULL OR i.asset_ref='')
         ORDER BY i.position ASC LIMIT ?`,
          )
          .all(brandId, limit) as any[]
      ).map((r) => ({
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
      }));
    },

    markMissingUnavailable(sourceId: string, seenExternalKeys: string[]): number {
      if (!seenExternalKeys.length) {
        const r = db
          .prepare(
            "UPDATE catalog_products SET status='unavailable', updated_at=datetime('now') WHERE source_id=? AND status='active'",
          )
          .run(sourceId);
        return r.changes;
      }
      const placeholders = seenExternalKeys.map(() => '?').join(',');
      const r = db
        .prepare(
          `UPDATE catalog_products SET status='unavailable', updated_at=datetime('now')
         WHERE source_id=? AND status='active' AND external_key NOT IN (${placeholders})`,
        )
        .run(sourceId, ...seenExternalKeys);
      return r.changes;
    },

    getProduct(id: string): CatalogProductRow | null {
      const r = db.prepare('SELECT * FROM catalog_products WHERE id=?').get(id) as any;
      return r ? rowProduct(r) : null;
    },

    getProductByLibraryId(libraryId: string): CatalogProductRow | null {
      if (!libraryId.startsWith('cat-')) return null;
      return this.getProduct(libraryId.slice(4));
    },

    listProducts(brandId: string): CatalogProductRow[] {
      return (
        db
          .prepare(
            "SELECT * FROM catalog_products WHERE brand_id=? AND status!='unavailable' ORDER BY title COLLATE NOCASE",
          )
          .all(brandId) as any[]
      ).map(rowProduct);
    },

    listVariants(productId: string): CatalogVariantRow[] {
      return (db.prepare('SELECT * FROM catalog_variants WHERE product_id=?').all(productId) as any[]).map((r) => ({
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
    },

    listImages(productId: string): CatalogImageRow[] {
      return (
        db.prepare('SELECT * FROM catalog_images WHERE product_id=? ORDER BY position').all(productId) as any[]
      ).map((r) => ({
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
      }));
    },

    deleteCatalogProduct(id: string): void {
      db.prepare('DELETE FROM catalog_products WHERE id=?').run(id);
    },

    /**
     * The fields this app invents on top of an imported product. Everything a
     * store supplies — title, price, vendor, variants — stays the store's and
     * is refreshed by every import; these four have no counterpart there, so
     * they are the user's and an import never touches them.
     */
    updateProduct(
      id: string,
      patch: {
        category?: string | null;
        variant?: string | null;
        material?: string | null;
        dimensions?: string | null;
      },
    ): CatalogProductRow | null {
      const cols = (['category', 'variant', 'material', 'dimensions'] as const).filter((k) => k in patch);
      if (cols.length) {
        db.prepare(
          `UPDATE catalog_products SET ${cols.map((c) => `${c}=?`).join(', ')}, updated_at=datetime('now') WHERE id=?`,
        ).run(...cols.map((c) => patch[c] ?? null), id);
      }
      return this.getProduct(id);
    },

    /**
     * An angle the user shot themselves, added to an imported product. The
     * `local:` prefix is what marks it as not-from-the-store, which is how the
     * import merge knows to carry it across instead of deleting it.
     */
    addLocalImage(productId: string, assetRef: string, angle?: string | null): void {
      const next =
        ((db.prepare('SELECT MAX(position) AS p FROM catalog_images WHERE product_id=?').get(productId) as any)?.p ??
          -1) + 1;
      db.prepare(
        `INSERT INTO catalog_images (id, product_id, source_url, asset_ref, position, angle)
         VALUES (?,?,?,?,?,?)`,
      ).run(randomUUID(), productId, `local:${assetRef}`, assetRef, next, angle ?? null);
    },

    /**
     * Say which of a product's images make up its reference set, and in what
     * order. `assetRefs` is the whole set: anything left out stops being used.
     *
     * An image the user uploaded here is theirs, so leaving it out deletes it.
     * A store image is not — the next import would fetch it straight back — so
     * leaving one out marks it excluded instead. That is the difference between
     * a delete this can honour and one it cannot, and it is also what lets a
     * store image be put back: pass it in again.
     */
    setImageOrder(productId: string, assetRefs: string[]): void {
      const rows = this.listImages(productId).filter((i) => i.assetRef);
      const keep = new Set(assetRefs);
      const ordered = assetRefs.map((ref) => rows.find((r) => r.assetRef === ref)).filter(Boolean) as CatalogImageRow[];
      const dropped = rows.filter((r) => !keep.has(r.assetRef!));
      const setAside = dropped.filter((r) => !String(r.sourceUrl).startsWith('local:'));
      db.transaction(() => {
        for (const r of dropped) {
          if (String(r.sourceUrl).startsWith('local:')) db.prepare('DELETE FROM catalog_images WHERE id=?').run(r.id);
        }
        for (const r of setAside) db.prepare('UPDATE catalog_images SET excluded=1 WHERE id=?').run(r.id);
        for (const r of ordered) db.prepare('UPDATE catalog_images SET excluded=0 WHERE id=?').run(r.id);
        // Pending images (no asset yet) sort after everything settled.
        const tail = this.listImages(productId).filter((i) => !i.assetRef);
        [...ordered, ...setAside, ...tail].forEach((r, i) => {
          db.prepare('UPDATE catalog_images SET position=? WHERE id=?').run(i, r.id);
        });
      })();
    },

    /** Merge manual kit products + catalog into one library list. */
    listLibraryProducts(brandId: string, brandJson: any): LibraryProduct[] {
      const manual: LibraryProduct[] = ((brandJson?.products ?? []) as any[]).map((p) => ({
        id: p.id,
        name: p.name,
        origin: 'manual' as const,
        category: p.category ?? null,
        variant: p.variant ?? null,
        material: p.material ?? null,
        dimensions: p.dimensions ?? null,
        shots: (p.shots ?? []).map((s: any) => ({
          file: s.file,
          locked: s.locked ?? true,
          angle: s.angle ?? null,
          alt: s.alt ?? s.angle ?? null,
        })),
      }));

      const catalog = this.listProducts(brandId).map((p): LibraryProduct => {
        const images = this.listImages(p.id);
        const shot = (i: (typeof images)[number]) => ({
          file: i.assetRef!,
          locked: true,
          angle: i.angle,
          alt: i.alt,
          local: String(i.sourceUrl).startsWith('local:'),
        });
        // One picture, one reference. Images are content-addressed, so a store
        // that lists the same file twice arrives as two rows pointing at one
        // asset — which would show as two identical thumbnails, take two of
        // the three slots a shot gets, and make every write to the set fail on
        // an ambiguous handle.
        const seen = new Set<string>();
        const usable = images.filter((i) => i.assetRef && !seen.has(i.assetRef) && seen.add(i.assetRef));
        // Only what the user still counts as this product reaches `shots`, and
        // `shots` is the whole of what the compiler ever sees.
        const shots = usable.filter((i) => !i.excluded).map(shot);
        const hiddenShots = usable.filter((i) => i.excluded).map(shot);
        return {
          id: `cat-${p.id}`,
          name: p.title,
          origin: 'catalog',
          url: p.url,
          descriptionHtml: p.descriptionHtml,
          vendor: p.vendor,
          productType: p.productType,
          tags: p.tags,
          category: p.category,
          variant: p.variant,
          material: p.material,
          dimensions: p.dimensions,
          price: p.price,
          compareAtPrice: p.compareAtPrice,
          currency: p.currency,
          available: p.available,
          status: p.status,
          shots,
          hiddenShots,
          variants: this.listVariants(p.id),
        };
      });

      return [...manual, ...catalog];
    },
  };
}

export type CatalogStore = ReturnType<typeof createCatalogStore>;
