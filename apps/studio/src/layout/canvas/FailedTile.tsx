import { memo } from 'react';
import { Link } from 'react-router';
import { nodeLabel, type FeedNode } from '../../api.js';
import { describeCancelled, describeFailure } from '../../failure.js';
import { FailureNote } from '../Failure.js';

/*
 * Cancelled and failed are one tile with two readings. They used to be
 * two near-identical blocks that had already drifted — the failed one
 * clipped its message at 200px with `nowrap`, so the reason a shot failed
 * was unreadable on the very tile reporting it, and both offered two grey
 * pills of identical weight where one is a rescue and the other a
 * dismissal.
 */
export const FailedTile = memo(function FailedTile({
  node: n,
  selected,
  shotHref,
  engineName,
  onRetry,
  onArchive,
}: {
  node: FeedNode;
  selected: boolean;
  shotHref: (id: string) => string;
  engineName?: (id: string) => string | undefined;
  onRetry: (node: FeedNode) => void;
  onArchive?: (node: FeedNode) => void;
}) {
  const cancelled = n.status === 'cancelled';
  const failure = cancelled ? describeCancelled() : describeFailure(n.error, engineName?.(n.engineId));
  return (
    <div
      className="sc-cell"
      data-fb-node={n.id}
      data-cancelled={cancelled || undefined}
      data-failed={!cancelled || undefined}
      data-selected={selected}
    >
      <Link className="sc-cell-open" to={shotHref(n.id)} aria-label={`Open ${nodeLabel(n)}`} />
      <span className="sc-cell-failed">
        <FailureNote
          failure={failure}
          density="tile"
          onRetry={() => onRetry(n)}
          dismiss={
            onArchive
              ? {
                  // Says what it will do. Both of these called the same
                  // handler under the same word, and that handler
                  // restores an already-archived shot — so on an archived
                  // failure the button labelled Dismiss put it back,
                  // which is the opposite of dismissing it.
                  label: n.archived ? 'Restore' : 'Dismiss',
                  onClick: () => onArchive(n),
                }
              : undefined
          }
        />
      </span>
    </div>
  );
});
