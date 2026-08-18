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
  };
}
