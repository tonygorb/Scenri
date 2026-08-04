import { useEffect } from 'react';
import { useOutletContext, useParams } from 'react-router';
import { DetailOverlay } from '../layout/DetailOverlay.js';
import type { ShotContext } from './Project.js';

/**
 * The shot overlay as a URL. Being a child route keeps the canvas mounted
 * underneath, so opening a shot does not refetch the tree, and a reload of
 * /n/:nodeId comes straight back to the same picture.
 */
export function ShotDetailRoute() {
  const { nodeId } = useParams();
  const ctx = useOutletContext<ShotContext>();
  const node = ctx.nodes.find((n) => n.id === nodeId) ?? null;
  const missing = ctx.nodes.length > 0 && (!node || node.kind === 'root');

  // a link to a shot that has since been deleted, or to the project root:
  // fall back to the canvas rather than holding an empty overlay open
  useEffect(() => {
    if (missing) ctx.close();
  }, [missing, ctx.close]);

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
      onChanged={ctx.reload}
      onRemix={ctx.remix}
      layers={ctx.layers}
      selectedLayerId={ctx.selectedLayerId}
      onSelectLayer={ctx.setSelectedLayerId}
      onLayersChange={(ls) => ctx.changeLayers(node, ls)}
      onAddLayer={() => ctx.addLayer(node)}
      onLift={() => ctx.lift(node)}
      lifting={ctx.lifting}
      tab={ctx.tab}
      onTabChange={ctx.setTab}
    />
  );
}
