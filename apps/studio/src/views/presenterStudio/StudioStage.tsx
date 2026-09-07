import { useEffect, useState } from 'react';
import { imgUrl } from '../../api.js';
import { elapsedLabel } from '../../tasks.js';
import type { Slot, StudioView } from './studioRules.js';
import { VIEW_LABEL } from './studioRules.js';

/**
 * The picture, big. One candidate at a time, or the approved view, or the
 * last picture dimmed under a clock while the next one is drawn. No fake
 * progress: an engine reports nothing until it is done, so the honest signal
 * is the time elapsed, in the same mono clock a running shot tile wears.
 */
export function StudioStage({
  view,
  slot,
  drawing,
  since,
  name,
}: {
  view: StudioView;
  slot: Slot;
  drawing: boolean;
  /** When the current step started, for the clock. */
  since: string;
  name: string;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!drawing) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [drawing]);

  const label = VIEW_LABEL[view].toLowerCase();
  const who = name.trim() || 'the presenter';
  const alt = slot.hash
    ? `${VIEW_LABEL[view]} of ${who}${slot.status === 'approved' ? ', approved' : slot.status === 'candidate' ? ', to review' : ''}`
    : '';

  return (
    <div className="sc-studio-stage" data-drawing={drawing || undefined} data-empty={!slot.hash || undefined}>
      {slot.hash ? (
        <img src={imgUrl(slot.hash)} alt={alt} decoding="async" />
      ) : (
        <span className="sc-studio-stage-blank" aria-hidden />
      )}
      {drawing && (
        <span className="sc-studio-clock" role="status" aria-live="polite">
          <span>Drawing the {label}</span>
          <time>{elapsedLabel(since, now)}</time>
        </span>
      )}
    </div>
  );
}
