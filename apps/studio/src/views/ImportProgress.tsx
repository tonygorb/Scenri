import { useEffect, useState } from 'react';
import { X } from '@phosphor-icons/react';
import { DialogSheet, SheetClose, SheetDescription, SheetTitle } from '../layout/DialogSheet.js';
import { api, type CatalogImportJob } from '../api.js';
import { catalogPercent } from '../tasks.js';

/**
 * What an import is actually doing, for as long as it is doing it.
 *
 * Nothing in the app opened onto a running operation before this: a task row
 * carried a bar and a sentence, and clicking it navigated to the brand kit
 * settings pane, which has nothing about the import on it. A catalogue of
 * 2,203 products runs long enough that "how far along is it, and can I stop
 * it" is a fair question to be able to ask.
 *
 * The stages are the server's own, not invented here, and each line is a real
 * counter the job already reports.
 */
/**
 * How often the dialog re-reads the job while it is open.
 *
 * This was 1200 ms, and an import saving four products a second then appeared
 * to arrive in steps of five - which is what a one-at-a-time import looks like
 * through a slow window. Measured: the request this makes is a single indexed
 * row read, 1.0 ms average over twenty calls against a local server. Three a
 * second, only while somebody is watching, and only until the job finishes.
 */
const POLL_MS = 300;

const STAGE_LABEL: Record<string, string> = {
  queued: 'Waiting to start',
  discovering: 'Looking through the site',
  fetching_products: 'Reading products',
  processing_assets: 'Saving pictures',
  completed: 'Finished',
  partial: 'Finished, with some gaps',
  no_catalog: 'No shop on this site',
  cancelled: 'Stopped',
  failed: 'Could not finish',
};

export function ImportProgress({
  brandId,
  jobId,
  onDismiss,
}: {
  brandId: string;
  jobId: string;
  onDismiss: () => void;
}) {
  const [job, setJob] = useState<CatalogImportJob | null>(null);
  const [stopping, setStopping] = useState(false);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        const next = await api.catalogJob(brandId, jobId);
        if (stopped) return;
        setJob(next);
        if (!next.finishedAt) timer = setTimeout(tick, POLL_MS);
      } catch {
        if (!stopped) timer = setTimeout(tick, POLL_MS * 3);
      }
    };
    void tick();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [brandId, jobId]);

  const running = !!job && !job.finishedAt;
  const percent = job ? catalogPercent(job) : 0;
  const errors = job?.errors ?? [];

  const stop = async () => {
    setStopping(true);
    try {
      await api.cancelCatalogJob(brandId, jobId);
    } catch {
      setStopping(false);
    }
  };

  return (
    <DialogSheet open className="sc-imp" maxWidth="440px" described onDismiss={onDismiss}>
      <div className="sc-newdlg-head">
        <SheetTitle className="sc-newdlg-title">Importing products</SheetTitle>
        <SheetClose>
          <button type="button" className="sc-set-close sc-newdlg-close" aria-label="Close">
            <X size={16} />
          </button>
        </SheetClose>
      </div>

      <SheetDescription className="sc-imp-sub">
        {/*
          Never the raw stage. `job.stage` is an identifier - a new one added
          server-side would put `fetching_products` on screen in front of a
          person, which is the one place a machine word has ever reached this
          dialog. An unmapped stage is simply work in progress.
        */}
        {job ? (STAGE_LABEL[job.stage] ?? 'Working') : 'Getting the details'}
        {job?.message ? ` · ${job.message}` : ''}
      </SheetDescription>

      {running && (
        <span className="sc-imp-meter" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
          <div style={{ width: `${percent}%` }} />
        </span>
      )}

      <ul className="sc-imp-lines">
        <li>
          <span>Found on the site</span>
          <b>{(job?.discovered ?? 0).toLocaleString()}</b>
        </li>
        <li>
          <span>Read</span>
          <b>{(job?.fetched ?? 0).toLocaleString()}</b>
        </li>
        <li>
          <span>Saved</span>
          <b>{(job?.upserted ?? 0).toLocaleString()}</b>
        </li>
        <li>
          <span>Pictures</span>
          <b>
            {(job?.imagesDone ?? 0).toLocaleString()}
            {job?.imagesTotal ? ` of ${job.imagesTotal.toLocaleString()}` : ''}
          </b>
        </li>
      </ul>

      {errors.length > 0 && (
        <details className="sc-imp-errs">
          <summary>{errors.length === 1 ? '1 thing went wrong' : `${errors.length} things went wrong`}</summary>
          <ul>
            {errors.slice(0, 8).map((e, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: a frozen error list has nothing else to key on
              <li key={i}>{e.message}</li>
            ))}
          </ul>
        </details>
      )}

      <div className="sc-imp-foot">
        {running ? (
          <button type="button" className="sc-wiz-skip" onClick={() => void stop()} disabled={stopping}>
            {stopping ? 'Stopping' : 'Stop importing'}
          </button>
        ) : (
          <span className="sc-imp-done">
            {job?.stage === 'cancelled' ? 'Stopped. What was already imported is kept.' : 'Nothing left to do.'}
          </span>
        )}
        <button type="button" className="sc-wiz-cta" onClick={onDismiss}>
          {running ? 'Leave it running' : 'Close'}
        </button>
      </div>
    </DialogSheet>
  );
}
