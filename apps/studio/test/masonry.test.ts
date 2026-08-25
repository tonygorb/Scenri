import { describe, it, expect } from 'vitest';
import { dealOrdinals, GAP, TILE_DEFAULT, TILE_STOPS, masonryLayout, nearestTileStop } from '../src/layout/masonry.js';

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
  it('each stop lands on a different column count at every usable width', () => {
    // from the narrowest canvas that is not phone mode (a 768px viewport less
    // its gutters) up through a wide desktop with the assets column open
    for (const width of [700, 728, 760, 920, 1000, 1400, 1800]) {
      const cols = TILE_STOPS.map((s) => masonryLayout(width, s.px, false).cols);
      expect(new Set(cols).size).toBe(TILE_STOPS.length);
    }
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

  it('shares leftover width so columns fill the canvas', () => {
    for (const width of [700, 920, 1400, 1600, 1800]) {
      for (const s of TILE_STOPS) {
        const out = masonryLayout(width, s.px, false);
        const used = out.tile * out.cols + GAP * (out.cols - 1);
        expect(used).toBeLessThanOrEqual(width);
        expect(width - used).toBeLessThan(out.cols);
      }
    }
  });
});

describe('dealOrdinals', () => {
  // groups are newest-first, matching the feed; a tile's column is ordinal % cols
  it('reproduces the classic far-end deal for all-singleton groups', () => {
    expect(dealOrdinals([1, 1, 1, 1], 3).flat()).toEqual([3, 2, 1, 0]);
  });

  it('reads an expanded run left to right from column 0', () => {
    const [run] = dealOrdinals([4], 3);
    expect(run).toEqual([0, 1, 2, 3]);
    // take 1 owns the leftmost column; take 4 wraps back under it
    expect(run.map((o) => o % 3)).toEqual([0, 1, 2, 0]);
  });

  it('aligns a mid-feed run to a column boundary on both sides', () => {
    // newest single, a 4-take run, then two older singles, over 3 columns
    const ords = dealOrdinals([1, 4, 1, 1], 3);
    expect(ords[3]).toEqual([0]);
    expect(ords[2]).toEqual([1]);
    expect(ords[1]).toEqual([3, 4, 5, 6]);
    expect(ords[1].map((o) => o % 3)).toEqual([0, 1, 2, 0]);
    expect(ords[0]).toEqual([9]);
  });

  it('a prepend renumbers nothing that already exists', () => {
    const before = dealOrdinals([4, 1, 1], 3);
    const after = dealOrdinals([1, 4, 1, 1], 3);
    expect(after.slice(1)).toEqual(before);
  });

  it('hands out unique, non-negative ordinals whatever the mix', () => {
    const flat = dealOrdinals([2, 5, 1, 3, 1], 4).flat();
    expect(new Set(flat).size).toBe(flat.length);
    for (const o of flat) expect(o).toBeGreaterThanOrEqual(0);
  });
});
