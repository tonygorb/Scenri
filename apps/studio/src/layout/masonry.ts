import { useEffect, useLayoutEffect, useState } from 'react';

/** The gutter between tiles, matching `.sc-cell`'s own bottom margin. */
export const GAP = 14;

/** Below this a masonry feed has no room for a grid-size control (Create's own
 * size choice disappears at this width in app.css) and falls back to a
 * forced 2-column layout instead of inheriting a fixed tile width no phone
 * screen could fit. */
export const PHONE = 768;

/**
 * Create feed sizes — compact and large, the same two views every catalog wall
 * offers, so one control means one thing everywhere.
 *
 * The px values are the stored pref (a 160→420 slider used to write them).
 * Large stops at five columns and will not go under 280px. Compact is the
 * next step on the same canvas, one more column, and will not go under
 * 200px, so the toggle never skips a count. `test/masonry.test.ts` holds
 * them to that. Catalog walls keep their own seven and five.
 */
export const TILE_STOPS = [
  { px: 190, label: 'Compact', cells: 3, cols: 6, min: 200 },
  { px: 320, label: 'Large', cells: 2, cols: 5, min: 280 },
] as const;

/** The stop a stored size means. */
export function tileStop(tile: number): (typeof TILE_STOPS)[number] {
  let best: (typeof TILE_STOPS)[number] = TILE_STOPS[0];
  for (const s of TILE_STOPS) {
    if (Math.abs(s.px - tile) < Math.abs(best.px - tile)) best = s;
  }
  return best;
}

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
  useLayoutEffect(() => {
    if (!el) return;
    const next = el.clientWidth;
    setW((cur) => (cur === next ? cur : next));
  });
  useLayoutEffect(() => {
    if (!el) return;
    // The assets rail is a grid column that snaps, not a 220 ms width
    // animation. Deferring the write to rAF painted the feed at the old
    // column count in the new canvas width, then recounted — two layouts for
    // one toggle. The effect above re-reads after every commit (Create flipping
    // `data-assets` re-renders this hook's owner once the grid has laid out).
    // ResizeObserver covers a resize that does not re-render React (the window).
    const apply = () => {
      const next = el.clientWidth;
      setW((cur) => (cur === next ? cur : next));
    };
    apply();
    const ro = new ResizeObserver(apply);
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

function cardShare(width: number, cols: number): number {
  return Math.max(1, Math.floor((width - GAP * (cols - 1)) / cols));
}

/**
 * Create feed layout.
 *
 * Large drops a column before its card goes under 280px, and stops at five.
 * Compact is that count plus one, and stops at six, so the two sizes are
 * always neighbours: three and four, four and five, five and six. The
 * columns share the canvas, so the row meets the edge. Phone forces two
 * columns that share the width.
 */
export function masonryLayout(width: number, tile: number, phoneMode: boolean): { tile: number; cols: number } {
  if (width <= 0) return { tile, cols: 1 };
  if (phoneMode) return { tile: Math.floor((width - GAP) / 2), cols: 2 };
  const large = TILE_STOPS[1];
  const compact = TILE_STOPS[0];
  const largeCols = Math.min(large.cols, Math.max(1, Math.floor((width + GAP) / (large.min + GAP))));
  if (tileStop(tile).px === large.px) return { tile: cardShare(width, largeCols), cols: largeCols };
  let cols = Math.min(compact.cols, largeCols + 1);
  if (cols > 1 && cardShare(width, cols) < compact.min) cols = largeCols;
  return { tile: cardShare(width, cols), cols };
}

/**
 * How many columns the feed draws.
 *
 * The wall's count, including when the row is short. An empty column holds
 * the share, so four shots stay the size they would be on a full wall.
 */
export function feedColumnCount(fitting: number): number {
  return Math.max(1, fitting);
}
