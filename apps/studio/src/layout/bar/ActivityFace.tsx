import { useRef } from 'react';
import { Bell } from '@phosphor-icons/react';
import { ProgressRing } from './ProgressRing.js';
import { thumbUrl } from '../../api.js';
import type { Task } from '../../tasks.js';

export type ActivityMode = 'busy' | 'new' | 'quiet';

/**
 * What the bar says about work in flight, in one control that changes shape
 * three times.
 *
 * Busy: the picture being rendered. A job with a real fraction sits in a ring
 * that fills. A generation has none, so the arc travels and does not pretend
 * to know how far along it is. A count joins it when more than one is running.
 * Something new and nothing running: a bell carrying the number. Neither: a
 * bell. The clock is deliberately absent, because a readout whose width
 * changes every second is a readout that never settles; the elapsed time is
 * in the panel and in the tooltip.
 *
 * The swap animates, and the first paint does not. A face that fades in on
 * arrival while the rest of the bar simply is there reads as a glitch, and the
 * flag that decides it is frozen when the face mounts: read live, it would flip
 * one tick after the first paint and start the animation it exists to skip.
 */
export function ActivityFace({
  mode,
  lead,
  running,
  unread,
  animate,
}: {
  mode: ActivityMode;
  lead: Task | null;
  running: number;
  unread: number;
  /** False on the very first face this session, true for every face after it. */
  animate: boolean;
}) {
  const swap = useFrozen(animate);
  if (mode === 'busy' && lead) {
    const known = lead.percent !== null;
    return (
      <span className="sc-act-face" data-swap={swap || undefined} aria-hidden="true">
        <span className="sc-act-ring" data-bare={lead.thumb ? undefined : ''}>
          <ProgressRing value={known ? (lead.percent ?? 0) / 100 : 0} indeterminate={!known} size={32} />
          {lead.thumb ? (
            <img src={thumbUrl(lead.thumb, 'micro')} alt="" loading="lazy" decoding="async" />
          ) : (
            <Bell size={16} />
          )}
          {running > 1 && <span className="sc-act-n">{running}</span>}
        </span>
      </span>
    );
  }
  if (mode === 'new') {
    return (
      <span className="sc-act-face" data-swap={swap || undefined} aria-hidden="true">
        <span className="sc-act-bell">
          <Bell size={18} />
          <span className="sc-act-n">{unread > 9 ? '9+' : unread}</span>
        </span>
      </span>
    );
  }
  return (
    <span className="sc-act-face" data-swap={swap || undefined} aria-hidden="true">
      <Bell size={18} />
    </span>
  );
}

/** Whatever it was when this face mounted, for as long as this face lives. */
function useFrozen(value: boolean): boolean {
  const first = useRef(value);
  return first.current;
}
