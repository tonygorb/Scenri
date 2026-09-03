import { useEffect, useState } from 'react';
import { api, type FeedNode } from '../../api.js';

/**
 * A shot named by id, from the pages on screen when they hold it and from the
 * server when they do not: the branch target, the root of a lineage view, a
 * deep link. `missing` is true only once the server has said it has no such
 * shot, so nothing is declared gone on the strength of a page not yet loaded.
 */
export function useResolvedNode(
  id: string | null,
  byId: ReadonlyMap<string, FeedNode>,
): { node: FeedNode | null; missing: boolean } {
  const held = id ? (byId.get(id) ?? null) : null;
  const [fetched, setFetched] = useState<{ id: string; node: FeedNode | null } | null>(null);
  useEffect(() => {
    if (!id || held) return;
    let alive = true;
    api
      .node(id)
      .then((n) => alive && setFetched({ id, node: n }))
      .catch(() => alive && setFetched({ id, node: null }));
    return () => {
      alive = false;
    };
  }, [id, held]);
  if (!id) return { node: null, missing: false };
  if (held) return { node: held, missing: false };
  if (fetched?.id === id) return { node: fetched.node, missing: fetched.node === null };
  return { node: null, missing: false };
}
