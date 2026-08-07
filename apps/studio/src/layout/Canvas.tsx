import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { AlertDialog, Button, ContextMenu, Flex } from '@radix-ui/themes';
import {
  Archive,
  ArrowCounterClockwise,
  Check,
  GitBranch,
  Stack,
  Star,
  WarningCircle,
  XCircle,
} from '@phosphor-icons/react';
import { hasNoShots, imgUrl, nodeLabel, type ShotSet, type TreeNode } from '../api.js';
import { elapsedSec, runningPhrase } from '../tasks.js';
import { masonryLayout, PHONE, useElementWidth, useViewportWidth } from './masonry.js';

/**
 * The feed: every shot the current lens admits, as a masonry tile.
 * Running tiles shimmer with elapsed seconds (status, never a fake percent),
 * failed tiles stay quiet and dashed, edits carry a provenance badge.
 */
export function Canvas({
  nodes,
  selectedId,
  onOpen,
  onRetry,
  onCancel,
  onToggleKeep,
  onArchive,
  onDeletePermanently,
  setsFor,
  picked,
  onPick,
  empty,
  sending,
  onBranch,
  branchingFrom,
  expanded,
  onToggleExpand,
  versionsOf,
  onVersions,
  tile,
}: {
  nodes: TreeNode[];
  selectedId: string | null;
  /** The variant index is how a stacked run opens on the one you clicked. */
  onOpen: (id: string, imageIndex?: number) => void;
  onRetry: (node: TreeNode) => void;
  onCancel?: (node: TreeNode) => void;
  /** The star badge looked like a toggle and wasn't one — `k` and the overlay
   * were the only real controls. This is the tile-level path to match. */
  onToggleKeep?: (node: TreeNode) => void;
  /** Put a shot away — or, on an already-archived one, bring it back. Absent
   * where a tile can't be put away at all (there is none today, but the
   * fallback in the running/cancelled tiles keeps this optional rather than
   * a silent crash if that ever changes). */
  onArchive?: (node: TreeNode) => void;
  /** Permanent. Only ever offered (in the context menu) on an already-archived tile. */
  onDeletePermanently?: (node: TreeNode) => void;
  /** The sets a shot is in, for the tile's own label. */
  setsFor?: (id: string) => ShotSet[];
  picked?: Set<string>;
  onPick?: (id: string) => void;
  /**
   * What stands in for the feed when nothing is admitted. The caller owns this
   * because only it knows whether the brand is empty or a lens is hiding the
   * work, and those two say very different things.
   */
  empty?: ReactNode;
  /**
   * A brief that has been sent and has not come back as a shot yet. It leads
   * the feed so the press of the button is answered immediately, rather than
   * after a round trip that can take a second on a cold engine.
   */
  sending?: string | null;
  /** Point the brief at this shot. Absent where branching makes no sense. */
  onBranch?: (id: string) => void;
  /** The shot the brief is currently pointed at, so its tile can say so. */
  branchingFrom?: string | null;
  /** Runs opened out into their variants. */
  expanded?: Set<string>;
  onToggleExpand?: (id: string) => void;
  /** How many shots came from this one, for the versions pip. */
  versionsOf?: (id: string) => number;
  /** Look at just this shot and what came from it. */
  onVersions?: (id: string) => void;
  /** Target column width in px, from the grid-size slider. */
  tile: number;
}) {
  const shots = nodes.filter((n) => n.kind !== 'root');
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const picking = !!onPick;
  // one confirm dialog for the whole grid, not one per tile — the context
  // menu item just says which node it's for
  const [deleteTarget, setDeleteTarget] = useState<TreeNode | null>(null);
  // a callback ref rather than useRef: the feed is not in the tree at all while
  // the brand is empty, so an effect keyed on a ref object would never see it
  // arrive and would measure nothing for the rest of the session
  const [feedEl, setFeedEl] = useState<HTMLDivElement | null>(null);
  const { tile: colWidth, cols: fitting } = masonryLayout(useElementWidth(feedEl), tile, useViewportWidth() < PHONE);

  const tiles: ReactNode[] = [
    ...(sending
      ? [
          <div key="sending" className="sc-cell" data-running="true" data-sending="true">
            <span className="sc-shimmer" />
            <span className="sc-cell-tag">sending</span>
            <span className="sc-cell-said" dir="auto">
              {sending}
            </span>
          </div>,
        ]
      : []),
    ...shots.flatMap((n) => {
      const parent = n.parentId ? byId.get(n.parentId) : null;
      const parentShot = parent && parent.kind !== 'root' ? parent : null;
      if (n.status === 'running') {
        return [
          // Cancel used to be a <button> inside .sc-cell-open — invalid HTML
          // (React warned on it), and the same nested-interactive mistake this
          // pass already fixed for SceneCard and the kept-star badge. A sibling
          // now, matching that pattern.
          <div key={n.id} className="sc-cell" data-running="true">
            <button type="button" className="sc-cell-open" onClick={() => onOpen(n.id)}>
              <span className="sc-shimmer" />
              <RunningTag since={n.createdAt} />
            </button>
            {onCancel && (
              <button
                type="button"
                className="sc-cell-retry"
                data-urgent={elapsedSec(n.createdAt) >= 60 || undefined}
                onClick={() => onCancel(n)}
              >
                Cancel
              </button>
            )}
          </div>,
        ];
      }
      if (n.status === 'cancelled') {
        return [
          <div key={n.id} className="sc-cell" data-cancelled="true" data-selected={n.id === selectedId}>
            <button type="button" className="sc-cell-open" onClick={() => onOpen(n.id)} />
            <span className="sc-cell-failed">
              <XCircle size={16} />
              <span>Cancelled</span>
              {onArchive && (
                <button type="button" className="sc-cell-retry" onClick={() => onArchive(n)}>
                  Dismiss
                </button>
              )}
            </span>
          </div>,
        ];
      }
      if (n.status === 'error' || n.images.length === 0) {
        return [
          <div key={n.id} className="sc-cell" data-failed="true" data-selected={n.id === selectedId}>
            <button type="button" className="sc-cell-open" onClick={() => onOpen(n.id)} />
            <span className="sc-cell-failed">
              <WarningCircle size={16} />
              <span style={{ maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {n.error?.slice(0, 40) || 'Failed'}
              </span>
              <button type="button" className="sc-cell-retry" onClick={() => onRetry(n)}>
                Try again
              </button>
              {onArchive && (
                <button type="button" className="sc-cell-retry" onClick={() => onArchive(n)}>
                  Dismiss
                </button>
              )}
            </span>
          </div>,
        ];
      }
      const inSets = setsFor?.(n.id) ?? [];
      const chosen = picked?.has(n.id) ?? false;
      const versions = versionsOf?.(n.id) ?? 0;

      /**
       * Branch, select and the lineage pip all act on the run rather than on
       * an image, so they are rendered once per run and stay reachable whether
       * it is stacked or opened out. Four copies of one checkbox would not be
       * four choices, and hiding them while a run is open made expanding it a
       * dead end you had to undo before you could do anything.
       */
      const runControls = (
        <>
          {onBranch && (
            <button
              type="button"
              className="sc-cell-branch"
              data-on={n.id === branchingFrom || undefined}
              onClick={() => onBranch(n.id)}
              aria-label={`Branch from ${nodeLabel(n)}`}
              title="Branch from this shot"
            >
              <GitBranch size={12} />
              Branch
            </button>
          )}
          {picking && (
            // a checkbox rather than a modifier-click: the gesture has to be
            // discoverable on a phone, where there is no modifier to hold
            <button
              type="button"
              className="sc-cell-pick"
              data-on={chosen || undefined}
              aria-pressed={chosen}
              aria-label={chosen ? 'Deselect shot' : 'Select shot'}
              onClick={() => onPick?.(n.id)}
            >
              {chosen && <Check size={12} weight="bold" />}
            </button>
          )}
          {versions > 0 && onVersions && (
            // Lineage was a 40px badge and nothing else. This is the way in
            // to the shots that came from this one.
            <button
              type="button"
              className="sc-cell-versions"
              onClick={() => onVersions(n.id)}
              aria-label={`Show the ${versions} version${versions === 1 ? '' : 's'} of this shot`}
            >
              <GitBranch size={11} />
              {versions} version{versions === 1 ? '' : 's'}
            </button>
          )}
          {onArchive && (
            <button
              type="button"
              className="sc-cell-archive"
              onClick={() => onArchive(n)}
              aria-label={n.archived ? 'Restore this shot' : 'Archive this shot'}
              title={n.archived ? 'Restore' : 'Archive'}
            >
              {n.archived ? <ArrowCounterClockwise size={12} /> : <Archive size={12} />}
            </button>
          )}
        </>
      );

      /**
       * One brief that returned four images used to look like one image with
       * a caption, and the other three were reachable only by opening the
       * shot and stepping with [ and ]. Opened out, each is a tile of its
       * own; the run's own actions stay on the first, because they act on
       * the run and four copies of one checkbox is not four choices.
       */
      if (expanded?.has(n.id) && n.images.length > 1) {
        return n.images.map((hash, i) => (
          <div
            // the hash, not the index: images are content addressed, so this
            // is both stable and meaningful. The run is append-only and never
            // reordered, so the index would have worked too; this simply does
            // not rely on that staying true.
            key={`${n.id}:${hash}`}
            className="sc-cell"
            data-variant=""
            data-first={i === 0 || undefined}
            data-selected={i === 0 && n.id === selectedId}
          >
            <button type="button" className="sc-cell-open" onClick={() => onOpen(n.id, i)}>
              <img src={imgUrl(hash)} alt="" loading="lazy" />
            </button>
            <span className="sc-cell-meta" style={{ opacity: 1 }}>
              {i + 1} of {n.images.length}
            </span>
            {i === 0 && (
              <>
                <button
                  type="button"
                  className="sc-cell-stack"
                  onClick={() => onToggleExpand?.(n.id)}
                  aria-expanded="true"
                  aria-label={`Collapse ${n.images.length} variants`}
                >
                  <Stack size={12} />
                  Collapse
                </button>
                {runControls}
              </>
            )}
          </div>
        ));
      }

      return [
        <ContextMenu.Root key={n.id}>
          <ContextMenu.Trigger>
            <div className="sc-cell" data-selected={n.id === selectedId} data-picked={chosen || undefined}>
              <button type="button" className="sc-cell-open" onClick={() => onOpen(n.id)}>
                <img src={imgUrl(n.images[0])} alt="" loading="lazy" />
              </button>
              {n.images.length > 1 && (
                <button
                  type="button"
                  className="sc-cell-stack"
                  onClick={() => onToggleExpand?.(n.id)}
                  aria-expanded="false"
                  aria-label={`Show all ${n.images.length} variants`}
                >
                  <Stack size={12} />
                  {n.images.length} variants
                </button>
              )}
              {runControls}
              {parentShot?.images[0] && (
                <span className="sc-prov">
                  <img src={imgUrl(parentShot.images[0])} alt="" />
                  edit of
                </span>
              )}
              {n.kept && (
                <button
                  type="button"
                  className="sc-cell-star"
                  onClick={() => onToggleKeep?.(n)}
                  aria-pressed="true"
                  aria-label="Remove from keepers"
                >
                  <Star size={14} weight="fill" />
                </button>
              )}
              {/* the variant count moved onto the stack control, which is the
                    thing that now acts on it rather than merely reporting it */}
              {inSets.length > 0 && <span className="sc-cell-meta">{inSets.map((s) => s.name).join(', ')}</span>}
            </div>
          </ContextMenu.Trigger>
          <ContextMenu.Content>
            <ContextMenu.Item onSelect={() => onOpen(n.id)}>Open</ContextMenu.Item>
            {onBranch && <ContextMenu.Item onSelect={() => onBranch(n.id)}>Branch from this</ContextMenu.Item>}
            {onPick && (
              <ContextMenu.Item onSelect={() => onPick(n.id)}>
                {chosen ? 'Deselect' : 'Select for set'}
              </ContextMenu.Item>
            )}
            {versions > 0 && onVersions && (
              <ContextMenu.Item onSelect={() => onVersions(n.id)}>
                {versions} version{versions === 1 ? '' : 's'}
              </ContextMenu.Item>
            )}
            {n.images.length > 1 && onToggleExpand && (
              <ContextMenu.Item onSelect={() => onToggleExpand(n.id)}>Show all variants</ContextMenu.Item>
            )}
            {onToggleKeep && (
              <ContextMenu.Item onSelect={() => onToggleKeep(n)}>
                {n.kept ? 'Remove from keepers' : 'Keep'}
              </ContextMenu.Item>
            )}
            {onArchive && (
              <>
                <ContextMenu.Separator />
                <ContextMenu.Item onSelect={() => onArchive(n)}>{n.archived ? 'Restore' : 'Archive'}</ContextMenu.Item>
              </>
            )}
            {onDeletePermanently && n.archived && (
              <>
                <ContextMenu.Separator />
                <ContextMenu.Item color="red" onSelect={() => setDeleteTarget(n)}>
                  Delete permanently
                </ContextMenu.Item>
              </>
            )}
          </ContextMenu.Content>
        </ContextMenu.Root>,
      ];
    }),
  ];

  // a first shot on a brand new brand has to have somewhere to appear, so the
  // stand-in outranks the empty state rather than waiting behind it. `shots`
  // rather than `nodes`: dismissing every visible failed/cancelled shot must
  // still land on the empty state, not a blank column with nothing in it.
  if (hasNoShots(shots) && !sending) return <>{empty ?? <p className="sc-feed-empty">Nothing here yet.</p>}</>;

  /**
   * Never more columns than there are tiles to put in them, or the row ends in
   * empty columns — the same dead space multicol left, reached the other way.
   */
  const cols = Math.max(1, Math.min(fitting, tiles.length));

  return (
    <>
      <div
        className="sc-feed"
        ref={setFeedEl}
        data-picking={picking && (picked?.size ?? 0) > 0 ? '' : undefined}
        style={{ '--sc-tile': `${colWidth}px` } as CSSProperties}
      >
        {Array.from({ length: cols }, (_, c) => (
          // Dealt round-robin, so the first row reads left to right in the order
          // the feed is sorted. Packing by shortest-column would look tidier and
          // would put the second-newest shot anywhere at all.
          //
          // biome-ignore lint/suspicious/noArrayIndexKey: the index is the identity here. These are positions, not records: column 2 of 4 is column 2 of 4, and the count is in the key so a resize remounts them rather than reshuffling tiles between surviving columns.
          <div className="sc-feed-col" key={`col-${cols}-${c}`}>
            {tiles.filter((_, i) => i % cols === c)}
          </div>
        ))}
      </div>
      <AlertDialog.Root open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialog.Content maxWidth="420px">
          <AlertDialog.Title>Delete this shot permanently?</AlertDialog.Title>
          <AlertDialog.Description size="2">This cannot be undone.</AlertDialog.Description>
          <Flex gap="3" mt="4" justify="end">
            <AlertDialog.Cancel>
              <Button variant="soft" color="gray">
                Cancel
              </Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action>
              <Button
                color="red"
                onClick={() => {
                  if (deleteTarget) onDeletePermanently?.(deleteTarget);
                  setDeleteTarget(null);
                }}
              >
                Delete permanently
              </Button>
            </AlertDialog.Action>
          </Flex>
        </AlertDialog.Content>
      </AlertDialog.Root>
    </>
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
  return (
    <span className="sc-cell-tag">
      {runningPhrase(since, now)} · {elapsedSec(since, now)}s
    </span>
  );
}
