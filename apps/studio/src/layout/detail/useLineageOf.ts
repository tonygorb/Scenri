import { useEffect, useState } from 'react';
import { api, type FeedNode, type Lineage } from '../../api.js';

/** Trees remembered, by shot id. Past this the oldest is forgotten; a Map keeps insertion order. */
const LINEAGE_CACHE_CAP = 32;
const cache = new Map<string, Lineage>();
function remember(id: string, lineage: Lineage): void {
  cache.delete(id);
  cache.set(id, lineage);
  while (cache.size > LINEAGE_CACHE_CAP) cache.delete(cache.keys().next().value as string);
}

interface LineageOf {
  /** Root-most first, the parent last; never the root itself. */
  ancestors: FeedNode[];
  /** Live refinements of the shot. */
  children: FeedNode[];
  /** Every shot off the same parent, the shot itself included. */
  siblings: FeedNode[];
  sibIndex: number;
  parentShot: FeedNode | null;
  /** The root's whole history, when the server carries it; null from an older server. */
  history: FeedNode[] | null;
  /** The root of the tree: the first ancestor, or the shot itself. */
  rootId: string;
  loaded: boolean;
}

/**
 * Where one shot sits in its tree, from one small indexed query.
 *
 * This used to be derived from every shot the brand had ever made, held on
 * the client: a Map over the whole workspace and two full passes per shot
 * opened. The server walks the parent index instead and answers with the
 * handful of records the overlay shows. Re-read when the shot gains a
 * refinement or settles, which is when its tree can have moved.
 */
export function useLineageOf(node: FeedNode): LineageOf {
  const [held, setHeld] = useState<{ id: string; lineage: Lineage } | null>(() => {
    const hit = cache.get(node.id);
    return hit ? { id: node.id, lineage: hit } : null;
  });
  useEffect(() => {
    let alive = true;
    api
      .lineage(node.id)
      .then((lineage) => {
        if (!alive) return;
        remember(node.id, lineage);
        setHeld({ id: node.id, lineage });
      })
      .catch(() => {
        /* the strip simply stays as it was; the next change asks again */
      });
    return () => {
      alive = false;
    };
  }, [node.id, node.childCount, node.status, node.parentId]);

  const current = held?.id === node.id ? held.lineage : (cache.get(node.id) ?? null);
  if (!current) {
    return {
      ancestors: [],
      children: [],
      siblings: [node],
      sibIndex: 0,
      parentShot: null,
      history: null,
      rootId: node.id,
      loaded: false,
    };
  }
  const siblings = current.siblings.some((n) => n.id === node.id) ? current.siblings : [node, ...current.siblings];
  return {
    ancestors: current.ancestors,
    children: current.children,
    siblings,
    sibIndex: siblings.findIndex((n) => n.id === node.id),
    parentShot: current.ancestors[current.ancestors.length - 1] ?? null,
    history: current.history ?? null,
    rootId: current.ancestors[0]?.id ?? node.id,
    loaded: true,
  };
}
