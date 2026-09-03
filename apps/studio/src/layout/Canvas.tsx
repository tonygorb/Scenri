import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { AlertDialog, Button, Flex } from '@radix-ui/themes';
import { hasNoShots, type FeedNode } from '../api.js';
import { masonryLayout, PHONE, useElementWidth, useViewportWidth } from './masonry.js';
import { aspectOfImage, Tile, type TileHandlers } from './canvas/Tile.js';
import { RunningTile } from './canvas/RunningTile.js';
import { FailedTile } from './canvas/FailedTile.js';
import {
  columnStarts,
  dealColumns,
  estimateHeight,
  mountedBand,
  visibleRange,
  windowed,
} from './canvas/windowRules.js';
import { useScrollWindow } from './canvas/useScrollWindow.js';
import { useTileHeights } from './canvas/useTileHeights.js';
import { aspectOfFormat } from '../composer/formats.js';

/**
 * The feed: every shot the current lens admits, as a masonry tile.
 * Running tiles shimmer with elapsed seconds (status, never a fake percent),
 * failed tiles stay quiet and dashed, edits carry a provenance badge.
 */

export function Canvas({
  nodes,
  selectedId,
  onOpen,
  shotHref,
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
  onVersions,
  engineName,
  tile,
  pending,
  onNearEnd,
}: {
  nodes: FeedNode[];
  selectedId: string | null;
  onOpen: (id: string) => void;
  /**
   * The shot's real URL. Tiles render it as a Link so middle click and Cmd
   * click open the overlay in its own tab; plain click stays SPA (and stays
   * "pick" while a batch is being built).
   */
  shotHref: (id: string) => string;
  onRetry: (node: FeedNode) => void;
  onCancel?: (node: FeedNode) => void;
  /** The star badge looked like a toggle and wasn't one — `k` and the overlay
   * were the only real controls. This is the tile-level path to match. */
  onToggleKeep?: (node: FeedNode) => void;
  /** Put a shot away — or, on an already-archived one, bring it back. Absent
   * where a tile can't be put away at all (there is none today, but the
   * fallback in the running/cancelled tiles keeps this optional rather than
   * a silent crash if that ever changes). */
  onArchive?: (node: FeedNode) => void;
  /** Permanent. Only ever offered (in the context menu) on an already-archived tile. */
  onDeletePermanently?: (node: FeedNode) => void;
  picked?: Set<string>;
  onPick?: (id: string) => void;
  /**
   * What stands in for the feed when nothing is admitted. The caller owns this
   * because only it knows whether the brand is empty or a lens is hiding the
   * work, and those two say very different things.
   */
  empty?: ReactNode;
  /**
   * A brief that has been sent and has not come back as shots yet, and how
   * many shots it asked for. It leads the feed — one stand-in per expected
   * sibling — so the press of the button is answered immediately, rather than
   * after a round trip that can take a second on a cold engine.
   */
  sending?: { said: string; count: number } | null;
  /** Point the brief at this shot. Absent where branching makes no sense. */
  onBranch?: (id: string) => void;
  /** The shot the brief is currently pointed at, so its tile can say so. */
  branchingFrom?: string | null;
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
  /**
   * The first page has not landed yet. The grid holds its shape with stand-in
   * tiles rather than flashing an empty state that is not true.
   */
  pending?: boolean;
  /** The reader is within reach of the last loaded tile: bring the next page. */
  onNearEnd?: () => void;
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
  const [deleteTarget, setDeleteTarget] = useState<FeedNode | null>(null);
  // a callback ref rather than useRef: the feed is not in the tree at all while
  // the brand is empty, so an effect keyed on a ref object would never see it
  // arrive and would measure nothing for the rest of the session
  const [feedEl, setFeedEl] = useState<HTMLDivElement | null>(null);
  const { tile: colWidth, cols: fitting } = masonryLayout(useElementWidth(feedEl), tile, useViewportWidth() < PHONE);
  // The page boundary: one sentinel after the last tile, watched against the
  // scroller with a two-screen margin, so the next page is in hand before the
  // reader reaches the end of this one.
  const [endEl, setEndEl] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!endEl || !onNearEnd) return;
    const scroller = endEl.closest('.sc-canvas');
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) onNearEnd();
      },
      { root: scroller, rootMargin: '200% 0px' },
    );
    io.observe(endEl);
    return () => io.disconnect();
  }, [endEl, onNearEnd]);

  /*
   * The tiles' verbs, stable for the life of the feed. Every handler the
   * caller passes is read through a ref at call time, so a tile keyed on its
   * shot and its own state re-renders when those change and never because
   * the feed's parent rendered with a fresh arrow. Presence still matters (a
   * verb that is not offered is not a menu item), so the object is rebuilt
   * only when a verb appears or goes.
   */
  const latest = useRef({
    onOpen,
    shotHref,
    onRetry,
    onCancel,
    onToggleKeep,
    onArchive,
    onBranch,
    onPick,
    onVersions,
    engineName,
  });
  latest.current = {
    onOpen,
    shotHref,
    onRetry,
    onCancel,
    onToggleKeep,
    onArchive,
    onBranch,
    onPick,
    onVersions,
    engineName,
  };
  const askDelete = !!onDeletePermanently;
  const handlers = useMemo<
    TileHandlers & {
      onRetry: (n: FeedNode) => void;
      onCancel?: (n: FeedNode) => void;
      engineName?: (id: string) => string | undefined;
    }
  >(
    () => ({
      onOpen: (id) => latest.current.onOpen(id),
      shotHref: (id) => latest.current.shotHref(id),
      onRetry: (n) => latest.current.onRetry(n),
      onCancel: onCancel ? (n) => latest.current.onCancel?.(n) : undefined,
      onToggleKeep: onToggleKeep ? (n) => latest.current.onToggleKeep?.(n) : undefined,
      onArchive: onArchive ? (n) => latest.current.onArchive?.(n) : undefined,
      onBranch: onBranch ? (id) => latest.current.onBranch?.(id) : undefined,
      onPick: onPick ? (id) => latest.current.onPick?.(id) : undefined,
      onVersions: onVersions ? (id) => latest.current.onVersions?.(id) : undefined,
      onDeleteAsk: askDelete ? (n) => setDeleteTarget(n) : undefined,
      engineName: engineName ? (id) => latest.current.engineName?.(id) : undefined,
    }),
    [!!onCancel, !!onToggleKeep, !!onArchive, !!onBranch, !!onPick, !!onVersions, askDelete, !!engineName],
  );

  /**
   * The feed's order: the stand-ins for a send first (one per expected
   * sibling, so a four-shot send answers with four spaces being held rather
   * than one tile hiding three), then every shot newest first. The flat index
   * is the ordinal `dealOrdinals` documents: the newest tile is ordinal 0 and
   * always the top-left cell, the feed reads left to right and then down.
   */
  type Item = { key: string; node: FeedNode | null; said?: string };
  const items: Item[] = [
    ...(sending
      ? Array.from(
          { length: Math.max(1, sending.count) },
          (_, i): Item => ({ key: `sending-${i}`, node: null, said: sending.said }),
        )
      : []),
    ...shots.map((n): Item => ({ key: n.id, node: n })),
  ];
  const isFailed = (n: FeedNode) => n.status === 'cancelled' || n.status === 'error' || n.images.length === 0;
  const render = (it: Item): ReactNode => {
    const n = it.node;
    if (!n) {
      return (
        <div key={it.key} className="sc-cell" data-running="true" data-sending="true">
          <span className="sc-shimmer" />
          <span className="sc-cell-tag">sending</span>
          <span className="sc-cell-said" dir="auto">
            {it.said}
          </span>
        </div>
      );
    }
    if (n.status === 'running')
      return <RunningTile key={n.id} node={n} shotHref={handlers.shotHref} onCancel={handlers.onCancel} />;
    if (isFailed(n)) {
      return (
        <FailedTile
          key={n.id}
          node={n}
          selected={n.id === selectedId}
          shotHref={handlers.shotHref}
          engineName={handlers.engineName}
          onRetry={handlers.onRetry}
          onArchive={handlers.onArchive}
        />
      );
    }
    return (
      <Tile
        key={n.id}
        node={n}
        selected={n.id === selectedId}
        armed={n.id === branchingFrom}
        chosen={picked?.has(n.id) ?? false}
        picking={picking}
        batching={batching}
        versions={n.childCount}
        handlers={handlers}
      />
    );
  };
  /** A tile's height before it has been measured, from its shape. */
  const estimate = (it: Item): number => {
    const n = it.node;
    if (!n) return estimateHeight('sending', undefined, colWidth);
    if (n.status === 'running') return estimateHeight('running', aspectOfFormat(n.brief?.format), colWidth);
    if (isFailed(n)) return estimateHeight('failed', undefined, colWidth);
    return estimateHeight('done', aspectOfImage(n, 0).aspect, colWidth);
  };

  // Past the threshold the columns are windowed: a spacer, the tiles within a
  // viewport of the visible band, a spacer. Below it every tile is mounted and
  // the DOM is exactly what it was.
  const windowing = windowed(items.length);
  const win = useScrollWindow(feedEl, windowing);
  const heightOf = useTileHeights(feedEl, windowing);

  // Nothing loaded yet: the grid keeps its shape with stand-ins in the brief's
  // default shape, the same tile a send holds its place with, so the feed
  // never flashes an empty state on the way to its first page.
  if (pending && hasNoShots(shots) && !sending) {
    const cols = Math.max(1, Math.min(fitting, 8));
    return (
      <div className="sc-feed" ref={setFeedEl} style={{ '--sc-tile': `${colWidth}px` } as CSSProperties}>
        {Array.from({ length: cols }, (_, c) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: stand-ins have no identity beyond their slot
          <div className="sc-feed-col" key={`col-${cols}-${c}`}>
            {Array.from({ length: 2 }, (_, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: stand-ins have no identity beyond their slot
              <div key={`pending-${c}-${i}`} className="sc-cell" data-running="true" data-sending="true">
                <span className="sc-shimmer" />
              </div>
            ))}
          </div>
        ))}
      </div>
    );
  }

  // a first shot on a brand new brand has to have somewhere to appear, so the
  // stand-in outranks the empty state rather than waiting behind it. `shots`
  // rather than `nodes`: dismissing every visible failed/cancelled shot must
  // still land on the empty state, not a blank column with nothing in it.
  if (hasNoShots(shots) && !sending) return <>{empty ?? <p className="sc-feed-empty">Nothing here yet.</p>}</>;

  /**
   * Never more columns than there are tiles to put in them, or the row ends in
   * empty columns — the same dead space multicol left, reached the other way.
   */
  const cols = Math.max(1, Math.min(fitting, items.length));
  const columns = dealColumns(items.length, cols);
  const band = windowing ? mountedBand(win.top, win.height) : null;

  return (
    <>
      <div className="sc-feed" ref={setFeedEl} style={{ '--sc-tile': `${colWidth}px` } as CSSProperties}>
        {columns.map((idx, c) => {
          /*
           * Dealt round-robin on the flat index: the newest tile is ordinal 0
           * and is ALWAYS the top-left cell, the feed reads left to right and
           * then down, and an expanded run's takes stay consecutive so they
           * read in request order. A prepend shifts every tile by one slot;
           * that is deliberate and it happens only when the user's own send
           * enters the feed and when that shot lands (see dealOrdinals for the
           * far-end deal this replaced and why). A run stays ONE tile while it
           * renders: a run is one card with takes inside, and its canonical
           * newest position is the guarantee, not a cell per take.
           */
          // The index is the identity here. These are positions, not records:
          // column 2 of 4 is column 2 of 4, and the count is in the key so a
          // resize remounts them rather than reshuffling tiles between
          // surviving columns.
          const key = `col-${cols}-${c}`;
          if (!band) {
            return (
              <div className="sc-feed-col" key={key}>
                {idx.map((i) => render(items[i]))}
              </div>
            );
          }
          const heights = idx.map((i) => (items[i].node && heightOf(items[i].node.id)) ?? estimate(items[i]));
          const starts = columnStarts(heights);
          const [from, to] = visibleRange(starts, band[0], band[1]);
          return (
            <div className="sc-feed-col" key={key}>
              {from > 0 && <div className="sc-feed-pad" style={{ height: starts[from] }} aria-hidden />}
              {idx.slice(from, to).map((i) => render(items[i]))}
              {to < idx.length && (
                <div className="sc-feed-pad" style={{ height: starts[idx.length] - starts[to] }} aria-hidden />
              )}
            </div>
          );
        })}
      </div>
      {onNearEnd && <div className="sc-feed-end" ref={setEndEl} aria-hidden />}
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
