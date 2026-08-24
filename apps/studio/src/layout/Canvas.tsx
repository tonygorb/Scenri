import { useState, type CSSProperties, type ReactNode } from 'react';
import { AlertDialog, Button, ContextMenu, Flex } from '@radix-ui/themes';
import { hasNoShots, imgUrl, nodeLabel, type TreeNode } from '../api.js';
import { describeCancelled, describeFailure } from '../failure.js';
import { FailureNote } from './Failure.js';
import { elapsedSec } from '../tasks.js';
import { masonryLayout, PHONE, useElementWidth, useViewportWidth } from './masonry.js';
import { RunningTag } from './canvas/RunningTag.js';
import { FeedImage } from './canvas/FeedImage.js';
import { ShotChrome } from './canvas/ShotChrome.js';
import { shotMenuItems } from './canvas/shotMenu.js';
import { aspectOfFormat } from '../composer/formats.js';

/**
 * The feed: every shot the current lens admits, as a masonry tile.
 * Running tiles shimmer with elapsed seconds (status, never a fake percent),
 * failed tiles stay quiet and dashed, edits carry a provenance badge.
 */

/**
 * A tile's shape: recorded pixels when the run wrote them, the brief's format
 * as the guess for everything older. The record ends the guessing, which is
 * what lets the box hold its shape after load instead of reflowing the column.
 */
function aspectOfImage(n: TreeNode, i: number): { aspect: number | undefined; guess: boolean } {
  const size = (n.brief as { rendered?: { sizes?: [number, number][] } } | null)?.rendered?.sizes?.[i];
  if (size && size[0] > 0 && size[1] > 0) return { aspect: size[0] / size[1], guess: false };
  return { aspect: aspectOfFormat((n.brief as { format?: string } | null)?.format), guess: true };
}

export function Canvas({
  nodes,
  selectedId,
  onOpen,
  onRetry,
  onCancel,
  onToggleKeep,
  onArchive,
  onDeletePermanently,
  picked,
  onPick,
  empty,
  sending,
  onBranch,
  branchingFrom,
  branchingFromImage,
  expanded,
  onToggleExpand,
  versionsOf,
  onVersions,
  engineName,
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
  onBranch?: (id: string, imageIndex?: number) => void;
  /** The shot the brief is currently pointed at, so its tile can say so. */
  branchingFrom?: string | null;
  /** Which image of it, so an opened-out take can say it is the armed one. */
  branchingFromImage?: string | null;
  /** Runs opened out into their variants. */
  expanded?: Set<string>;
  onToggleExpand?: (id: string) => void;
  /** How many shots came from this one, for the versions pip. */
  versionsOf?: (id: string) => number;
  /** Look at just this shot and what came from it. */
  onVersions?: (id: string) => void;
  /**
   * An engine id to the name it is called by. Only a failed tile reads it, to
   * say "OpenRouter did not accept your API key" rather than the same sentence
   * about "the engine" — but the feed is the one place that knows the ids and
   * not the names, so it is passed rather than looked up here.
   */
  engineName?: (id: string) => string | undefined;
  /** Target column width in px, from Create’s grid-size slider. */
  tile: number;
}) {
  const shots = nodes.filter((n) => n.kind !== 'root');
  const picking = !!onPick;
  /**
   * A batch is being built, so the picture itself is a checkbox.
   *
   * Aiming at a 28px tick for every shot you add is a chore the moment there
   * is more than one, and every photo library resolves it the same way: once
   * selection is on, a tap on the tile adds or removes it. Opening a shot is
   * still one Escape and one click away, and with nothing picked this changes
   * nothing at all.
   *
   * This is the only thing selection changes. The tile's chrome does not have
   * a selection mode, a just-cleared mode, or any other mode: hovering a tile
   * shows the same three controls whatever else is true, which is the one rule
   * that never surprised anyone.
   */
  const batching = picking && (picked?.size ?? 0) > 0;
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
      if (n.status === 'running') {
        return [
          // Cancel used to be a <button> inside .sc-cell-open — invalid HTML
          // (React warned on it), and the same nested-interactive mistake this
          // pass already fixed for SceneCard and the kept-star badge. A sibling
          // now, matching that pattern.
          <div
            key={n.id}
            className="sc-cell"
            data-running="true"
            data-fb-node={n.id}
            // the shape the brief asked for, so the picture lands in the space
            // already held for it instead of resizing its column
            style={{ '--sc-cell-ar': aspectOfFormat(n.brief?.format) } as CSSProperties}
          >
            <button
              type="button"
              className="sc-cell-open"
              aria-label={`Open ${nodeLabel(n)}, still rendering`}
              onClick={() => onOpen(n.id)}
            >
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
      /*
       * Cancelled and failed are one tile with two readings. They used to be
       * two near-identical blocks that had already drifted — the failed one
       * clipped its message at 200px with `nowrap`, so the reason a shot failed
       * was unreadable on the very tile reporting it, and both offered two grey
       * pills of identical weight where one is a rescue and the other a
       * dismissal.
       */
      if (n.status === 'cancelled' || n.status === 'error' || n.images.length === 0) {
        const cancelled = n.status === 'cancelled';
        const failure = cancelled ? describeCancelled() : describeFailure(n.error, engineName?.(n.engineId));
        return [
          <div
            key={n.id}
            className="sc-cell"
            data-fb-node={n.id}
            data-cancelled={cancelled || undefined}
            data-failed={!cancelled || undefined}
            data-selected={n.id === selectedId}
          >
            <button
              type="button"
              className="sc-cell-open"
              onClick={() => onOpen(n.id)}
              aria-label={`Open ${nodeLabel(n)}`}
            />
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
          </div>,
        ];
      }
      const chosen = picked?.has(n.id) ?? false;
      const versions = versionsOf?.(n.id) ?? 0;
      /** The shot's verbs, built once so the two menus offering them agree. */
      const menu = shotMenuItems(n, {
        chosen,
        batching,
        versions,
        onOpen,
        onBranch,
        onPick,
        onVersions,
        onToggleExpand,
        onToggleKeep,
        onArchive,
        onDeletePermanently: onDeletePermanently ? (node) => setDeleteTarget(node) : undefined,
      });

      if (expanded?.has(n.id) && n.images.length > 1) {
        return n.images.map((hash, i) => (
          <div
            // the hash, not the index: images are content addressed, so this
            // is both stable and meaningful. The run is append-only and never
            // reordered, so the index would have worked too; this simply does
            // not rely on that staying true.
            key={`${n.id}:${hash}`}
            className="sc-cell"
            data-fb-node={n.id}
            data-fb-variant={i}
            data-variant=""
            data-batching={batching || undefined}
            data-first={i === 0 || undefined}
            data-selected={i === 0 && n.id === selectedId}
          >
            <button
              type="button"
              className="sc-cell-open"
              aria-label={
                batching
                  ? `${chosen ? 'Deselect' : 'Select'} ${nodeLabel(n)}`
                  : `Open ${nodeLabel(n)}, take ${i + 1} of ${n.images.length}`
              }
              onClick={() => (batching ? onPick?.(n.id) : onOpen(n.id, i))}
            >
              <FeedImage src={imgUrl(hash)} {...aspectOfImage(n, i)} />
            </button>
            {/* One chrome, both tile shapes. The opened-out take used to place
                its own bar, and once the counts moved into that row the
                Collapse button kept its old class without the positioning that
                came with it — and landed on top of Refine. */}
            <ShotChrome
              node={n}
              take={i}
              takeCount={n.images.length}
              chosen={chosen}
              picking={picking}
              batching={batching}
              armed={branchingFrom === n.id && branchingFromImage === hash}
              menu={menu}
              onPick={onPick}
              onBranch={onBranch}
              onToggleExpand={onToggleExpand}
            />
          </div>
        ));
      }

      return [
        <ContextMenu.Root key={n.id}>
          <ContextMenu.Trigger>
            <div
              className="sc-cell"
              data-fb-node={n.id}
              data-selected={n.id === selectedId}
              data-batching={batching || undefined}
              data-picked={chosen || undefined}
            >
              <button
                type="button"
                className="sc-cell-open"
                aria-label={batching ? `${chosen ? 'Deselect' : 'Select'} ${nodeLabel(n)}` : `Open ${nodeLabel(n)}`}
                onClick={() => (batching ? onPick?.(n.id) : onOpen(n.id))}
              >
                <FeedImage src={imgUrl(n.images[0])} {...aspectOfImage(n, 0)} />
              </button>
              <ShotChrome
                node={n}
                take={null}
                takeCount={n.images.length}
                chosen={chosen}
                picking={picking}
                batching={batching}
                armed={n.id === branchingFrom}
                menu={menu}
                onPick={onPick}
                onBranch={onBranch}
                onToggleExpand={onToggleExpand}
              />
            </div>
          </ContextMenu.Trigger>
          <ContextMenu.Content>
            {menu.map((it) => (
              <span key={it.key} style={{ display: 'contents' }}>
                {it.separated && <ContextMenu.Separator />}
                <ContextMenu.Item color={it.danger ? 'red' : undefined} onSelect={it.onSelect}>
                  {it.label}
                </ContextMenu.Item>
              </span>
            ))}
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
      <div className="sc-feed" ref={setFeedEl} style={{ '--sc-tile': `${colWidth}px` } as CSSProperties}>
        {Array.from({ length: cols }, (_, c) => (
          /*
           * Dealt round-robin, but counted from the OLDEST tile rather than the
           * newest.
           *
           * The feed is sorted newest first, so every generation prepends. Deal
           * on the plain index and that prepend renumbers everything: measured
           * on a 12-shot feed, one new shot moved all 12 of the others, which
           * is the whole page rearranging itself at the exact moment you are
           * looking at what just arrived. Counting from the far end leaves an
           * existing tile's ordinal — and so its column — untouched when
           * something is added at the near end, so only the column the new shot
           * joins shifts down.
           *
           * The cost is that the top row no longer reads strictly left to
           * right; the newest tile lands in whichever column its ordinal picks.
           * A masonry is scanned by column anyway, and a feed that holds still
           * is worth more than a row that reads in order.
           */
          // biome-ignore lint/suspicious/noArrayIndexKey: the index is the identity here. These are positions, not records: column 2 of 4 is column 2 of 4, and the count is in the key so a resize remounts them rather than reshuffling tiles between surviving columns.
          <div className="sc-feed-col" key={`col-${cols}-${c}`}>
            {tiles.filter((_, i) => (tiles.length - 1 - i) % cols === c)}
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
