import { useEffect } from 'react';
import { Spinner } from '@radix-ui/themes';
import { useOutletContext, useParams } from 'react-router';
import { DetailOverlay } from '../layout/DetailOverlay.js';
import { useToasts } from '../toasts.js';
import type { ShotContext } from './Create.js';

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
  const missing = ctx.loaded && (!node || node.kind === 'root');

  // a link to a shot that has since been deleted, or to the project root:
  // fall back to the canvas rather than holding an empty overlay open, and
  // say so, rather than letting the close read as an unexplained bounce
  useEffect(() => {
    if (!missing) return;
    push({ kind: 'error', title: 'That shot is no longer available', detail: 'Back to the feed.' });
    ctx.close();
  }, [missing, ctx.close, push]);

  // the tree has not arrived yet: a blank flash here would read as the shot
  // itself being empty, when it is only the fetch that has not landed
  if (!ctx.loaded) {
    return (
      <div className="sc-ovl" style={{ display: 'grid', placeItems: 'center' }} role="status" aria-label="Loading">
        <Spinner size="3" />
      </div>
    );
  }

  if (!node || node.kind === 'root') return null;

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
      onRemix={ctx.remix}
      onBranch={ctx.branch}
      onArchive={() => ctx.archive(node)}
      onUnarchive={() => ctx.unarchive(node)}
      onDelete={() => ctx.delete(node)}
      layers={ctx.layers}
      selectedLayerId={ctx.selectedLayerId}
      onSelectLayer={ctx.setSelectedLayerId}
      onLayersChange={(ls) => ctx.changeLayers(node, ls)}
      onAddLayer={() => ctx.addLayer(node)}
      tab={ctx.tab}
      onTabChange={ctx.setTab}
    />
  );
}
