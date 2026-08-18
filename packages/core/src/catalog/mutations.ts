import { randomUUID } from 'node:crypto';
import type { DB } from '../db.js';
import { imagesFor, productById, type CatalogImageRow, type CatalogProductRow } from './rows.js';

export function mutationMethods(db: DB) {
  return {
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
      return productById(db, id);
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
      const rows = imagesFor(db, productId).filter((i) => i.assetRef);
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
        const tail = imagesFor(db, productId).filter((i) => !i.assetRef);
        [...ordered, ...setAside, ...tail].forEach((r, i) => {
          db.prepare('UPDATE catalog_images SET position=? WHERE id=?').run(i, r.id);
        });
      })();
    },

    /** Merge manual kit products + catalog into one library list. */
  };
}
