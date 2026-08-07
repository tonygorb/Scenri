import { useEffect, useState } from 'react';

/** The gutter between tiles, matching `.sc-cell`'s own bottom margin. */
export const GAP = 14;

/** Below this a masonry feed has no room for a grid-size slider (Create's own
 * `.sc-density` disappears at this width in tokens.css) and falls back to a
 * forced 2-column layout instead of inheriting a fixed tile width no phone
 * screen could fit. */
export const PHONE = 768;

/** An element's own content width, watched — the column maths needs the real
 * one, not the viewport's, since a sidebar or panel can narrow it independent
 * of the window. */
export function useElementWidth(el: HTMLElement | null): number {
  const [w, setW] = useState(0);
  useEffect(() => {
    if (!el) return;
    const measure = () => setW(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return w;
}

/** The window's own width, for the phone-mode decision specifically — kept
 * apart from `useElementWidth` because a feed's own content width can be
 * narrowed by something else (an assets panel, a sidebar) independent of the
 * viewport itself, and phone mode is a viewport call, not an element one. */
export function useViewportWidth(): number {
  const [w, setW] = useState(() => window.innerWidth);
  useEffect(() => {
    const onResize = () => setW(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return w;
}

/**
 * How wide a tile actually is, and how many fit.
 *
 * `columns: auto <width>` balances column *height*, so a few tall tiles can
 * pack two columns and leave a third empty. Counting here instead fills the
 * row, with a fixed column width rather than a stretched one, matched by
 * every feed that shares this (Create's Canvas, Home's recent work) so a
 * masonry grid looks and behaves the same wherever it appears.
 */
export function masonryLayout(width: number, tile: number, phoneMode: boolean): { tile: number; cols: number } {
  if (width <= 0) return { tile, cols: 1 };
  // A phone has no slider — there is no room to drag one — so it must not
  // inherit whatever size a desktop session left behind, and a fixed column
  // width from that session would simply overflow the screen.
  if (phoneMode) {
    return { tile: Math.floor((width - GAP) / 2), cols: 2 };
  }
  return { tile, cols: Math.max(1, Math.floor((width + GAP) / (tile + GAP))) };
}
