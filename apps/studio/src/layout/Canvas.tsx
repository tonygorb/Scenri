import { useEffect, useState } from 'react';
import { Star, WarningCircle } from '@phosphor-icons/react';
import { imgUrl, type TreeNode } from '../api.js';
import { elapsedSec } from '../tasks.js';

/**
 * The session canvas: every shot in the project as a masonry tile.
 * Running tiles shimmer with elapsed seconds (status, never a fake percent),
 * failed tiles stay quiet and dashed, edits carry a provenance badge.
 */
export function Canvas({
  nodes,
  selectedId,
  onOpen,
  onRetry,
}: {
  nodes: TreeNode[];
  selectedId: string | null;
  onOpen: (id: string) => void;
  onRetry: (node: TreeNode) => void;
}) {
  const shots = nodes.filter((n) => n.kind !== 'root');
  const byId = new Map(nodes.map((n) => [n.id, n]));

  if (shots.length === 0) {
    return (
      <div className="sc-canvas-empty">
        <h3>
          An empty <em>set</em>
        </h3>
        <p>Describe the first shot below, or attach a template. Everything you make lands here as a tree.</p>
      </div>
    );
  }

  return (
    <div className="sc-feed">
      {shots.map((n) => {
        const parent = n.parentId ? byId.get(n.parentId) : null;
        const parentShot = parent && parent.kind !== 'root' ? parent : null;
        if (n.status === 'running') {
          return (
            <div key={n.id} className="sc-cell" data-running="true">
              <span className="sc-shimmer" />
              <RunningTag since={n.createdAt} />
            </div>
          );
        }
        if (n.status === 'error' || n.images.length === 0) {
          return (
            <div key={n.id} className="sc-cell" data-failed="true" data-selected={n.id === selectedId}>
              <span className="sc-cell-failed">
                <WarningCircle size={16} />
                <span style={{ maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {n.error?.slice(0, 40) || 'Failed'}
                </span>
                <button type="button" className="sc-cell-retry" onClick={() => onRetry(n)}>
                  Try again
                </button>
              </span>
            </div>
          );
        }
        return (
          <button
            type="button"
            key={n.id}
            className="sc-cell"
            data-selected={n.id === selectedId}
            onClick={() => onOpen(n.id)}
          >
            <img src={imgUrl(n.images[0])} alt="" loading="lazy" />
            {parentShot?.images[0] && (
              <span className="sc-prov">
                <img src={imgUrl(parentShot.images[0])} alt="" />
                edit of
              </span>
            )}
            {n.kept && (
              <span className="sc-cell-star">
                <Star size={14} weight="fill" />
              </span>
            )}
            {n.images.length > 1 && (
              <span className="sc-cell-meta" style={{ opacity: 1 }}>
                {n.images.length} variants
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function RunningTag({ since }: { since: string }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  // new Date() read SQLite's zone-less UTC as local time, so this counter used
  // to start at the timezone offset instead of at zero
  return <span className="sc-cell-tag">generating · {elapsedSec(since, now)}s</span>;
}
