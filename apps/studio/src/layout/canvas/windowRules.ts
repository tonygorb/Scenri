import { GAP } from '../masonry.js';

/**
 * The feed's window: which tiles of a column are in the DOM for a scroll
 * position. Below the threshold every tile is mounted and none of this is
 * consulted, so a small brand's feed is exactly the DOM it was, fixtures and
 * pixels included. The threshold sits under the feed's page size, so a brand
 * with a full first page is windowed from its first paint. Above it a column renders a spacer, the tiles within a
 * viewport of the visible band, and a spacer, from heights that are measured
 * once a tile has been on screen and estimated from its shape until then.
 * The spacers are exact for everything the reader has scrolled past, which
 * is what keeps the scrollbar and the reader's place honest.
 */
export const WINDOW_THRESHOLD = 40;
/** Viewports of tiles kept mounted above and below the visible band. */
const OVERSCAN_VIEWPORTS = 1;
/** Scroll positions are read to this grain: a window that moved less than this did not move. */
const SCROLL_QUANTUM = 64;

type TileKind = 'done' | 'running' | 'failed' | 'sending';

/** Whether a feed of this many tiles is windowed. */
export const windowed = (count: number): boolean => count > WINDOW_THRESHOLD;

export const quantize = (v: number): number => Math.floor(v / SCROLL_QUANTUM) * SCROLL_QUANTUM;

/**
 * A tile's height before it has been measured: the picture box at the
 * column's width inside the cell's 1px border, plus the gutter. A failed
 * tile has no picture and takes the same 4:5 the sending stand-in does.
 */
export function estimateHeight(kind: TileKind, aspect: number | undefined, colWidth: number): number {
  const inner = Math.max(0, colWidth - 2);
  const ar = kind !== 'failed' && aspect && aspect > 0 ? aspect : 4 / 5;
  return Math.round(inner / ar) + 2 + GAP;
}

/** Where each tile of a column starts; one entry more than tiles, the last being the column's height. */
export function columnStarts(heights: number[]): number[] {
  const starts = new Array<number>(heights.length + 1);
  let y = 0;
  for (let i = 0; i < heights.length; i++) {
    starts[i] = y;
    y += heights[i];
  }
  starts[heights.length] = y;
  return starts;
}

/** The tiles [from, to) of a column that touch the band [top, bottom). */
export function visibleRange(starts: number[], top: number, bottom: number): [number, number] {
  const n = starts.length - 1;
  if (n <= 0 || bottom <= top) return [0, 0];
  // the first tile whose end is past the top
  let lo = 0;
  let hi = n;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (starts[mid + 1] <= top) lo = mid + 1;
    else hi = mid;
  }
  const from = lo;
  // the first tile whose start is at or past the bottom
  lo = from;
  hi = n;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (starts[mid] < bottom) lo = mid + 1;
    else hi = mid;
  }
  return [from, lo];
}

/**
 * The tiles of each column, by flat index: the newest tile is ordinal 0 and
 * always top-left, the feed reads left to right and then down. One tile per
 * shot since a run became one card, so the deal needs no group sizes.
 */
export function dealColumns(count: number, cols: number): number[][] {
  const out: number[][] = Array.from({ length: Math.max(1, cols) }, () => []);
  for (let i = 0; i < count; i++) out[i % out.length].push(i);
  return out;
}

/** The band of the feed to keep mounted for a scroll position: the viewport and its overscan, in feed coordinates. */
export function mountedBand(top: number, viewport: number): [number, number] {
  const over = viewport * OVERSCAN_VIEWPORTS;
  return [top - over, top + viewport + over];
}
