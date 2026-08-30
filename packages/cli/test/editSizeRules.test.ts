import { describe, it, expect } from 'vitest';
import { judgeEditSize, SHRINK_FLOOR } from '../src/editSizeRules.js';

describe('judgeEditSize', () => {
  const src = { width: 1000, height: 1250 };

  it('keeps an exact match', () => {
    expect(judgeEditSize(src, { width: 1000, height: 1250 })).toEqual({ action: 'keep' });
  });

  it('keeps a different shape: the aspect check owns ratio failures', () => {
    expect(judgeEditSize(src, { width: 1250, height: 1000 })).toEqual({ action: 'keep' });
    expect(judgeEditSize(src, { width: 1000, height: 1000 })).toEqual({ action: 'keep' });
  });

  it('resizes a same-shape answer that shrank within the floor', () => {
    const v = judgeEditSize(src, { width: 900, height: 1125 });
    expect(v.action).toBe('resize');
    expect(v.action === 'resize' && v.scale).toBeCloseTo(0.9);
  });

  it('resizes a same-shape answer that grew: the canvas is a contract both ways', () => {
    const v = judgeEditSize(src, { width: 1100, height: 1375 });
    expect(v.action).toBe('resize');
    expect(v.action === 'resize' && v.scale).toBeCloseTo(1.1);
  });

  it('rejects a same-shape answer below the floor', () => {
    const v = judgeEditSize(src, { width: 500, height: 625 });
    expect(v.action).toBe('reject');
    expect(v.action === 'reject' && v.scale).toBeCloseTo(0.5);
  });

  it('treats the floor itself as resizable, and a hair under it as failed', () => {
    const at = judgeEditSize(
      { width: 1000, height: 1000 },
      { width: 1000 * SHRINK_FLOOR, height: 1000 * SHRINK_FLOOR },
    );
    expect(at.action).toBe('resize');
    const under = judgeEditSize({ width: 1000, height: 1000 }, { width: 790, height: 790 });
    expect(under.action).toBe('reject');
  });

  it('keeps anything it cannot judge', () => {
    expect(judgeEditSize({ width: 0, height: 0 }, { width: 100, height: 100 })).toEqual({ action: 'keep' });
    expect(judgeEditSize(src, { width: 0, height: 0 })).toEqual({ action: 'keep' });
  });
});

// A fixed-budget engine cannot answer an over-budget source at its own size.
// Its native answer is the honest one: accepted as-is, never inflated back
// into pixels the tool never drew - and the next hop is scale 1.0.
describe('the pixel-budget accept verdict', () => {
  const BUDGET = 1_572_864; // codex, measured

  it('accepts the native answer to an over-budget source', () => {
    const v = judgeEditSize({ width: 1536, height: 1536 }, { width: 1254, height: 1254 }, { pixelBudget: BUDGET });
    expect(v.action).toBe('accept');
    expect(v.action === 'accept' && v.scale).toBeCloseTo(0.816, 2);
  });

  it('repairs the post-expand refine that used to hard-fail', () => {
    // an expand result at 2229x1254 = 2.79MP answered at ~1672x941: scale
    // 0.75 fell under the floor and rejected the node before this verdict
    const v = judgeEditSize({ width: 2229, height: 1254 }, { width: 1672, height: 941 }, { pixelBudget: BUDGET });
    expect(v.action).toBe('accept');
  });

  it('a genuinely broken half-size answer still fails', () => {
    const v = judgeEditSize({ width: 1536, height: 1536 }, { width: 640, height: 640 }, { pixelBudget: BUDGET });
    expect(v.action).toBe('reject');
  });

  it('a sub-budget source is judged exactly as before', () => {
    expect(
      judgeEditSize({ width: 1024, height: 1024 }, { width: 900, height: 900 }, { pixelBudget: BUDGET }).action,
    ).toBe('resize');
    expect(
      judgeEditSize({ width: 1024, height: 1024 }, { width: 700, height: 700 }, { pixelBudget: BUDGET }).action,
    ).toBe('reject');
  });

  it('an answer grown past the source never earns the accept', () => {
    const v = judgeEditSize({ width: 1536, height: 1536 }, { width: 1600, height: 1600 }, { pixelBudget: BUDGET });
    expect(v.action).toBe('resize');
  });
});
