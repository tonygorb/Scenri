import { useEffect, useState } from 'react';
import { api, type FeedNode, type TreeNode } from '../../api.js';

/** Whole records remembered, by id. Past this the oldest is forgotten; a Map keeps insertion order. */
const FULL_CACHE_CAP = 32;
const cache = new Map<string, TreeNode>();
function remember(node: TreeNode): void {
  cache.delete(node.id);
  cache.set(node.id, node);
  while (cache.size > FULL_CACHE_CAP) cache.delete(cache.keys().next().value as string);
}

/**
 * The whole record behind a feed summary: the compiled prompt and everything
 * else a list leaves out. Read once per shot opened, remembered for a while,
 * and never waited for: the overlay draws from the summary at once and fills
 * the prompt-shaped parts when this lands. The prompt is written once at
 * creation, so a record already in hand never goes stale.
 */
export function useFullNode(node: FeedNode): TreeNode | null {
  const [held, setHeld] = useState<TreeNode | null>(() => cache.get(node.id) ?? null);
  useEffect(() => {
    const hit = cache.get(node.id);
    if (hit) {
      setHeld(hit);
      return;
    }
    let alive = true;
    api
      .node(node.id)
      .then((full) => {
        if (!alive) return;
        remember(full);
        setHeld(full);
      })
      .catch(() => {
        /* the summary is enough to show; only the prompt text waits */
      });
    return () => {
      alive = false;
    };
  }, [node.id]);
  return held?.id === node.id ? held : (cache.get(node.id) ?? null);
}
