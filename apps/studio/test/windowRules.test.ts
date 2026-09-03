import { describe, expect, it } from 'vitest';
import {
  columnStarts,
  dealColumns,
  estimateHeight,
  mountedBand,
  quantize,
  visibleRange,
  windowed,
  WINDOW_THRESHOLD,
} from '../src/layout/canvas/windowRules.js';

describe('the feed window', () => {
  it('engages past the threshold and not before', () => {
    expect(windowed(WINDOW_THRESHOLD)).toBe(false);
    expect(windowed(WINDOW_THRESHOLD + 1)).toBe(true);
  });

  it('estimates a tile from its shape inside the border, plus the gutter', () => {
    // a 4:5 picture at a 390px column: 388 / 0.8 = 485, the border, the 14px gutter
    expect(estimateHeight('done', 0.8, 390)).toBe(485 + 2 + 14);
    // no recorded shape and a failed tile both take the sending stand-in's 4:5
    expect(estimateHeight('done', undefined, 390)).toBe(estimateHeight('sending', undefined, 390));
    expect(estimateHeight('failed', 1.5, 390)).toBe(estimateHeight('sending', undefined, 390));
    expect(estimateHeight('running', 1.5, 300)).toBe(Math.round(298 / 1.5) + 16);
  });

  it('accumulates starts with the column height last', () => {
    expect(columnStarts([10, 20, 30])).toEqual([0, 10, 30, 60]);
    expect(columnStarts([])).toEqual([0]);
  });

  it('finds the tiles that touch a band', () => {
    const starts = columnStarts([100, 100, 100, 100, 100]);
    expect(visibleRange(starts, 0, 100)).toEqual([0, 1]);
    expect(visibleRange(starts, 50, 250)).toEqual([0, 3]);
    expect(visibleRange(starts, 100, 300)).toEqual([1, 3]);
    expect(visibleRange(starts, -500, 50)).toEqual([0, 1]);
    expect(visibleRange(starts, 450, 900)).toEqual([4, 5]);
    expect(visibleRange(starts, 600, 900)).toEqual([5, 5]);
    expect(visibleRange(starts, 300, 300)).toEqual([0, 0]);
    expect(visibleRange([0], 0, 100)).toEqual([0, 0]);
  });

  it('deals by flat index so the newest is always top-left', () => {
    expect(dealColumns(7, 3)).toEqual([
      [0, 3, 6],
      [1, 4],
      [2, 5],
    ]);
    expect(dealColumns(0, 2)).toEqual([[], []]);
    expect(dealColumns(3, 0)).toEqual([[0, 1, 2]]);
  });

  it('keeps a viewport of overscan on either side and reads scroll to a grain', () => {
    expect(mountedBand(1000, 800)).toEqual([200, 2600]);
    expect(quantize(63)).toBe(0);
    expect(quantize(64)).toBe(64);
    expect(quantize(-1)).toBe(-64);
  });
});
