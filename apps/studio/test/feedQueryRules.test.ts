import { describe, expect, it } from 'vitest';
import type { FeedCounts, FeedNode } from '../src/api.js';
import {
  admits,
  appendPage,
  countsAfter,
  feedSearchParams,
  insertSorted,
  lensAdmits,
  placeAdmits,
  queryKey,
  refreshFirst,
  replaceById,
  withoutIds,
} from '../src/views/create/feedQueryRules.js';

const node = (over: Partial<FeedNode> = {}): FeedNode => ({
  id: 'a',
  projectId: 'p',
  parentId: 'root',
  kind: 'generation',
  engineId: 'demo',
  status: 'done',
  images: ['h'],
  costUsd: 0,
  durationMs: null,
  kept: false,
  error: null,
  createdAt: '2026-09-01 10:00:00.000',
  brief: null,
  archived: false,
  batchId: null,
  batchIndex: 0,
  promptHead: 'a shot',
  childCount: 0,
  ...over,
});
const counts: FeedCounts = { total: 11, all: 10, keepers: 2, archived: 1, ungrouped: 4 };

describe('queryKey and feedSearchParams', () => {
  it('names a query by everything that changes its answer, and nothing else', () => {
    expect(queryKey('b', {})).toBe(queryKey('b', { lens: 'all', sort: 'newest', q: '  ' }));
    expect(queryKey('b', { lens: 'keepers' })).not.toBe(queryKey('b', {}));
    expect(queryKey('b', { cursor: 'x' })).toBe(queryKey('b', {}));
  });

  it('sends nothing for a default and every non-default as a param', () => {
    expect(feedSearchParams({})).toBe('');
    expect(feedSearchParams({ lens: 'archived', set: 's1', q: ' linen ', sort: 'cost', limit: 60, cursor: 'c' })).toBe(
      '?lens=archived&set=s1&q=linen&sort=cost&limit=60&cursor=c',
    );
    expect(feedSearchParams({ ungrouped: true, lineage: 'n1', token: 'p-1' })).toBe(
      '?ungrouped=1&lineage=n1&token=p-1',
    );
  });
});

describe('admission', () => {
  it('the lens decides by the two flags', () => {
    expect(lensAdmits(node(), 'all')).toBe(true);
    expect(lensAdmits(node({ archived: true }), 'all')).toBe(false);
    expect(lensAdmits(node({ kept: true }), 'keepers')).toBe(true);
    expect(lensAdmits(node({ kept: true, archived: true }), 'keepers')).toBe(false);
    expect(lensAdmits(node({ archived: true }), 'archived')).toBe(true);
  });

  it('the place decides by set, ungrouped or lineage, never for a root', () => {
    const inSet = (id: string) => id === 'a';
    expect(placeAdmits(node(), { set: 's' }, { inSet })).toBe(true);
    expect(placeAdmits(node({ id: 'b' }), { set: 's' }, { inSet })).toBe(false);
    expect(placeAdmits(node(), { ungrouped: true }, { inAnySet: () => false })).toBe(true);
    expect(placeAdmits(node(), { ungrouped: true }, { inAnySet: () => true })).toBe(false);
    expect(placeAdmits(node(), { lineage: 'x' }, { inLineage: (n) => n.parentId === 'x' })).toBe(false);
    expect(placeAdmits(node({ kind: 'root' }), {}, {})).toBe(false);
  });

  it('cannot tell while a search is active', () => {
    expect(admits(node(), { q: 'linen' }, {})).toBeNull();
    expect(admits(node(), {}, {})).toBe(true);
  });
});

describe('countsAfter', () => {
  it('moves one record between the lenses', () => {
    expect(countsAfter(counts, node(), node({ kept: true }), true)).toEqual({ ...counts, keepers: 3 });
    expect(countsAfter(counts, node({ kept: true }), node({ archived: true }), true)).toEqual({
      ...counts,
      all: 9,
      keepers: 1,
      archived: 2,
    });
    expect(countsAfter(counts, null, node(), true)).toEqual({ ...counts, all: 11 });
    expect(countsAfter(counts, node({ archived: true }), null, true)).toEqual({ ...counts, archived: 0 });
  });

  it('leaves the counts alone for a record outside the place, and keeps the reference when nothing moved', () => {
    expect(countsAfter(counts, node(), node({ kept: true }), false)).toBe(counts);
    expect(countsAfter(counts, node(), node({ error: 'x' }), true)).toBe(counts);
  });
});

describe('pages', () => {
  const a = node({ id: 'a', createdAt: '2026-09-01 10:00:03.000' });
  const b = node({ id: 'b', createdAt: '2026-09-01 10:00:02.000' });
  const c = node({ id: 'c', createdAt: '2026-09-01 10:00:01.000' });

  it('replaces by id and keeps unrelated references', () => {
    const next = replaceById([a, b, c], { ...b, kept: true });
    expect(next[0]).toBe(a);
    expect(next[2]).toBe(c);
    expect(next[1].kept).toBe(true);
    const items = [a, b];
    expect(replaceById(items, node({ id: 'zzz' }))).toBe(items);
  });

  it('drops by id, untouched when nothing matched', () => {
    const items = [a, b, c];
    expect(withoutIds(items, ['zzz'])).toBe(items);
    expect(withoutIds(items, ['b'])).toEqual([a, c]);
  });

  it('inserts where the sort would put it, and waits for paging past the loaded end', () => {
    const fresh = node({ id: 'd', createdAt: '2026-09-01 10:00:04.000' });
    expect(insertSorted([a, b, c], fresh, 'newest', false).map((n) => n.id)).toEqual(['d', 'a', 'b', 'c']);
    const old = node({ id: 'e', createdAt: '2026-09-01 09:00:00.000' });
    expect(insertSorted([a, b, c], old, 'newest', false)).toEqual([a, b, c]);
    expect(insertSorted([a, b, c], old, 'newest', true).map((n) => n.id)).toEqual(['a', 'b', 'c', 'e']);
    expect(insertSorted([c, b, a], fresh, 'oldest', false)).toEqual([c, b, a]);
    expect(insertSorted([c, b, a], fresh, 'oldest', true).map((n) => n.id)).toEqual(['c', 'b', 'a', 'd']);
  });

  it('appends a page without duplicates and leads with a refetched first page', () => {
    const items = [a, b];
    expect(appendPage(items, [b, c]).map((n) => n.id)).toEqual(['a', 'b', 'c']);
    expect(appendPage(items, [a])).toBe(items);
    const fresh = node({ id: 'd', createdAt: '2026-09-01 10:00:04.000' });
    expect(refreshFirst([a, b, c], [fresh, a]).map((n) => n.id)).toEqual(['d', 'a', 'b', 'c']);
  });
});
