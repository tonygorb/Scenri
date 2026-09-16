import { randomUUID } from 'node:crypto';
import type { DB } from '../db.js';
import { productById, type CatalogImageRow, type CatalogProductRow } from './rows.js';

export function productImportMethods(db: DB) {
  return {
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

      return productById(db, id)!;
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

    /**
     * How many pictures are still owed, for a progress that can be trusted.
     *
     * The importer used to add up the rounds it had fetched and call that the
     * total, so the total was really "pictures discovered so far": it grew by
     * sixty every round, and the fraction fell back every time it did. A run
     * went 60/60, then 64/120, then 122/172 - a bar sliding backwards twice
     * while nothing had gone wrong. Counting what is left is one query and it
     * is the actual answer.
     */
    countImagesNeedingAssets(brandId: string, imagesPerProduct: number): number {
      const row = db
        .prepare(
          `SELECT COUNT(*) AS n FROM catalog_images i
         JOIN catalog_products p ON p.id = i.product_id
         WHERE p.brand_id=? AND (i.asset_ref IS NULL OR i.asset_ref='') AND i.position < ?`,
        )
        .get(brandId, imagesPerProduct) as { n: number } | undefined;
      return row?.n ?? 0;
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

    /**
     * Hide pictures that turn up on product after product.
     *
     * A photograph of a thing belongs to that thing. A picture the crawl found
     * on eighteen different product pages is the shop talking, not the
     * product: a promotion flash, a collection sticker, a delivery badge.
     * Measured on a real storefront, three addresses out of 265 were shared
     * past this threshold and all three were merchandising furniture, while
     * every genuine packshot appeared once.
     *
     * Names nothing and knows nothing about any platform, which is the point:
     * the badges that caused this carry no word a filter could match, and the
     * next store's will be different words.
     *
     * Excluded rather than deleted, the same state the picture chooser uses,
     * so anything wrongly caught is still there to be put back.
     */
    excludeSharedImages(sourceId: string, minProducts = 3): number {
      const r = db
        .prepare(
          `UPDATE catalog_images SET excluded=1
             WHERE excluded=0
               AND product_id IN (SELECT id FROM catalog_products WHERE source_id=?)
               AND source_url IN (
                 SELECT ci.source_url FROM catalog_images ci
                   JOIN catalog_products cp ON cp.id = ci.product_id
                  WHERE cp.source_id=?
                  GROUP BY ci.source_url
                 HAVING COUNT(DISTINCT ci.product_id) >= ?
               )`,
        )
        .run(sourceId, sourceId, minProducts);
      return r.changes;
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
      /**
       * Marked in one pass over a temporary table, not one bound parameter per
       * product.
       *
       * `NOT IN (?, ?, ...)` needed a placeholder for every key this run wrote,
       * and SQLite stops at 32,766 of them (measured on 3.53.2, which this
       * build carries): a store past that threw `too many SQL variables` from
       * inside the run's own completion, turning a finished import into a
       * failure after every product had already been saved.
       */
      db.exec('CREATE TEMP TABLE IF NOT EXISTS seen_keys (k TEXT PRIMARY KEY)');
      db.exec('DELETE FROM seen_keys');
      const add = db.prepare('INSERT OR IGNORE INTO seen_keys (k) VALUES (?)');
      db.transaction((keys: string[]) => {
        for (const k of keys) add.run(k);
      })(seenExternalKeys);
      const r = db
        .prepare(
          `UPDATE catalog_products SET status='unavailable', updated_at=datetime('now')
         WHERE source_id=? AND status='active'
           AND external_key NOT IN (SELECT k FROM seen_keys)`,
        )
        .run(sourceId);
      db.exec('DELETE FROM seen_keys');
      return r.changes;
    },
  };
}
