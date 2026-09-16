import { useEffect, useRef, useState } from 'react';
import { Storefront, X } from '@phosphor-icons/react';
import { api, assetUrl } from '../api.js';
import { useBrand } from '../app/BrandLayout.js';
import { useTaskCenter } from '../app/TaskCenter.js';
import { iconMark } from '../brand/marks.js';
import { elapsedLabel } from '../tasks.js';
import { ImportProgress } from '../views/ImportProgress.js';

/**
 * A catalogue import, while it is happening, where you are already looking.
 *
 * An import is the one long job a person starts and then keeps working
 * through, and until now the only place it existed was a row inside the bell:
 * a panel you have to remember to open. So it ran invisibly, and the wall of
 * products filling in was the only evidence.
 *
 * It rides in the dock, above the composer, the same shelf `PickedBar` uses
 * for the same reason - it clears whatever height the composer happens to be
 * rather than a distance guessed in advance.
 *
 * The clock rather than a bar, deliberately. This drew a fill from the job's
 * percent, and that percent goes backwards: the picture phase is
 * `imagesDone / imagesTotal`, and the total grows every time another product
 * is written, so the fraction falls whenever products arrive faster than
 * pictures download. A person watching saw it slide back. `elapsedLabel`
 * already exists for exactly this and says why in its own comment - never a
 * fabricated percent, and the number beside it never lies. The count is the
 * same sentence the bell row shows (`taskFromCatalogJob`), so the two can
 * never drift into disagreeing about the run they are both watching.
 */
export function ImportBar() {
  const { brand } = useBrand();
  const { tasks } = useTaskCenter();
  const [stopping, setStopping] = useState<string | null>(null);
  /**
   * The job whose dialog is open, not a boolean.
   *
   * The pill only exists while something is running, so a boolean would take
   * the dialog down with it at the exact moment it had something to say - the
   * finished count, the pictures that failed. Holding the id keeps the dialog
   * up until it is dismissed.
   */
  const [open, setOpen] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  /**
   * The furthest this run has got, which is the only thing a bar may show.
   *
   * The count it divides by is honest now - it is what the run still owes
   * rather than what it has looked at - but products are still being written
   * while pictures download on a store read page by page, so the total can
   * still grow under the fraction. Progress does not un-happen, so the bar
   * does not either.
   */
  const peak = useRef<{ id: string; pct: number }>({ id: '', pct: 0 });

  // Whatever is running now. More than one at a time is possible and
  // uninteresting: the newest is the one someone just started.
  const run = tasks.find((t) => t.kind === 'catalog' && t.state === 'running');

  useEffect(() => {
    if (!run) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [run]);

  if (!run && !open) return null;

  const jobId = run?.id.startsWith('catalog:') ? run.id.slice('catalog:'.length) : null;
  const busy = run != null && stopping === run.id;
  const icon = iconMark(brand.json);
  const mark = assetUrl(icon?.file);

  if (run) {
    if (peak.current.id !== run.id) peak.current = { id: run.id, pct: 0 };
    peak.current.pct = Math.max(peak.current.pct, run.percent ?? 0);
  }

  return (
    <>
      {run && (
        <div className="sc-impbar" role="status" style={{ ['--sc-impbar-p' as string]: `${peak.current.pct}%` }}>
          <span className="sc-impbar-fill" aria-hidden />
          {/* The pill is the way back into the import, not only a readout of
              it. The exact counters, the errors and the list of what failed
              already live in the dialog; before this the only door to it was a
              row inside the bell, which is not where anyone was looking. */}
          <button
            type="button"
            className="sc-impbar-open"
            onClick={() => jobId && setOpen(jobId)}
            disabled={!jobId}
            aria-label="Show import details"
          >
            {/* The site's own icon, not its address. You know which shop you
                asked for; the URL was the longest thing in the pill and the
                least useful. */}
            <span className="sc-impbar-mark" aria-hidden>
              {mark ? (
                // Cropped only when it really is the site's icon, which is
                // drawn to be a square badge. A brand from before this was
                // captured, or one whose site declared none, falls back to the
                // logo, and centre-cropping a wordmark is how you get three
                // pixels of its background.
                <img src={mark} alt="" className={icon?.role === 'mark' ? 'sc-impbar-badge' : undefined} />
              ) : (
                <Storefront size={13} weight="regular" />
              )}
            </span>
            <span className="sc-impbar-count">{run.subtitle}</span>
            <span className="sc-impbar-clock">{elapsedLabel(run.startedAt, now)}</span>
          </button>
          {jobId && (
            <button
              type="button"
              className="sc-impbar-stop"
              disabled={busy}
              aria-label="Stop importing"
              onClick={() => {
                setStopping(run.id);
                void api.cancelCatalogJob(brand.id, jobId).catch(() => setStopping(null));
              }}
            >
              <X size={12} weight="bold" />
              {busy ? 'Stopping' : 'Stop'}
            </button>
          )}
        </div>
      )}
      {open && <ImportProgress brandId={brand.id} jobId={open} onDismiss={() => setOpen(null)} />}
    </>
  );
}
