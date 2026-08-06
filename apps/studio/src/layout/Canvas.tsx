import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { Check, GitBranch, Stack, Star, WarningCircle, XCircle } from '@phosphor-icons/react';
import { hasNoShots, imgUrl, nodeLabel, type ShotSet, type TreeNode } from '../api.js';
import { dismissedIds, dismissNode } from '../dismissed.js';
import { elapsedSec, runningPhrase } from '../tasks.js';

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
  brandId,
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
  brandId: string;
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
  const [dismissTick, setDismissTick] = useState(0);
  const dismissed = useMemo(() => new Set(dismissedIds(brandId)), [brandId, dismissTick]);
  const shots = nodes.filter((n) => n.kind !== 'root' && !dismissed.has(n.id));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const picking = !!onPick;
  // a callback ref rather than useRef: the feed is not in the tree at all while
  // the brand is empty, so an effect keyed on a ref object would never see it
  // arrive and would measure nothing for the rest of the session
  const [feedEl, setFeedEl] = useState<HTMLDivElement | null>(null);
  const { tile: colWidth, cols: fitting } = layout(useWidth(feedEl), tile, useViewportWidth() < PHONE);

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
          // pass already fixed for LookCard and the kept-star badge. A sibling
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
              <button
                type="button"
                className="sc-cell-retry"
                onClick={() => {
                  dismissNode(brandId, n.id);
                  setDismissTick((t) => t + 1);
                }}
              >
                Dismiss
              </button>
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
              <button
                type="button"
                className="sc-cell-retry"
                onClick={() => {
                  dismissNode(brandId, n.id);
                  setDismissTick((t) => t + 1);
                }}
              >
                Dismiss
              </button>
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
        <div key={n.id} className="sc-cell" data-selected={n.id === selectedId} data-picked={chosen || undefined}>
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
        </div>,
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
  );
}

/** The gutter between tiles, matching `.sc-cell`'s own bottom margin. */
const GAP = 14;
/** Below this the grid-size slider is hidden (`.sc-density`'s own `max-width:
 * 767px` in tokens.css — matched here exactly against the viewport, the same
 * thing the CSS media query keys off). This used to stop at 560, leaving a
 * 561-767px dead band: no slider to drag, but also no forced 2-column
 * fallback, so a tablet-portrait or resized-desktop width was stuck with
 * whatever tile size a wider session had left behind. */
const PHONE = 768;

/** The feed's own width, watched, because the column maths needs the real one. */
function useWidth(el: HTMLElement | null): number {
  const [w, setW] = useState(0);
  useEffect(() => {
    if (!el) return;
    const measure = () => setW(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return w;
}

/** The window's own width, for the phone-mode decision specifically — the
 * feed's own content width (`useWidth` above) isn't it, since the assets
 * panel's fixed width shrinks the feed independently of the viewport. A wide
 * window with the panel open could measure a narrow feed while the CSS
 * media query (which keys off the viewport) still shows a slider that would
 * then silently do nothing, stuck in the forced-2-column branch below. */
function useViewportWidth(): number {
  const [w, setW] = useState(() => window.innerWidth);
  useEffect(() => {
    const onResize = () => setW(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return w;
}

/**
 * How wide a tile actually is, and how many fit.
 *
 * `columns: auto <width>` balanced column *height*, so a few tall tiles packed
 * two columns and left the third empty — 380px of dead feed on a 1440 screen.
 * Counting here instead fills the row, and because the columns are then a fixed
 * width rather than stretched, the grid-size slider changes the picture on
 * every step instead of only when the column count happens to tick over.
 */
function layout(width: number, tile: number, phoneMode: boolean): { tile: number; cols: number } {
  if (width <= 0) return { tile, cols: 1 };
  // A phone has no slider — there is no room to drag one — so it must not
  // inherit whatever size a desktop session left behind, and a fixed column
  // width from that session would simply overflow the screen. `phoneMode` is
  // the viewport's call, not this element's own width: the assets panel
  // narrows the feed on its own, and a slider the CSS still shows has to
  // still work, not silently stop doing anything.
  if (phoneMode) {
    return { tile: Math.floor((width - GAP) / 2), cols: 2 };
  }
  return { tile, cols: Math.max(1, Math.floor((width + GAP) / (tile + GAP))) };
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
