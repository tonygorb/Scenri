import { describe, it, expect } from 'vitest';
import type { TreeNode } from '../src/api.js';
import { FEED_SORTS, LENSES, byNewest, isFeedSort, isLens } from '../src/feedRules.js';

let seq = 0;
function node(overrides: Partial<TreeNode> = {}): TreeNode {
  seq += 1;
  return {
    id: `n${seq}`,
    projectId: 'p1',
    parentId: null,
    kind: 'generation',
    prompt: 'a bottle on a plinth',
    promptHead: 'a bottle on a plinth',
    childCount: 0,
    durationMs: null,
    batchId: null,
    batchIndex: 0,
    engineId: 'engine-a',
    status: 'done',
    images: [],
    costUsd: 0,
    kept: false,
    error: null,
    createdAt: '2026-08-01T00:00:00Z',
    overlays: {},
    brief: null,
    archived: false,
    ...overrides,
  };
}

describe('byNewest', () => {
  it('orders descending by createdAt', () => {
    const old = node({ createdAt: '2026-01-01T00:00:00Z' });
    const recent = node({ createdAt: '2026-08-01T00:00:00Z' });
    expect([old, recent].sort(byNewest)).toEqual([recent, old]);
  });

  it('breaks a same-second tie by id, whichever order the rows arrived in', () => {
    // created_at is second-resolution on the server, so the tiebreak is what
    // keeps the feed from reshuffling between two loads
    const a = node({ id: 'node-aaa', createdAt: '2026-08-01T00:00:00Z' });
    const b = node({ id: 'node-bbb', createdAt: '2026-08-01T00:00:00Z' });
    expect([a, b].sort(byNewest).map((n) => n.id)).toEqual(['node-bbb', 'node-aaa']);
    expect([b, a].sort(byNewest).map((n) => n.id)).toEqual(['node-bbb', 'node-aaa']);
  });
});

describe('isFeedSort', () => {
  it('accepts every listed sort and rejects junk', () => {
    for (const s of FEED_SORTS) expect(isFeedSort(s.id)).toBe(true);
    expect(isFeedSort('zzz')).toBe(false);
    expect(isFeedSort(undefined)).toBe(false);
    expect(isFeedSort(null)).toBe(false);
  });
});

describe('isLens', () => {
  it('accepts every listed lens and rejects junk', () => {
    for (const l of LENSES) expect(isLens(l.id)).toBe(true);
    expect(isLens('zzz')).toBe(false);
    expect(isLens(undefined)).toBe(false);
  });

  it('rejects "ungrouped", which is a place now and not a lens', () => {
    expect(isLens('ungrouped')).toBe(false);
  });
});
