import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { WarningCircle } from '@phosphor-icons/react';
import { nodeLabel, type FeedNode, thumbUrl } from '../../api.js';
import { ChipPreview } from '../../composer/ChipPreview.js';
import { useHoverPreview } from '../../composer/useHoverPreview.js';

/** How close to the end of the rail asks for the next page of the feed. */
const END_PX = 200;

/**
 * The feed you came from, stood on end beside the stage.
 *
 * Every shot the grid holds, in the grid's own order (its lens, its set, its
 * search, its sort), originals and refinements alike, because that is what
 * the grid shows and the rail is the grid seen from inside a shot. The ring
 * marks the shot on screen; the strip under the stage rings the same shot
 * inside its own history, which is the other axis. Same tile both places,
 * so orientation and position say which axis is which and neither row needs
 * a label.
 *
 * Selection is a click, a tap, or Enter on a focused tile, never a scroll:
 * the rail scrolls to browse, and the shot on the stage does not move until
 * asked. Arrow keys move focus inside the rail and stop there, so the
 * overlay's own arrows stay quiet while the rail has the keyboard.
 *
 * Only what the pages hold is here, at the smallest derivative, and reaching
 * the end asks the feed for the page the grid would have fetched next.
 */
export function ShotRail({
  shots,
  activeId,
  onSelect,
  onEndReached,
  complete,
}: {
  shots: FeedNode[];
  /** The shot on screen. */
  activeId: string;
  onSelect: (id: string) => void;
  onEndReached: () => void;
  complete: boolean;
}) {
  const ref = useRef<HTMLElement>(null);
  const peek = useHoverPreview<{ key: string; src: string; label: string; el: HTMLElement; id: string }>();
  const peekAt = (n: FeedNode, el: HTMLElement) =>
    peek.open({ key: n.id, src: thumbUrl(n.images[0], 'tile'), label: nodeLabel(n), el, id: n.id });

  // The ringed tile stays in view as the stage moves: centred when the rail
  // first shows, the least scroll after that, and never under the fades
  // (the rail's scroll padding keeps it clear of them).
  const shown = useRef(false);
  useEffect(() => {
    const tile = ref.current?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (!tile) return;
    tile.scrollIntoView({ block: shown.current ? 'nearest' : 'center', behavior: shown.current ? 'smooth' : 'auto' });
    shown.current = true;
  }, [activeId]);

  const onScroll = () => {
    const el = ref.current;
    if (!el || complete) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - END_PX) onEndReached();
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLElement>) => {
    const tiles = [...(ref.current?.querySelectorAll<HTMLButtonElement>('.sc-rail-tile:not([aria-disabled])') ?? [])];
    const i = tiles.indexOf(document.activeElement as HTMLButtonElement);
    let to = -1;
    if (e.key === 'ArrowDown') to = Math.min(tiles.length - 1, i + 1);
    else if (e.key === 'ArrowUp') to = Math.max(0, i - 1);
    else if (e.key === 'Home') to = 0;
    else if (e.key === 'End') to = tiles.length - 1;
    else return;
    e.preventDefault();
    e.stopPropagation();
    tiles[to]?.focus();
  };

  // one tab stop: the ringed tile, or the first when the shot on screen is not in the pages
  const stop = shots.some((n) => n.id === activeId) ? activeId : shots[0]?.id;

  return (
    <>
      <nav ref={ref} className="sc-rail" aria-label="Shots in this view" onScroll={onScroll} onKeyDown={onKeyDown}>
        {shots.map((n) => {
          const active = n.id === activeId;
          const running = n.status === 'running';
          const ready = n.status === 'done' && !!n.images[0];
          return (
            <button
              type="button"
              key={n.id}
              className="sc-thumb-btn sc-rail-tile"
              aria-label={running ? `${nodeLabel(n)}, still rendering` : nodeLabel(n)}
              aria-pressed={active}
              aria-disabled={running || undefined}
              tabIndex={n.id === stop ? 0 : -1}
              onClick={() => {
                // a picture that is not there yet cannot be looked at; the tile fills in when it lands
                if (running) return;
                peek.closeNow();
                onSelect(n.id);
              }}
              onPointerEnter={(e) => e.pointerType === 'mouse' && ready && peekAt(n, e.currentTarget)}
              onPointerLeave={(e) => e.pointerType === 'mouse' && peek.close()}
              onFocus={(e) => e.currentTarget.matches(':focus-visible') && ready && peekAt(n, e.currentTarget)}
            >
              {ready ? (
                <img
                  src={thumbUrl(n.images[0], 'micro')}
                  alt=""
                  className="sc-thumb"
                  loading="lazy"
                  decoding="async"
                  data-active={active}
                  width={52}
                  height={52}
                />
              ) : running ? (
                <span className="sc-thumb sc-rail-wait" data-active={active}>
                  <span className="sc-shimmer" />
                </span>
              ) : (
                <span className="sc-thumb sc-rail-failed" data-active={active}>
                  <WarningCircle size={14} />
                </span>
              )}
            </button>
          );
        })}
      </nav>
      {peek.shown && (
        <ChipPreview
          key={peek.shown.key}
          anchor={peek.shown.el}
          kind="shot"
          noun="Shot"
          src={peek.shown.src}
          label={peek.shown.label}
          onOpen={() => {
            const id = peek.shown?.id;
            peek.closeNow();
            if (id) onSelect(id);
          }}
          onHoverIn={peek.keep}
          onHoverOut={peek.close}
          onClose={peek.closeNow}
        />
      )}
    </>
  );
}
