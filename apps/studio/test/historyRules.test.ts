import { describe, it, expect } from 'vitest';
import type { FeedNode } from '../src/api.js';
import { stepLabel, trailOf } from '../src/layout/detail/historyRules.js';

let seq = 0;
function node(overrides: Partial<FeedNode> = {}): FeedNode {
  seq += 1;
  return {
    id: `n${seq}`,
    projectId: 'p1',
    parentId: null,
    kind: 'edit',
    promptHead: 'warmer light',
    childCount: 0,
    durationMs: null,
    batchId: null,
    batchIndex: 0,
    engineId: 'demo',
    status: 'done',
    images: [`h${seq}`],
    costUsd: 0,
    kept: false,
    error: null,
    createdAt: `2026-09-06T10:00:${String(seq).padStart(2, '0')}Z`,
    brief: null,
    archived: false,
    ...overrides,
  };
}
const ids = (steps: ReturnType<typeof trailOf>) => steps.map((s) => s.node.id);
const labels = (steps: ReturnType<typeof trailOf>) => steps.map((s) => s.label);

describe('stepLabel', () => {
  it('calls the first step the original and the rest by number', () => {
    expect(stepLabel(0)).toBe('Original');
    expect(stepLabel(3)).toBe('Refinement 3');
  });
});

describe('trailOf', () => {
  it('reads a chain as Original, 1, 2 in the order they were made', () => {
    const root = node({ kind: 'generation' });
    const r1 = node({ parentId: root.id });
    const r2 = node({ parentId: r1.id });
    const steps = trailOf([root, r1, r2], r2, []);
    expect(ids(steps)).toEqual([root.id, r1.id, r2.id]);
    expect(labels(steps)).toEqual(['Original', 'Refinement 1', 'Refinement 2']);
    expect(steps.map((s) => s.index)).toEqual([0, 1, 2]);
    expect(steps.every((s) => s.from === null)).toBe(true);
    expect(steps.every((s) => s.state === 'ready')).toBe(true);
  });

  it('is one row whichever step a refinement was made from, and names the source only on a branch', () => {
    const root = node({ kind: 'generation' });
    const r1 = node({ parentId: root.id });
    const r2 = node({ parentId: root.id });
    const r3 = node({ parentId: r1.id });
    const steps = trailOf([root, r1, r2, r3], r2, []);
    expect(labels(steps)).toEqual(['Original', 'Refinement 1', 'Refinement 2', 'Refinement 3']);
    expect(steps.map((s) => s.from)).toEqual([null, null, 'the original', 'Refinement 1']);
  });

  it('is the same row whichever step is on the stage', () => {
    const root = node({ kind: 'generation' });
    const r1 = node({ parentId: root.id });
    const r2 = node({ parentId: root.id });
    const history = [root, r1, r2];
    expect(ids(trailOf(history, root, []))).toEqual(ids(trailOf(history, r2, [])));
  });

  it('keeps the step on the stage while it renders, and after it fails, and drops any other without a picture', () => {
    const root = node({ kind: 'generation' });
    const dead = node({ parentId: root.id, status: 'error', images: [] });
    const r2 = node({ parentId: root.id });
    const wait = node({ parentId: r2.id, status: 'running', images: [] });
    const rendering = trailOf([root, dead, r2, wait], wait, []);
    expect(ids(rendering)).toEqual([root.id, r2.id, wait.id]);
    expect(rendering.map((s) => s.state)).toEqual(['ready', 'ready', 'pending']);
    expect(labels(rendering)).toEqual(['Original', 'Refinement 1', 'Refinement 2']);
    const failed = trailOf([root, dead, r2], dead, []);
    expect(ids(failed)).toEqual([root.id, dead.id, r2.id]);
    expect(failed[1].state).toBe('failed');
  });

  it('folds in a refinement the feed already holds but the history predates, by its parent', () => {
    const root = node({ kind: 'generation' });
    const r1 = node({ parentId: root.id });
    const landed = node({ parentId: r1.id });
    const stranger = node({ parentId: 'elsewhere' });
    const steps = trailOf([root, r1], r1, [stranger, landed]);
    expect(ids(steps)).toEqual([root.id, r1.id, landed.id]);
  });

  it('never lists the shot on the stage twice, whether the history or the feed holds it', () => {
    const root = node({ kind: 'generation' });
    const r1 = node({ parentId: root.id });
    expect(ids(trailOf([root], r1, [r1]))).toEqual([root.id, r1.id]);
    expect(ids(trailOf([root, r1], r1, [r1]))).toEqual([root.id, r1.id]);
  });

  it('appends the shot on the stage when a capped history cut it, and shows the freshest copy of it', () => {
    const root = node({ kind: 'generation' });
    const r1 = node({ parentId: root.id });
    const stale = node({ parentId: r1.id, kept: false });
    const fresh = { ...stale, kept: true };
    const steps = trailOf([root, r1], fresh, []);
    expect(ids(steps)).toEqual([root.id, r1.id, fresh.id]);
    expect(steps[2].node.kept).toBe(true);
    const inPlace = trailOf([root, r1, stale], fresh, []);
    expect(inPlace[2].node.kept).toBe(true);
  });

  it('is one step for a shot with no history', () => {
    const root = node({ kind: 'generation' });
    const steps = trailOf([root], root, []);
    expect(labels(steps)).toEqual(['Original']);
  });

  it('counts refinements only, so a row without its original does not call a refinement the original', () => {
    const r1 = node({ parentId: 'archived-root' });
    const r2 = node({ parentId: r1.id });
    const steps = trailOf([r1, r2], r2, []);
    expect(labels(steps)).toEqual(['Refinement 1', 'Refinement 2']);
    expect(steps[0].from).toBeNull();
  });

  it('keeps every step on its own record, never its position', () => {
    const root = node({ kind: 'generation' });
    const many = Array.from({ length: 20 }, () => node({ parentId: root.id }));
    const steps = trailOf([root, ...many], many[7], []);
    expect(steps[8].node).toBe(many[7]);
    expect(steps[8].label).toBe('Refinement 8');
    expect(new Set(ids(steps)).size).toBe(21);
  });
});
