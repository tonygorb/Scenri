import type { FeedCounts, FeedNode, FeedQuery } from '../../api.js';
import { byNewest } from '../../feedRules.js';

/**
 * The client's half of the paged feed: what a page's query is called, how a
 * changed or new record fits into the pages already loaded, and how the lens
 * counts move with it. Pure, so the hook stays a thin fetch loop and the
 * rules are tested here.
 */

/** One string per distinct query, so two renders asking the same thing share a fetch. */
export function queryKey(brandId: string, q: FeedQuery): string {
  return [
    brandId,
    q.lens ?? 'all',
    q.set ?? '',
    q.ungrouped ? 'ungrouped' : '',
    q.lineage ?? '',
    q.token ?? '',
    (q.q ?? '').trim(),
    q.sort ?? 'newest',
    q.limit ?? '',
  ].join('|');
}

/** The same ordering the server's ORDER BY produces, so a local insert lands where a refetch would. */
function comparator(sort: FeedQuery['sort']): (a: FeedNode, b: FeedNode) => number {
  switch (sort) {
    case 'oldest':
      return (a, b) => byNewest(b, a);
    case 'cost':
      return (a, b) => b.costUsd - a.costUsd || byNewest(a, b);
    case 'keepers':
      return (a, b) => Number(b.kept) - Number(a.kept) || byNewest(a, b);
    default:
      return byNewest;
  }
}

/** What a place needs to know that only the page holding it knows. */
export interface AdmitContext {
  /** Whether a shot is in the set the query names. */
  inSet?: (id: string) => boolean;
  /** Whether a shot is in any set at all. */
  inAnySet?: (id: string) => boolean;
  /** Whether a shot belongs to the lineage the query names. */
  inLineage?: (node: FeedNode) => boolean;
}

/** Whether the place (set, ungrouped, lineage) admits a shot, before any lens. */
export function placeAdmits(node: FeedNode, q: FeedQuery, ctx: AdmitContext): boolean {
  if (node.kind === 'root') return false;
  if (q.lineage) return ctx.inLineage ? ctx.inLineage(node) : false;
  if (q.set) return ctx.inSet ? ctx.inSet(node.id) : false;
  if (q.ungrouped) return ctx.inAnySet ? !ctx.inAnySet(node.id) : false;
  return true;
}

/** Whether the lens admits a shot the place already admits. */
export function lensAdmits(node: FeedNode, lens: FeedQuery['lens']): boolean {
  if (lens === 'archived') return node.archived;
  if (lens === 'keepers') return !node.archived && node.kept;
  return !node.archived;
}

/**
 * Whether the loaded pages should hold this record. `null` when the client
 * cannot tell: a search is active and only the server knows what matches.
 */
export function admits(node: FeedNode, q: FeedQuery, ctx: AdmitContext): boolean | null {
  if (q.q?.trim()) return null;
  return placeAdmits(node, q, ctx) && lensAdmits(node, q.lens);
}

/** What one shot contributes to the lens counts of its place. */
function tally(n: FeedNode | null): { all: number; keepers: number; archived: number } {
  if (!n || n.kind === 'root') return { all: 0, keepers: 0, archived: 0 };
  return { all: n.archived ? 0 : 1, keepers: !n.archived && n.kept ? 1 : 0, archived: n.archived ? 1 : 0 };
}

/**
 * The counts after one record changed (or arrived, or went), given both
 * versions of it. Only the place decides whether it counts; the lens never
 * does, because the counts describe every lens at once.
 */
export function countsAfter(
  counts: FeedCounts,
  before: FeedNode | null,
  after: FeedNode | null,
  inPlace: boolean,
): FeedCounts {
  if (!inPlace) return counts;
  const b = tally(before);
  const a = tally(after);
  const next = {
    ...counts,
    all: counts.all + a.all - b.all,
    keepers: counts.keepers + a.keepers - b.keepers,
    archived: counts.archived + a.archived - b.archived,
  };
  return next.all === counts.all && next.keepers === counts.keepers && next.archived === counts.archived
    ? counts
    : next;
}

/** The pages with one record swapped in by id; the same array when it is not held or is the same object. */
export function replaceById(items: FeedNode[], node: FeedNode): FeedNode[] {
  const i = items.findIndex((n) => n.id === node.id);
  if (i === -1 || items[i] === node) return items;
  const next = [...items];
  next[i] = node;
  return next;
}

/** The pages without these ids; the same array when none of them was held. */
export function withoutIds(items: FeedNode[], ids: readonly string[]): FeedNode[] {
  const gone = new Set(ids);
  return items.some((n) => gone.has(n.id)) ? items.filter((n) => !gone.has(n.id)) : items;
}

/**
 * A record put where the sort would have the server put it. A record that
 * belongs after the last loaded page while more pages remain is left for
 * paging to bring in, so the pages never hold a hole.
 */
export function insertSorted(
  items: FeedNode[],
  node: FeedNode,
  sort: FeedQuery['sort'],
  complete: boolean,
): FeedNode[] {
  if (items.some((n) => n.id === node.id)) return replaceById(items, node);
  const cmp = comparator(sort);
  let i = 0;
  while (i < items.length && cmp(items[i], node) <= 0) i++;
  if (i === items.length && !complete) return items;
  const next = [...items];
  next.splice(i, 0, node);
  return next;
}

/** A page appended to the pages already loaded, minus anything already held. */
export function appendPage(items: FeedNode[], page: FeedNode[]): FeedNode[] {
  const held = new Set(items.map((n) => n.id));
  const fresh = page.filter((n) => !held.has(n.id));
  return fresh.length ? [...items, ...fresh] : items;
}

/** The first page refetched: its records lead, everything older that was loaded follows. */
export function refreshFirst(items: FeedNode[], first: FeedNode[]): FeedNode[] {
  const fresh = new Set(first.map((n) => n.id));
  return [...first, ...items.filter((n) => !fresh.has(n.id))];
}
