import { useEffect, useState } from 'react';
import { Spinner } from '@radix-ui/themes';
import { useOutletContext, useParams } from 'react-router';
import { DetailOverlay } from '../layout/DetailOverlay.js';
import { useToasts } from '../toasts.js';
import type { ShotContext } from './create/shotContext.js';

/**
 * The shot overlay as a URL. Being a child route keeps the canvas mounted
 * underneath, so opening a shot does not refetch the tree, and a reload of
 * /shots/:shotId comes straight back to the same picture.
 */
export function ShotDetailRoute() {
  const { shotId } = useParams();
  const ctx = useOutletContext<ShotContext>();
  const { push } = useToasts();
  const node = ctx.nodes.find((n) => n.id === shotId) ?? null;
  const absent = ctx.loaded && (!node || node.kind === 'root');
  // Asking the server before believing it is gone. The tree behind the overlay
  // is a snapshot, and a shot made a moment ago on another screen — from a
  // notification, say — is not in the snapshot that was fetched before it
  // existed. Concluding "deleted" from that told people their finished work
  // was "no longer available" and threw them back to the feed.
  // State rather than a ref, for the same reason the set route uses state: a
  // ref does not re-render, so nothing would recompute the verdict once the
  // answer came back.
  const [asked, setAsked] = useState<string | null>(null);
  const missing = absent && asked === shotId;

  useEffect(() => {
    if (!absent || !shotId || asked === shotId) return;
    let alive = true;
    void ctx.reload().finally(() => alive && setAsked(shotId));
    return () => {
      alive = false;
    };
  }, [absent, shotId, asked, ctx.reload]);

  // it resolved after all: a later miss on another shot is asked afresh
  useEffect(() => {
    if (node) setAsked(null);
  }, [node]);

  // a link to a shot that has since been deleted, or to the project root:
  // fall back to the canvas rather than holding an empty overlay open, and
  // say so, rather than letting the close read as an unexplained bounce
  useEffect(() => {
    if (!missing) return;
    push({ kind: 'error', title: 'That shot is no longer available', detail: 'Back to the feed.' });
    ctx.close();
  }, [missing, ctx.close, push]);

  // The tree has not arrived yet: a blank flash here would read as the shot
  // itself being empty, when it is only the fetch that has not landed.
  //
  // Its own class, not `sc-ovl`. Sharing that one made "the overlay is open"
  // a claim a spinner could satisfy, so every e2e assertion on `.sc-ovl`
  // quietly also passed while the shot was still loading, and one that read
  // the text straight after got an empty string.
  if (!ctx.loaded) {
    return (
      <div className="sc-ovl-wait" role="status" aria-label="Loading">
        <Spinner size="3" />
      </div>
    );
  }

  // Still asking: hold the shell rather than flashing an empty screen, exactly
  // as while the tree was first loading.
  if (!node || node.kind === 'root') {
    return missing ? null : (
      <div className="sc-ovl-wait" role="status" aria-label="Loading">
        <Spinner size="3" />
      </div>
    );
  }

  return (
    <DetailOverlay
      node={node}
      nodes={ctx.nodes}
      brand={ctx.brand}
      engines={ctx.engines}
      projectId={ctx.projectId}
      imageIndex={ctx.imageIndex}
      onImageIndex={ctx.setImageIndex}
      onClose={ctx.close}
      onSelect={ctx.select}
      onRetry={ctx.retry}
      onCancel={ctx.cancel}
      onChanged={ctx.reload}
      onRefined={ctx.refined}
      tokenNames={ctx.tokenNames}
      onRemix={ctx.remix}
      onArchive={() => ctx.archive(node)}
      onUnarchive={() => ctx.unarchive(node)}
      onDelete={() => ctx.delete(node)}
    />
  );
}
