import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { GAP } from '../masonry.js';

/**
 * The heights of the tiles that have been on screen, by shot id, from one
 * ResizeObserver over the mounted cells. A height is a fact once measured and
 * an estimate until then. A change re-renders the owner once per frame, so
 * the spacers above the band are exact for everything the reader has passed.
 */
export function useTileHeights(feedEl: HTMLElement | null, enabled: boolean): (id: string) => number | undefined {
  const heights = useRef(new Map<string, number>());
  const [, bump] = useState(0);
  const ro = useRef<ResizeObserver | null>(null);
  const seen = useRef(new WeakSet<Element>());
  useLayoutEffect(() => {
    if (!enabled) return;
    let raf = 0;
    const observer = new ResizeObserver((entries) => {
      let changed = false;
      for (const e of entries) {
        const id = e.target.getAttribute('data-fb-node');
        if (!id) continue;
        const h = (e.target as HTMLElement).offsetHeight + GAP;
        // an element that has left the tree measures zero: keep what it was
        if (h <= GAP) continue;
        const was = heights.current.get(id);
        if (was === undefined || Math.abs(was - h) > 1) {
          heights.current.set(id, h);
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
      seen.current = new WeakSet();
    };
  }, [enabled]);
  // after every render, whatever cell arrived is put under the observer
  useLayoutEffect(() => {
    const observer = ro.current;
    if (!enabled || !observer || !feedEl) return;
    for (const el of feedEl.querySelectorAll('.sc-cell[data-fb-node]')) {
      if (seen.current.has(el)) continue;
      seen.current.add(el);
      observer.observe(el);
    }
  });
  return useCallback((id: string) => heights.current.get(id), []);
}
