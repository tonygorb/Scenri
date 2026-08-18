import { randomUUID } from 'node:crypto';
import type { DB } from '../db.js';
import { rowSource, type CatalogPlatform, type CatalogSourceRow } from './rows.js';

export function sourceMethods(db: DB) {
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
  };
}
