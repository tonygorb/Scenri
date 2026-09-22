import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { GAP } from '../masonry.js';

/**
 * The heights of the tiles that have been on screen, by shot id, from one
 * ResizeObserver over the mounted cells. A height is a fact once measured and
 * an estimate until then. A change re-renders the owner once per frame, so
 * the spacers above the band are exact for everything the reader has passed.
 *
 * A tile is a box of fixed shape, so what is kept is its shape (height over
 * width inside the border), and the height is read at the column's current
 * width. Kept in pixels, a height measured at three columns was still used at
 * four: every spacer above the band came out too tall after the rail closed.
 */
export function useTileHeights(
  feedEl: HTMLElement | null,
  enabled: boolean,
  colWidth: number,
): (id: string) => number | undefined {
  const shapes = useRef(new Map<string, number>());
  const [, bump] = useState(0);
  const ro = useRef<ResizeObserver | null>(null);
  // held strongly, on purpose: an observed element is kept alive by its
  // observer, so a tile that left the window has to be unobserved or it
  // stays in memory, detached, for as long as the feed is open
  const seen = useRef(new Set<Element>());
  useLayoutEffect(() => {
    if (!enabled) return;
    let raf = 0;
    const observer = new ResizeObserver((entries) => {
      let changed = false;
      for (const e of entries) {
        const id = e.target.getAttribute('data-fb-node');
        if (!id) continue;
        const el = e.target as HTMLElement;
        // an element that has left the tree measures zero: keep what it was
        if (el.offsetHeight <= 2 || el.offsetWidth <= 2) continue;
        const shape = (el.offsetHeight - 2) / (el.offsetWidth - 2);
        const was = shapes.current.get(id);
        if (was === undefined || Math.abs(was - shape) > 0.004) {
          shapes.current.set(id, shape);
          changed = true;
        }
      }
      if (changed && !raf) {
        raf = requestAnimationFrame(() => {
          raf = 0;
          bump((v) => v + 1);
        });
      }
    });
    ro.current = observer;
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      ro.current = null;
      seen.current = new Set();
    };
  }, [enabled]);
  // after every render: whatever cell arrived goes under the observer, and
  // whatever cell left the window is let go of
  useLayoutEffect(() => {
    const observer = ro.current;
    if (!enabled || !observer || !feedEl) return;
    for (const el of seen.current) {
      if (el.isConnected) continue;
      observer.unobserve(el);
      seen.current.delete(el);
    }
    for (const el of feedEl.querySelectorAll('.sc-cell[data-fb-node]')) {
      if (seen.current.has(el)) continue;
      seen.current.add(el);
      observer.observe(el);
    }
  });
  return useCallback(
    (id: string) => {
      const shape = shapes.current.get(id);
      return shape === undefined ? undefined : Math.round(shape * Math.max(0, colWidth - 2)) + 2 + GAP;
    },
    [colWidth],
  );
}
