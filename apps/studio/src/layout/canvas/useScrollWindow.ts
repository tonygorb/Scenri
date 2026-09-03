import { useLayoutEffect, useState } from 'react';
import { quantize } from './windowRules.js';

interface ScrollWindow {
  /** How far the feed has scrolled under the scroller's top edge; negative while the toolbar is still above it. */
  top: number;
  /** The scroller's inner height. */
  height: number;
}

/**
 * The scroller's viewport in the feed's own coordinates, read on scroll and
 * resize, one state write per frame at most, quantised so a few pixels of
 * movement re-render nothing. Off, it costs nothing: no listener is attached
 * and the initial guess is returned.
 */
export function useScrollWindow(feedEl: HTMLElement | null, enabled: boolean): ScrollWindow {
  const [win, setWin] = useState<ScrollWindow>(() => ({
    top: 0,
    height: typeof window === 'undefined' ? 0 : window.innerHeight,
  }));
  useLayoutEffect(() => {
    if (!enabled || !feedEl) return;
    const scroller = feedEl.closest('.sc-canvas') as HTMLElement | null;
    if (!scroller) return;
    let raf = 0;
    const read = () => {
      raf = 0;
      const feedTop = feedEl.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
      const next = { top: quantize(scroller.scrollTop - feedTop), height: scroller.clientHeight };
      setWin((cur) => (cur.top === next.top && cur.height === next.height ? cur : next));
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(read);
    };
    read();
    scroller.addEventListener('scroll', schedule, { passive: true });
    const ro = new ResizeObserver(schedule);
    ro.observe(scroller);
    ro.observe(feedEl);
    return () => {
      cancelAnimationFrame(raf);
      scroller.removeEventListener('scroll', schedule);
      ro.disconnect();
    };
  }, [feedEl, enabled]);
  return win;
}
