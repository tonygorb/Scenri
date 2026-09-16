import { useState } from 'react';
import { X } from '@phosphor-icons/react';
import { api } from '../api.js';
import { useBrand } from '../app/BrandLayout.js';
import { useTaskCenter } from '../app/TaskCenter.js';

/**
 * A catalogue import, while it is happening, where you are already looking.
 *
 * An import is the one long job a person starts and then keeps working
 * through, and until now the only place it existed was a row inside the bell:
 * a panel you have to remember to open, over a count that changed units as it
 * went. So it ran invisibly, and the wall of products filling in was the only
 * evidence.
 *
 * It rides in the dock, above the composer, the same shelf `PickedBar` uses
 * for the same reason - it clears whatever height the composer happens to be
 * rather than a distance guessed in advance. One line, the count it already
 * had, and the one thing there is to do about it.
 *
 * Deliberately not a second progress bar: the fill is the surface itself, so
 * the bar says how far along it is without drawing a meter to say it.
 */
export function ImportBar() {
  const { brand } = useBrand();
  const { tasks } = useTaskCenter();
  const [stopping, setStopping] = useState<string | null>(null);

  // Whatever is running now. More than one import at a time is possible and
  // uninteresting: the newest is the one someone just started.
  const run = tasks.find((t) => t.kind === 'catalog' && t.state === 'running');
  if (!run) return null;

  const jobId = run.id.startsWith('catalog:') ? run.id.slice('catalog:'.length) : null;
  const busy = stopping === run.id;

  return (
    <div className="sc-impbar" role="status" style={{ ['--sc-impbar-p' as string]: `${run.percent ?? 0}%` }}>
      <span className="sc-impbar-fill" aria-hidden />
      <span className="sc-impbar-text">
        <span className="sc-impbar-host">{run.title}</span>
        <span className="sc-impbar-count">{run.subtitle}</span>
      </span>
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
