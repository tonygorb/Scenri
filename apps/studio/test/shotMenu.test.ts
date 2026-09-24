import { describe, expect, it, vi } from 'vitest';
import type { FeedNode, ShotSet } from '../src/api.js';
import { shotMenuItems, type ShotMenuBatch } from '../src/layout/canvas/shotMenu.js';

function node(over: Partial<FeedNode> = {}): FeedNode {
  return {
    id: 'n1',
    projectId: 'p',
    parentId: null,
    kind: 'generation',
    engineId: 'demo',
    status: 'done',
    images: ['x'],
    costUsd: 0,
    durationMs: 1,
    kept: false,
    error: null,
    createdAt: '2026-01-01T00:00:00Z',
    brief: null,
    archived: false,
    batchId: null,
    batchIndex: 0,
    promptHead: 'Dark stained timber frames a tall doorway',
    childCount: 0,
    ...over,
  };
}

const set = (over: Partial<ShotSet> = {}): ShotSet => ({
  id: 's1',
  brandId: 'b',
  name: 'test123',
  slug: 'test123',
  createdAt: '',
  updatedAt: '',
  ...over,
});

function batch(over: Partial<ShotMenuBatch> = {}): ShotMenuBatch {
  return {
    count: 3,
    allKept: false,
    archived: false,
    onKeep: vi.fn(),
    onArchive: vi.fn(),
    onRestore: vi.fn(),
    onDelete: vi.fn(),
    onRemoveFromSet: vi.fn(),
    ...over,
  };
}

const keys = (n: FeedNode, opts: Parameters<typeof shotMenuItems>[1]) => shotMenuItems(n, opts).map((i) => i.key);

describe('shotMenuItems', () => {
  it('Keep, Remove from set and Archive act on this shot when nothing is picked', () => {
    const onToggleKeep = vi.fn();
    const onArchive = vi.fn();
    const onRemoveFromSet = vi.fn();
    const inSet = set();
    const items = shotMenuItems(node(), {
      chosen: false,
      batching: false,
      versions: 0,
      onOpen: vi.fn(),
      onToggleKeep,
      onArchive,
      inSet,
      onRemoveFromSet,
    });
    expect(items.find((i) => i.key === 'open')?.label).toBe('Open');
    expect(items.map((i) => i.icon)).toEqual(['open', 'keep', 'unset', 'archive']);
    expect(items.map((i) => i.label)).toContain('Add to Keepers');
    expect(items.map((i) => i.label)).toContain('Remove from test123');
    expect(items.map((i) => i.label)).toContain('Archive');

    items.find((i) => i.key === 'keep')?.onSelect();
    items.find((i) => i.key === 'unset-s1')?.onSelect();
    items.find((i) => i.key === 'archive')?.onSelect();
    expect(onToggleKeep).toHaveBeenCalledOnce();
    expect(onRemoveFromSet).toHaveBeenCalledWith(inSet);
    expect(onArchive).toHaveBeenCalledOnce();
  });

  it('on All shots, lists every set this shot is filed in', () => {
    const a = set({ id: 'a', name: 'Spring' });
    const b = set({ id: 'b', name: 'Autumn' });
    const items = shotMenuItems(node(), {
      chosen: false,
      batching: false,
      versions: 0,
      onOpen: vi.fn(),
      filedIn: [a, b],
      onRemoveFromSet: vi.fn(),
    });
    expect(items.map((i) => i.label)).toEqual(expect.arrayContaining(['Remove from Spring', 'Remove from Autumn']));
  });

  it('a right-click on a picked tile Keep/Archive/Remove acts on the whole pick', () => {
    const oneShotKeep = vi.fn();
    const oneShotArchive = vi.fn();
    const oneShotRemove = vi.fn();
    const pick = batch();
    const inSet = set();
    const items = shotMenuItems(node(), {
      chosen: true,
      batching: true,
      versions: 2,
      onOpen: vi.fn(),
      onPick: vi.fn(),
      onToggleKeep: oneShotKeep,
      onArchive: oneShotArchive,
      onRemoveFromSet: oneShotRemove,
      onBranch: vi.fn(),
      onVersions: vi.fn(),
      inSet,
      batch: pick,
    });
    expect(items.find((i) => i.key === 'open')?.label).toBe('Open');
    expect(items.map((i) => i.icon)).toEqual(['open', 'select', 'keep', 'unset', 'archive']);
    expect(items.find((i) => i.key === 'pick')?.label).toBe('Deselect this shot');
    expect(items.map((i) => i.label)).toEqual(
      expect.arrayContaining(['Add 3 shots to Keepers', 'Remove 3 shots from test123', 'Archive 3 shots']),
    );
    expect(items.some((i) => i.key === 'picked')).toBe(false);
    expect(
      keys(node(), {
        chosen: true,
        batching: true,
        versions: 2,
        onOpen: vi.fn(),
        onPick: vi.fn(),
        onToggleKeep: oneShotKeep,
        onArchive: oneShotArchive,
        onRemoveFromSet: oneShotRemove,
        onBranch: vi.fn(),
        onVersions: vi.fn(),
        inSet,
        batch: pick,
      }),
    ).toEqual(['open', 'pick', 'keep', 'unset-s1', 'archive']);

    items.find((i) => i.key === 'keep')?.onSelect();
    items.find((i) => i.key === 'unset-s1')?.onSelect();
    items.find((i) => i.key === 'archive')?.onSelect();
    expect(pick.onKeep).toHaveBeenCalledOnce();
    expect(pick.onRemoveFromSet).toHaveBeenCalledWith(inSet);
    expect(pick.onArchive).toHaveBeenCalledOnce();
    expect(oneShotKeep).not.toHaveBeenCalled();
    expect(oneShotArchive).not.toHaveBeenCalled();
    expect(oneShotRemove).not.toHaveBeenCalled();
  });

  it('a right-click on an unpicked tile during a pick still acts on that shot', () => {
    const onToggleKeep = vi.fn();
    const onArchive = vi.fn();
    const pick = batch();
    const items = shotMenuItems(node(), {
      chosen: false,
      batching: true,
      versions: 0,
      onOpen: vi.fn(),
      onToggleKeep,
      onArchive,
      inSet: set(),
      onRemoveFromSet: vi.fn(),
      batch: pick,
    });
    items.find((i) => i.key === 'keep')?.onSelect();
    items.find((i) => i.key === 'archive')?.onSelect();
    expect(onToggleKeep).toHaveBeenCalledOnce();
    expect(onArchive).toHaveBeenCalledOnce();
    expect(pick.onKeep).not.toHaveBeenCalled();
    expect(pick.onArchive).not.toHaveBeenCalled();
  });

  it('does not mix this tile’s other sets into a batch Remove', () => {
    const pick = batch();
    const items = shotMenuItems(node(), {
      chosen: true,
      batching: true,
      versions: 0,
      onOpen: vi.fn(),
      filedIn: [set({ id: 'a', name: 'Spring' }), set({ id: 'b', name: 'Autumn' })],
      onRemoveFromSet: vi.fn(),
      batch: pick,
    });
    expect(items.some((i) => i.key.startsWith('unset-'))).toBe(false);
  });

  it('drops Refine and versions while a batch is being built', () => {
    const k = keys(node({ childCount: 3 }), {
      chosen: true,
      batching: true,
      versions: 3,
      onOpen: vi.fn(),
      onBranch: vi.fn(),
      onVersions: vi.fn(),
      batch: batch(),
    });
    expect(k).not.toContain('branch');
    expect(k).not.toContain('versions');
  });

  it('an archived pick offers Restore and Delete N, not Archive', () => {
    const pick = batch({ archived: true, count: 2 });
    const items = shotMenuItems(node({ archived: true }), {
      chosen: true,
      batching: true,
      versions: 0,
      onOpen: vi.fn(),
      batch: pick,
    });
    expect(items.map((i) => i.label)).toEqual(
      expect.arrayContaining(['Restore 2 shots', 'Delete 2 shots permanently']),
    );
    expect(items.map((i) => i.label)).not.toContain('Archive');
    items.find((i) => i.key === 'archive')?.onSelect();
    items.find((i) => i.key === 'delete')?.onSelect();
    expect(pick.onRestore).toHaveBeenCalledOnce();
    expect(pick.onDelete).toHaveBeenCalledOnce();
    expect(pick.onArchive).not.toHaveBeenCalled();
  });
});
