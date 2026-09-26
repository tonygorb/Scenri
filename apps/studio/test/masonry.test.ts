import { describe, it, expect } from 'vitest';
import {
  GAP,
  SHELF_LENGTH,
  TILE_DEFAULT,
  TILE_STOPS,
  feedColumnCount,
  masonryLayout,
  nearestTileStop,
} from '../src/layout/masonry.js';

describe('nearestTileStop', () => {
  it('leaves a stop alone', () => {
    for (const s of TILE_STOPS) expect(nearestTileStop(s.px)).toBe(s.px);
  });

  it('snaps every value the old 160-420 slider could store', () => {
    for (let px = 160; px <= 420; px += 20) {
      expect(TILE_STOPS.some((s) => s.px === nearestTileStop(px))).toBe(true);
    }
  });

  it('snaps to the closer of two stops', () => {
    expect(nearestTileStop(200)).toBe(190);
    expect(nearestTileStop(340)).toBe(320);
    expect(nearestTileStop(420)).toBe(320);
  });

  it('falls back to the default for a junk pref', () => {
    expect(nearestTileStop(undefined)).toBe(TILE_DEFAULT);
    expect(nearestTileStop('big')).toBe(TILE_DEFAULT);
    expect(nearestTileStop(Number.NaN)).toBe(TILE_DEFAULT);
  });
});

describe('the tile stops earn their place', () => {
  // The slider they replace had fourteen stops feeding a layout that only
  // changes when the column count flips, so most of them moved nothing. Two
  // views, like every catalog wall, and each one visibly different.
  it('steps by one column, so three large columns are four compact', () => {
    const [compact, large] = TILE_STOPS;
    for (let width = 700; width <= 1800; width += 10) {
      const c = masonryLayout(width, compact.px, false);
      const l = masonryLayout(width, large.px, false);
      expect(c.cols).toBe(l.cols + 1);
    }
    expect(masonryLayout(1070, large.px, false).cols).toBe(3);
    expect(masonryLayout(1070, compact.px, false).cols).toBe(4);
  });

  it('orders wider tiles into fewer columns', () => {
    const cols = TILE_STOPS.map((s) => masonryLayout(1400, s.px, false).cols);
    expect(cols).toEqual([...cols].sort((a, b) => b - a));
  });

  it('is still two columns on a phone whatever the stop', () => {
    for (const s of TILE_STOPS) {
      const out = masonryLayout(390, s.px, true);
      expect(out.cols).toBe(2);
      expect(out.tile).toBe(Math.floor((390 - GAP) / 2));
    }
  });

  it('drops a column on a smaller canvas and keeps each card wide enough', () => {
    for (const stop of TILE_STOPS) {
      let prevCols = Infinity;
      const wide = masonryLayout(1800, stop.px, false);
      expect(wide.cols).toBe(stop.cols);
      for (let width = 1800; width >= 700; width -= 10) {
        const out = masonryLayout(width, stop.px, false);
        expect(out.cols).toBeLessThanOrEqual(stop.cols);
        expect(out.cols).toBeLessThanOrEqual(prevCols);
        const used = out.tile * out.cols + GAP * (out.cols - 1);
        expect(used).toBeLessThanOrEqual(width);
        expect(width - used).toBeLessThan(out.cols);
        if (out.cols > 1) expect(out.tile).toBeGreaterThanOrEqual(stop.min);
        prevCols = out.cols;
      }
      expect(masonryLayout(800, stop.px, false).cols).toBeLessThan(wide.cols);
    }
  });

  it('keeps the wall columns when the row is short', () => {
    expect(feedColumnCount(5)).toBe(5);
    expect(feedColumnCount(7)).toBe(7);
    expect(feedColumnCount(2)).toBe(2);
    expect(feedColumnCount(0)).toBe(1);
  });
});

describe('a Home shelf never strands a card', () => {
  // Every column count a wall can draw at that density, a phone's two included:
  // large stops at five, compact at seven.
  const reach = { 5: [2, 3, 4, 5], 7: [2, 3, 4, 5, 6, 7] } as const;

  it('leaves no single card on its last row at any count', () => {
    for (const density of [5, 7] as const) {
      for (const cols of reach[density]) expect(SHELF_LENGTH[density] % cols).not.toBe(1);
    }
  });

  it('is two rows at most when the wall is at its widest', () => {
    for (const density of [5, 7] as const) expect(SHELF_LENGTH[density]).toBeLessThanOrEqual(2 * density);
  });
});
