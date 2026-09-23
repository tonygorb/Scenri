import { type RefObject, useLayoutEffect, useRef, useState } from 'react';
import { quantize } from './windowRules.js';

interface ScrollWindow {
  /** How far the feed has scrolled under the scroller's top edge; negative while the toolbar is still above it. */
  top: number;
  /** The scroller's inner height. */
  height: number;
  /**
   * The tile the reader is looking at: the one across the top edge of the
   * visible feed, and how far its top sits from that edge. Null at the top of
   * the feed, where there is nothing to keep in place.
   */
  anchor: RefObject<FeedAnchor | null>;
  /** Read the scroller now, before paint, after something moved it on purpose. */
  resync: () => void;
  /** Keep this tile as the anchor until `until` (a performance.now() time); null lets go. */
  hold: (anchor: FeedAnchor | null, until?: number) => void;
}

export interface FeedAnchor {
  id: string;
  offset: number;
}

/** Where the visible feed begins on screen: under the sticky toolbar, or the scroller's own top. */
export function feedEdge(scroller: HTMLElement): number {
  const top = scroller.getBoundingClientRect().top;
  const bar = scroller.querySelector<HTMLElement>('.sc-toolbar');
  return bar ? Math.max(top, bar.getBoundingClientRect().bottom) : top;
}

/**
 * The scroller's viewport in the feed's own coordinates, read on scroll and
 * resize, one state write per frame at most, quantised so a few pixels of
 * movement re-render nothing. The window is only kept while `enabled`; the
 * anchor is kept at any size, because a feed of twelve reflows too.
 */
export function useScrollWindow(feedEl: HTMLElement | null, enabled: boolean): ScrollWindow {
  const [win, setWin] = useState(() => ({
    top: 0,
    height: typeof window === 'undefined' ? 0 : window.innerHeight,
  }));
  const anchor = useRef<FeedAnchor | null>(null);
  const held = useRef<{ anchor: FeedAnchor; until: number } | null>(null);
  const hold = useRef((a: FeedAnchor | null, until = 0) => {
    held.current = a ? { anchor: a, until } : null;
  }).current;
  const readNow = useRef<() => void>(() => {});
  const resync = useRef(() => readNow.current()).current;
  useLayoutEffect(() => {
    if (!feedEl) return;
    const scroller = feedEl.closest('.sc-canvas') as HTMLElement | null;
    if (!scroller) return;
    let raf = 0;
    let again = 0;
    const record = () => {
      // A tile being put back after a reflow is the anchor until it lets go:
      // a read taken mid-reflow found some other tile under the edge, and the
      // next close-and-reopen came back to that one instead.
      const h = held.current;
      if (h && performance.now() < h.until) {
        anchor.current = h.anchor;
        return;
      }
      held.current = null;
      anchor.current = scroller.scrollTop > 0 ? anchorOf(feedEl, feedEdge(scroller), anchor.current?.id) : null;
    };
    const read = () => {
      raf = 0;
      if (enabled) {
        const feedTop = feedEl.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
        const next = { top: quantize(scroller.scrollTop - feedTop), height: scroller.clientHeight };
        setWin((cur) => (cur.top === next.top && cur.height === next.height ? cur : next));
      }
      record();
      // A long jump mounts its band on the next render: until then no tile of
      // it is under the edge, so the reader's tile is read once more after it.
      cancelAnimationFrame(again);
      again = requestAnimationFrame(record);
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(read);
    };
    readNow.current = read;
    read();
    scroller.addEventListener('scroll', schedule, { passive: true });
    const ro = new ResizeObserver(schedule);
    ro.observe(scroller);
    ro.observe(feedEl);
    return () => {
      cancelAnimationFrame(raf);
      cancelAnimationFrame(again);
      readNow.current = () => {};
      scroller.removeEventListener('scroll', schedule);
      ro.disconnect();
    };
  }, [feedEl, enabled]);
  return { ...win, anchor, resync, hold };
}

/**
 * The tile the reader is on: the first one whose top is in view, in reading
 * order (highest, then leftmost), or the one across the edge when a single
 * tile fills the view. One rule, so the tile kept in place is never a guess
 * between two that sit the same distance either side of the edge. On a tie
 * the tile already held stays held, so closing the rail and opening it again
 * comes back to the same tile rather than to its neighbour in the row.
 */
function anchorOf(feedEl: HTMLElement, edge: number, held?: string): FeedAnchor | null {
  let first: { id: string; top: number; left: number } | null = null;
  let across: { id: string; top: number; left: number } | null = null;
  for (const el of feedEl.querySelectorAll<HTMLElement>('.sc-cell[data-fb-node]')) {
    const r = el.getBoundingClientRect();
    if (r.bottom <= edge || r.height === 0) continue;
    const id = el.getAttribute('data-fb-node');
    if (!id) continue;
    const at = { id, top: r.top, left: r.left };
    if (r.top >= edge - 1) {
      const tie = !!first && Math.abs(r.top - first.top) <= 1;
      if (!first || r.top < first.top - 1 || (tie && first.id !== held && (id === held || r.left < first.left)))
        first = at;
    } else if (!across || r.left < across.left) {
      across = at;
    }
  }
  const pick = first ?? across;
  return pick ? { id: pick.id, offset: pick.top - edge } : null;
}
