import { useEffect } from 'react';
import { useLocation } from 'react-router';
import { PHONE, useMediaQuery } from '../../useMediaQuery.js';

/** Condense past this, restore under the other: the dead band is the point. */
const DOWN = 24;
const UP = 8;

/**
 * Reading down the page, the bar lifts: a shadow arrives because it is over
 * content now rather than above it. Nothing about it moves or resizes. It used
 * to give back 8px of height as well, and that shrink, snapped or eased, read as
 * the page lurching under the reader, so only the shadow is left.
 *
 * Two thresholds rather than one, so a scroll resting near the line cannot make
 * the shadow flicker on and off.
 *
 * The signal is one capture-phase listener on the shell. `scroll` does not
 * bubble but it does capture, so one listener hears every scroller under it,
 * including the ones that mount later, with no observer and no per-view wiring.
 * Views declare which scroller is the page's with `data-page-scroll`, so the
 * assets rail and the notification list cannot condense the bar by scrolling
 * themselves. `scrollTop` on the element the event just fired for is a property
 * read, not a forced layout, and a frame gate keeps it to one write per frame.
 *
 * Never on a phone: the bar has six pixels to give there, momentum scrolling
 * crosses both thresholds by itself, and the tab bar underneath never moves, so
 * one bar twitching against another that does not is worse than the height.
 */
export function useCondensedBar(): void {
  const phone = useMediaQuery(PHONE);
  const { pathname } = useLocation();

  useEffect(() => {
    const shell = document.querySelector<HTMLElement>('.sc-shell');
    if (!shell) return;
    // A page that does not scroll never fires, so the flag has to be cleared on
    // arrival: leaving a scrolled page for a short one would otherwise keep a
    // condensed bar over a page sitting at its top.
    delete shell.dataset.condensed;
    if (phone) return;

    let frame = 0;
    const onScroll = (e: Event) => {
      const el = e.target as HTMLElement | null;
      if (!el?.dataset || !('pageScroll' in el.dataset)) return;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const on = shell.dataset.condensed !== undefined;
        const y = el.scrollTop;
        if (on ? y <= UP : y > DOWN) {
          if (on) delete shell.dataset.condensed;
          else shell.dataset.condensed = '';
        }
      });
    };

    shell.addEventListener('scroll', onScroll, { capture: true, passive: true });
    return () => {
      if (frame) cancelAnimationFrame(frame);
      shell.removeEventListener('scroll', onScroll, { capture: true });
      delete shell.dataset.condensed;
    };
  }, [phone, pathname]);
}
