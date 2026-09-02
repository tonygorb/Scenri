import { describe, it, expect } from 'vitest';
import type { TreeNode } from '../src/api.js';
import { mergeNodes } from '../src/app/activityMerge.js';

const node = (id: string, over: Partial<TreeNode> = {}): TreeNode => ({
  id,
  projectId: 'p',
  parentId: null,
  kind: 'generation',
  prompt: 'x',
  engineId: 'demo',
  status: 'running',
  images: [],
  costUsd: 0,
  durationMs: null,
  kept: false,
  error: null,
  createdAt: '2026-09-02 10:00:00.000',
  overlays: {},
  brief: null,
  archived: false,
  batchId: null,
  batchIndex: 0,
  ...over,
});

/**
 * The bell's poll already carries the fresh record of every shot in flight.
 * Folding those records into the feed by id is what replaces the old
 * "something changed, refetch the whole workspace".
 */
describe('mergeNodes', () => {
  it('hands back the same list when nothing it was told about changed', () => {
    const prev = [node('a'), node('b')];
    const out = mergeNodes(prev, [node('a'), node('b')]);
    expect(out.nodes).toBe(prev);
    expect(out.unknown).toBe(false);
  });

  it('replaces the shot that finished in place and leaves the rest by reference', () => {
    const a = node('a');
    const b = node('b');
    const prev = [a, b];
    const landed = node('b', { status: 'done', images: ['h'] });
    const out = mergeNodes(prev, [landed]);
    expect(out.nodes).not.toBe(prev);
    expect(out.nodes[0]).toBe(a);
    expect(out.nodes[1]).toBe(landed);
    expect(out.nodes.map((n) => n.id)).toEqual(['a', 'b']);
  });

  it('lands two finishes from one answer', () => {
    const prev = [node('a'), node('b'), node('c')];
    const out = mergeNodes(prev, [
      node('c', { status: 'done', images: ['hc'] }),
      node('a', { status: 'done', images: ['ha'] }),
    ]);
    expect(out.nodes.map((n) => n.status)).toEqual(['done', 'running', 'done']);
  });

  it('sees the delivered size, the wall time and the outcome change, not only the status', () => {
    const prev = [node('a', { status: 'done', images: ['h'] })];
    const sized = node('a', { status: 'done', images: ['h'], brief: { rendered: { sizes: [[64, 64]] } } as any });
    expect(mergeNodes(prev, [sized]).nodes[0]).toBe(sized);
    const timed = node('a', { status: 'done', images: ['h'], durationMs: 5 });
    expect(mergeNodes(prev, [timed]).nodes[0]).toBe(timed);
    const failed = node('a', { status: 'error', error: 'refused' });
    expect(mergeNodes(prev, [failed]).nodes[0]).toBe(failed);
  });

  it('flags a shot it has never seen, so the caller can ask for the whole workspace once', () => {
    const prev = [node('a')];
    const out = mergeNodes(prev, [node('a', { status: 'done', images: ['h'] }), node('z')]);
    expect(out.unknown).toBe(true);
    expect(out.nodes).toBe(prev);
  });
});
