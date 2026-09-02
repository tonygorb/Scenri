import type { TreeNode } from '../api.js';

/**
 * What the feed cares about in a shot's record: the fields a running shot
 * gains as it lands. Anything else the feed changes itself, through the
 * explicit reloads that follow keep, archive, cancel and delete.
 */
const signature = (n: TreeNode) =>
  [
    n.status,
    n.images.join(','),
    n.error ?? '',
    n.durationMs ?? '',
    n.costUsd,
    JSON.stringify(n.brief?.rendered ?? null),
  ].join('|');

export interface MergeResult {
  nodes: TreeNode[];
  /** A record named a shot the list has never held: only a full read can place it. */
  unknown: boolean;
}

/**
 * Fold the bell's fresh records into the feed's list, by id.
 *
 * Every shot that changed state used to cost a refetch of the whole workspace:
 * two thousand shots re-read, re-parsed and re-sorted so that one tile could
 * turn from shimmer to picture, and a four-shot batch landing one at a time
 * would have cost four. The poll already carries the record that changed, so
 * it is swapped in by id and every other record keeps its reference. The list
 * comes back untouched when nothing changed, and untouched with `unknown` set
 * when a record names a shot the list has never seen (work started from
 * another tab or screen), the one case that still earns a full read.
 */
export function mergeNodes(prev: TreeNode[], fresh: TreeNode[]): MergeResult {
  const at = new Map(prev.map((n, i) => [n.id, i]));
  let next: TreeNode[] | null = null;
  for (const n of fresh) {
    const i = at.get(n.id);
    if (i === undefined) return { nodes: prev, unknown: true };
    if (signature(prev[i]) === signature(n)) continue;
    next ??= [...prev];
    next[i] = n;
  }
  return { nodes: next ?? prev, unknown: false };
}
