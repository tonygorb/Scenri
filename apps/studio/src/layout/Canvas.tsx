import { useEffect, useState } from 'react';
import { Star, WarningCircle } from '@phosphor-icons/react';
import { imgUrl, type TreeNode } from '../api.js';

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
      <div className="bt-canvas-empty">
        <h3>
          An empty <em>set</em>
        </h3>
        <p>Describe the first shot below, or attach a template. Everything you make lands here as a tree.</p>
      </div>
    );
  }

  return (
    <div className="bt-feed">
      {shots.map((n) => {
        const parent = n.parentId ? byId.get(n.parentId) : null;
        const parentShot = parent && parent.kind !== 'root' ? parent : null;
        if (n.status === 'running') {
          return (
            <div key={n.id} className="bt-cell" data-running="true">
              <span className="bt-shimmer" />
              <RunningTag since={n.createdAt} />
            </div>
          );
        }
        if (n.status === 'error' || n.images.length === 0) {
          return (
            <div key={n.id} className="bt-cell" data-failed="true" data-selected={n.id === selectedId}>
              <span className="bt-cell-failed">
                <WarningCircle size={16} />
                <span style={{ maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {n.error?.slice(0, 40) || 'Failed'}
                </span>
                <button type="button" className="bt-cell-retry" onClick={() => onRetry(n)}>
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
            className="bt-cell"
            data-selected={n.id === selectedId}
            onClick={() => onOpen(n.id)}
          >
            <img src={imgUrl(n.images[0])} alt="" loading="lazy" />
            {parentShot?.images[0] && (
              <span className="bt-prov">
                <img src={imgUrl(parentShot.images[0])} alt="" />
                edit of
              </span>
            )}
            {n.kept && (
              <span className="bt-cell-star">
                <Star size={14} weight="fill" />
              </span>
            )}
            {n.images.length > 1 && (
              <span className="bt-cell-meta" style={{ opacity: 1 }}>
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
  const sec = Math.max(0, Math.floor((now - new Date(since).getTime()) / 1000));
  return <span className="bt-cell-tag">generating · {sec}s</span>;
}
