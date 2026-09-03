import { memo, type CSSProperties } from 'react';
import { Link } from 'react-router';
import { nodeLabel, type FeedNode } from '../../api.js';
import { elapsedSec } from '../../tasks.js';
import { aspectOfFormat } from '../../composer/formats.js';
import { RunningTag } from './RunningTag.js';

/** A shot that is still rendering: the shape the brief asked for, held, and a way to stop it. */
export const RunningTile = memo(function RunningTile({
  node: n,
  shotHref,
  onCancel,
}: {
  node: FeedNode;
  shotHref: (id: string) => string;
  onCancel?: (node: FeedNode) => void;
}) {
  return (
    // Cancel used to be a <button> inside .sc-cell-open — invalid HTML
    // (React warned on it), and the same nested-interactive mistake this
    // pass already fixed for SceneCard and the kept-star badge. A sibling
    // now, matching that pattern.
    <div
      className="sc-cell"
      data-running="true"
      data-fb-node={n.id}
      // the shape the brief asked for, so the picture lands in the space
      // already held for it instead of resizing its column
      style={{ '--sc-cell-ar': aspectOfFormat(n.brief?.format) } as CSSProperties}
    >
      <Link className="sc-cell-open" to={shotHref(n.id)} aria-label={`Open ${nodeLabel(n)}, still rendering`}>
        <span className="sc-shimmer" />
        <RunningTag since={n.createdAt} />
      </Link>
      {onCancel && (
        // the tile's own control skin, not a bordered panel pill: one
        // language for everything that sits on a card
        <button
          type="button"
          className="sc-cell-ctl sc-cell-cancel"
          data-urgent={elapsedSec(n.createdAt) >= 60 || undefined}
          onClick={() => onCancel(n)}
        >
          Cancel
        </button>
      )}
    </div>
  );
});
