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

    /**
     * What the notifications bell needs: work in flight, and what has just
     * stopped.
     *
     * `listJobs` answers with every import the brand has ever run, and the
     * bell rendered all of them as tasks - so one finished import sat in the
     * Tasks tab, and in its count, for ever, and a brand with a few imports
     * behind it opened onto a list of things that were over. An hour is long
     * enough for the panel to still be showing you what landed while you were
     * on another screen, and short enough that it is never a history.
     */
    listRecentJobs(brandId: string): ImportJobRow[] {
      return (
        db
          .prepare(
            `SELECT * FROM import_jobs
              WHERE brand_id=?
                AND (finished_at IS NULL OR finished_at > datetime('now','-1 hour'))
              ORDER BY created_at DESC`,
          )
          .all(brandId) as any[]
      ).map(rowJob);
    },

    listJobs(brandId: string): ImportJobRow[] {
      return (
        db.prepare('SELECT * FROM import_jobs WHERE brand_id=? ORDER BY created_at DESC').all(brandId) as any[]
      ).map(rowJob);
    },

    /**
     * Close every job that was still running when the process last stopped.
     *
     * A job lives in the database and its worker lives in the process, so a
     * quit, a crash or a restart leaves a row that says `fetching_products`
     * with no `finished_at` and nothing on earth still working on it. The bell
     * then shows a task running for ever, and no later write can correct it
     * because nothing is left to do the writing. Nothing is in flight at
     * startup by definition, so anything unfinished here was interrupted.
     *
     * Whatever it had already saved stays saved; only the row is closed.
     */
    reconcileInterruptedJobs(): number {
      const { changes } = db
        .prepare(
          `UPDATE import_jobs
              SET stage='cancelled',
                  finished_at=datetime('now'),
                  message=CASE WHEN upserted > 0
                    THEN 'Interrupted when Scenri stopped, after saving ' || upserted || ' products'
                    ELSE 'Interrupted when Scenri stopped' END
            WHERE finished_at IS NULL`,
        )
        .run();
      return changes;
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
      /**
       * A finished job stays finished.
       *
       * Work already in flight keeps reporting for a moment after a job ends -
       * a cancelled import's last workers drain, and the pipeline emits one
       * closing "Fetched 0 products" on its way out. Those landed after the
       * terminal write and put the row back to `fetching_products` with a
       * `finished_at` already set, so a stopped import read as one still
       * running, for good.
       */
      if (cur.finishedAt) return cur;
      const stage = patch.stage ?? cur.stage;
      const finished =
        patch.finished ||
        stage === 'completed' ||
        stage === 'partial' ||
        stage === 'no_catalog' ||
        stage === 'cancelled' ||
        stage === 'failed';
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
