import { useEffect, useState } from 'react';
import { Spinner } from '@radix-ui/themes';
import { useOutletContext, useParams } from 'react-router';
import { api, type FeedNode } from '../api.js';
import { DetailOverlay } from '../layout/DetailOverlay.js';
import { useToasts } from '../toasts.js';
import type { ShotContext } from './create/shotContext.js';

/**
 * The shot overlay as a URL. Being a child route keeps the canvas mounted
 * underneath, so opening a shot does not refetch anything, and a reload of
 * /shots/:shotId comes straight back to the same picture.
 *
 * The shot is read from the pages the feed holds. A shot outside them (a deep
 * link, a version older than what was scrolled to, one made a moment ago on
 * another screen) is one row from the server; only a row the server does not
 * have is "no longer available". That verdict used to come from a snapshot
 * of the whole brand, and re-reading the whole brand was the only way to ask.
 */
export function ShotDetailRoute() {
  const { shotId } = useParams();
  const ctx = useOutletContext<ShotContext>();
  const { push } = useToasts();
  const held = shotId ? (ctx.byId.get(shotId) ?? null) : null;
  const [fetched, setFetched] = useState<{ id: string; node: FeedNode | null } | null>(null);

  useEffect(() => {
    if (!shotId || held) return;
    let alive = true;
    api
      .node(shotId)
      .then((n) => alive && setFetched({ id: shotId, node: n.kind === 'root' ? null : n }))
      .catch(() => alive && setFetched({ id: shotId, node: null }));
    return () => {
      alive = false;
    };
  }, [shotId, held]);

  // a fetched shot still rendering is not in any page, so the poll is the only
  // thing that can tell this overlay it landed
  useEffect(() => {
    if (!shotId || held) return;
    return ctx.subscribeActivity((nodes) => {
      const hit = nodes.find((n) => n.id === shotId);
      if (hit) setFetched({ id: shotId, node: hit });
    });
  }, [shotId, held, ctx.subscribeActivity]);

  const node = held ?? (fetched !== null && fetched.id === shotId ? fetched.node : null);
  const missing = !held && fetched !== null && fetched.id === shotId && fetched.node === null;

  // a link to a shot that has since been deleted, or to the project root:
  // fall back to the canvas rather than holding an empty overlay open, and
  // say so, rather than letting the close read as an unexplained bounce
  useEffect(() => {
    if (!missing) return;
    push({ kind: 'error', title: 'That shot is no longer available', detail: 'Back to the feed.' });
    ctx.close();
  }, [missing, ctx.close, push]);

  // Its own class, not `sc-ovl`. Sharing that one made "the overlay is open"
  // a claim a spinner could satisfy, so every e2e assertion on `.sc-ovl`
  // quietly also passed while the shot was still loading.
  if (!node) {
    return missing ? null : (
      <div className="sc-ovl-wait" role="status" aria-label="Loading">
        <Spinner size="3" />
      </div>
    );
  }

  return (
    <DetailOverlay
      node={node}
      rootId={ctx.rootId}
      items={ctx.items}
      loadMore={ctx.loadMore}
      complete={ctx.complete}
      brand={ctx.brand}
      engines={ctx.engines}
      projectId={ctx.projectId}
      onClose={ctx.close}
      onSelect={ctx.select}
      onRetry={ctx.retry}
      onCancel={ctx.cancel}
      onKeep={ctx.keep}
      onLanded={ctx.landed}
      onRefined={ctx.refined}
      tokenNames={ctx.tokenNames}
      onRemix={ctx.remix}
      onArchive={() => ctx.archive(node)}
      onUnarchive={() => ctx.unarchive(node)}
      onDelete={() => ctx.delete(node)}
    />
  );
}
