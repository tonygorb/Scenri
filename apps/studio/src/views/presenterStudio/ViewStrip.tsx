import { thumbUrl } from '../../api.js';
import type { StripItem, StudioView } from './studioRules.js';

/**
 * The three views as the progress. Approved ones show their picture, the
 * current one is outlined, the ones still to come are labelled frames. Not a
 * node graph: three frames in a row, the way a contact strip reads.
 */
export function ViewStrip({
  items,
  onPick,
}: {
  items: StripItem[];
  /** An approved or stale view can be revisited; the rest are not buttons yet. */
  onPick: (view: StudioView) => void;
}) {
  return (
    <ol className="sc-studio-strip" aria-label="Reference views">
      {items.map((it) => {
        const pickable = it.state === 'approved' || it.state === 'stale' || (it.state === 'current' && !!it.hash);
        return (
          <li key={it.view} data-state={it.state}>
            <button
              type="button"
              className="sc-studio-slot"
              aria-current={it.state === 'current' ? 'step' : undefined}
              aria-label={`${it.label}: ${it.state === 'todo' ? 'not yet drawn' : it.state}`}
              disabled={!pickable}
              onClick={() => onPick(it.view)}
            >
              <span className="sc-studio-slot-pic">
                {it.hash ? <img src={thumbUrl(it.hash, 'small')} alt="" loading="lazy" decoding="async" /> : null}
              </span>
              <span className="sc-studio-slot-cap">
                <b>{it.label}</b>
                {it.photo && <small>Your photo</small>}
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
