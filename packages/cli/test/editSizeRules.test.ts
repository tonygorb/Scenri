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
