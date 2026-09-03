import { useEffect, useState } from 'react';

/** The gutter between tiles, matching `.sc-cell`'s own bottom margin. */
export const GAP = 14;

/** Below this a masonry feed has no room for a grid-size control (Create's own
 * size choice disappears at this width in app.css) and falls back to a
 * forced 2-column layout instead of inheriting a fixed tile width no phone
 * screen could fit. */
export const PHONE = 768;

/**
 * Create feed tile widths (px) — compact and large, the same two views every
 * catalog wall in the app offers, so one control means one thing everywhere.
 *
 * This was a 160→420 slider in 20px steps, but the layout below only changes
 * when the column count flips, so most of its fourteen stops did nothing: you
 * dragged and the feed sat still. These two land on a different column count
 * at every width the feed is ever laid out at — from ~700px, the narrowest
 * canvas that is not phone mode, upwards. `test/masonry.test.ts` holds them
 * to that.
 */
export const TILE_STOPS = [
  { px: 190, label: 'Compact', cells: 3 },
  { px: 320, label: 'Large', cells: 2 },
] as const;

/** Large, matching DENSITY_DEFAULT — the walls open large too. */
export const TILE_DEFAULT = 320;

/** Snaps a stored pref — including every value the old slider could write. */
export function nearestTileStop(raw: unknown): number {
  const n = typeof raw === 'number' && Number.isFinite(raw) ? raw : TILE_DEFAULT;
  let best: number = TILE_STOPS[0].px;
  for (const s of TILE_STOPS) {
    if (Math.abs(s.px - n) < Math.abs(best - n)) best = s.px;
  }
  return best;
}

/**
 * Catalog walls only (Home / Products / Presenters / Scenes).
 * Two views: compact (~7 across) and large (~5 across).
 */
export type DensityCols = 7 | 5;
export const DENSITY_DEFAULT: DensityCols = 5;

/** Map a stored wall-density pref onto compact | large. */
export function normalizeDensity(raw: unknown): DensityCols {
  const n = typeof raw === 'number' ? raw : DENSITY_DEFAULT;
  if (n === 7 || n === 5) return n;
  if (n === 6) return 5;
  return DENSITY_DEFAULT;
}

/** An element's own content width, watched — the column maths needs the real
 * one, not the viewport's, since a sidebar or panel can narrow it independent
 * of the window. */
export function useElementWidth(el: HTMLElement | null): number {
  const [w, setW] = useState(0);
  useEffect(() => {
    if (!el) return;
    // One state write per frame at most. The assets rail animates its width
    // over 220 ms, and a write per observed pixel re-rendered the whole feed
    // a dozen times per toggle for a layout the browser was already easing.
    let raf = 0;
    const measure = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setW(el.clientWidth));
    };
    setW(el.clientWidth);
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
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
    let raf = 0;
    const onResize = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setW(window.innerWidth));
    };
    window.addEventListener('resize', onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
    };
  }, []);
  return w;
}

/**
 * Create feed layout from a preferred tile width in px.
 *
 * Fits as many columns as will hold that width, then shares leftover so the
 * row fills the canvas. Phone forces two columns so a desktop stop never
 * overflows a small screen.
 */
export function masonryLayout(width: number, tile: number, phoneMode: boolean): { tile: number; cols: number } {
  if (width <= 0) return { tile, cols: 1 };
  const cols = phoneMode ? 2 : Math.max(1, Math.floor((width + GAP) / (tile + GAP)));
  return { tile: Math.floor((width - GAP * (cols - 1)) / cols), cols };
}
