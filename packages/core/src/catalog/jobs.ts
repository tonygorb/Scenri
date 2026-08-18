import { randomUUID } from 'node:crypto';
import type { DB } from '../db.js';
import { jobById, rowJob, type CatalogPlatform, type ImportJobRow, type ImportStage } from './rows.js';

export function jobMethods(db: DB) {
  return {
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
      return jobById(db, id)!;
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
      const cur = jobById(db, id);
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
      return jobById(db, id);
    },
  };
}
