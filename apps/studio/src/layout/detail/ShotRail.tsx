import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { WarningCircle } from '@phosphor-icons/react';
import { nodeLabel, type FeedNode, thumbUrl } from '../../api.js';
import { ChipPreview } from '../../composer/ChipPreview.js';
import { useHoverPreview } from '../../composer/useHoverPreview.js';

/** How close to the end of the rail asks for the next page of the feed. */
const END_PX = 200;

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

  // The ringed tile sits in the middle of the rail, always: placed there at
  // once when the rail first shows, and slid there on every step after. The
  // ends of the column dissolve, so the middle is where a tile is whole and
  // the column reads outward from the shot on screen in both directions.
  const shown = useRef(false);
  useEffect(() => {
    const tile = ref.current?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (!tile) return;
    tile.scrollIntoView({ block: 'center', behavior: shown.current ? 'smooth' : 'auto' });
    shown.current = true;
  }, [activeId]);

  // Which end has more shots past it: a fade over that end, and none over
  // an end the list has reached. The fade says "this continues", so at the
  // list's own start or end there is nothing to say, and the first or the
  // last shot on the stage sits whole rather than under a fade.
  const [more, setMore] = useState<'start' | 'end' | 'both' | null>(null);
  const measure = () => {
    const el = ref.current;
    if (!el) return;
    const max = el.scrollHeight - el.clientHeight;
    if (max <= 1) return setMore(null);
    const y = el.scrollTop;
    setMore(y <= 1 ? 'end' : y >= max - 1 ? 'start' : 'both');
  };
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [shots.length]);

  const onScroll = () => {
    measure();
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
      {/* the shell carries the fades, above the column and outside its scroll */}
      <div className="sc-rail-shell" data-more={more ?? undefined}>
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
                  <span className="sc-thumb sc-thumb-wait" data-active={active}>
                    <span className="sc-shimmer" />
                  </span>
                ) : (
                  <span className="sc-thumb sc-thumb-failed" data-active={active}>
                    <WarningCircle size={14} />
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>
      {peek.shown && (
        <ChipPreview
          key={peek.shown.key}
          anchor={peek.shown.el}
          kind="shot"
          noun="Shot"
          side="beside"
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
