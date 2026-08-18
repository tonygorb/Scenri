import { useMemo } from 'react';
import type { TreeNode } from '../../api.js';

/** The overlay's view of where a shot sits in its tree. Pure over (nodes, node). */
export function useLineage(nodes: TreeNode[], node: TreeNode) {
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const ancestors = useMemo(() => {
    const out: TreeNode[] = [];
    let cur = node.parentId ? byId.get(node.parentId) : null;
    while (cur && cur.kind !== 'root') {
      out.unshift(cur);
      cur = cur.parentId ? byId.get(cur.parentId) : null;
    }
    return out;
  }, [node, byId]);
  const children = useMemo(() => nodes.filter((n) => n.parentId === node.id && n.kind !== 'root'), [nodes, node.id]);
  const siblings = useMemo(
    () => nodes.filter((n) => n.parentId === node.parentId && n.kind !== 'root'),
    [nodes, node.parentId],
  );
  const sibIndex = siblings.findIndex((n) => n.id === node.id);
  const root = useMemo(() => nodes.find((n) => n.kind === 'root') ?? null, [nodes]);
  const parent = node.parentId ? byId.get(node.parentId) : null;
  const parentShot = parent && parent.kind !== 'root' ? parent : null;
  return { byId, ancestors, children, siblings, sibIndex, root, parent, parentShot };
}
