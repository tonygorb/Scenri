import { useEffect, useRef, useState } from 'react';
import { Storefront, X } from '@phosphor-icons/react';
import { api, assetUrl } from '../api.js';
import { useBrand } from '../app/BrandLayout.js';
import { useTaskCenter } from '../app/TaskCenter.js';
import { primaryMark } from '../brand/marks.js';
import { elapsedLabel } from '../tasks.js';

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
 * fabricated percent, and the number beside it never lies. What is true here
 * is how many products have landed and how long it has taken, so that is what
 * it says.
 */
export function ImportBar() {
  const { brand } = useBrand();
  const { tasks } = useTaskCenter();
  const [stopping, setStopping] = useState<string | null>(null);
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

  if (!run) return null;

  const jobId = run.id.startsWith('catalog:') ? run.id.slice('catalog:'.length) : null;
  const busy = stopping === run.id;
  const mark = assetUrl(primaryMark(brand.json)?.file);

  if (peak.current.id !== run.id) peak.current = { id: run.id, pct: 0 };
  peak.current.pct = Math.max(peak.current.pct, run.percent ?? 0);

  return (
    <div className="sc-impbar" role="status" style={{ ['--sc-impbar-p' as string]: `${peak.current.pct}%` }}>
      <span className="sc-impbar-fill" aria-hidden />
      {/* The brand's own mark, not its address. You know which shop you asked
          for; the URL was the longest thing in the pill and the least useful. */}
      <span className="sc-impbar-mark" aria-hidden>
        {mark ? <img src={mark} alt="" /> : <Storefront size={13} weight="regular" />}
      </span>
      <span className="sc-impbar-count">{run.subtitle}</span>
      <span className="sc-impbar-clock">{elapsedLabel(run.startedAt, now)}</span>
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
  );
}
