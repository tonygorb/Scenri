import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { WarningCircle } from '@phosphor-icons/react';
import { thumbUrl } from '../../api.js';
import { briefProse, type ProseNames } from '../../briefDiff.js';
import { ChipPreview } from '../../composer/ChipPreview.js';
import { useHoverPreview } from '../../composer/useHoverPreview.js';
import { recordedRatio } from '../Stage.js';
import type { TrailStep } from './historyRules.js';

/** The fade over an edge with more trail past it; the stylesheet draws it at the same width. */
const FADE_PX = 28;

/**
 * The image's history as a trail under the stage: the original, a hairline,
 * then every refinement in the order it was made, the one on the stage
 * ringed. Each tile is the picture at its own shape, not a square crop, so
 * the row reads as that picture's versions and not as another gallery (the
 * rail beside the stage is the feed, and its tiles are square). One line at
 * the picture's left edge says where you are, "Original" or "Refinement 4 of
 * 6"; no numeral under any tile. Hovering or focusing a tile peeks it at a
 * readable size with its name and what that step asked for; clicking moves
 * the stage to it. Past the picture's width the trail scrolls, the ringed
 * step is kept in view, and a fade says there is more.
 *
 * One hover peek for the whole trail, owned here rather than by the overlay:
 * shared, so moving between two tiles switches the card at once instead of
 * closing one and re-opening the next; here, so resting the pointer on a
 * tile re-renders a handful of buttons, not the overlay and the second
 * composer inside it.
 */
export function LineageStrip({
  trail,
  activeId,
  names,
  onSelect,
}: {
  trail: TrailStep[];
  activeId: string;
  /** How the card speaks a chip in a step's sentence: by name, never by id. */
  names: ProseNames;
  onSelect: (id: string) => void;
}) {
  const ref = useRef<HTMLElement>(null);
  /** What each step asked for, once per trail: the sentence the card and the label read. */
  const said = useMemo(() => trail.map((s) => briefProse(s.node, names)), [trail, names]);
  const peek = useHoverPreview<{
    key: string;
    src: string;
    label: string;
    said: string;
    from: string | null;
    el: HTMLElement;
    id: string;
  }>();
  const peekAt = (s: TrailStep, i: number, el: HTMLElement) =>
    peek.open({
      key: s.node.id,
      src: thumbUrl(s.node.images[0], 'tile'),
      label: s.label,
      said: said[i],
      from: s.from,
      el,
      id: s.node.id,
    });

  // The ringed step stays in view as the stage moves: the least scroll that
  // shows it, and the one you chose, never the newest.
  useEffect(() => {
    ref.current
      ?.querySelector<HTMLElement>('[aria-pressed="true"]')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  }, [activeId]);

  // Which end has more: a fade over that edge, and none over a trail that
  // fits. Measured, because a mask that always fades dims the first and the
  // last tile of a row that has nothing hidden.
  const [more, setMore] = useState<'start' | 'end' | 'both' | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const max = el.scrollWidth - el.clientWidth;
      if (max <= 1) return setMore(null);
      const x = el.scrollLeft;
      setMore(x <= 1 ? 'end' : x >= max - 1 ? 'start' : 'both');
    };
    // A narrower stage can leave the ringed step under a fade or past it:
    // slide it back, sideways only. Never scrollIntoView here, which on a
    // phone would also scroll the column whenever the keyboard resized it.
    const keep = () => {
      const tile = el.querySelector<HTMLElement>('[aria-pressed="true"]');
      if (!tile) return;
      const t = tile.getBoundingClientRect();
      const b = el.getBoundingClientRect();
      if (t.left < b.left + FADE_PX) el.scrollLeft -= b.left + FADE_PX - t.left;
      else if (t.right > b.right - FADE_PX) el.scrollLeft += t.right - (b.right - FADE_PX);
    };
    measure();
    el.addEventListener('scroll', measure, { passive: true });
    const ro = new ResizeObserver(() => {
      keep();
      measure();
    });
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', measure);
      ro.disconnect();
    };
  }, [trail.length]);

  // A mouse only speaks vertically, so a trail that overflows takes the
  // wheel sideways; one that fits leaves the wheel alone. Native, because
  // React's wheel listener is passive and cannot stop the page.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // Left and right move focus along the trail and stop there, so the
  // overlay's own walk of the feed stays quiet while the trail has the
  // keyboard; up and down still step the history, as they do anywhere.
  const onKeyDown = (e: ReactKeyboardEvent<HTMLElement>) => {
    const tiles = [...(ref.current?.querySelectorAll<HTMLButtonElement>('.sc-trail-tile:not([aria-disabled])') ?? [])];
    const i = tiles.indexOf(document.activeElement as HTMLButtonElement);
    let to = -1;
    if (e.key === 'ArrowRight') to = Math.min(tiles.length - 1, i + 1);
    else if (e.key === 'ArrowLeft') to = Math.max(0, i - 1);
    else if (e.key === 'Home') to = 0;
    else if (e.key === 'End') to = tiles.length - 1;
    else return;
    e.preventDefault();
    e.stopPropagation();
    tiles[to]?.focus();
  };

  // one tab stop: the ringed step, or the first when the stage holds something the trail does not
  const stop = trail.some((s) => s.node.id === activeId) ? activeId : trail[0]?.node.id;
  /** Where you are, in one line: the step on the stage and how many refinements there are. */
  const here = trail.find((s) => s.node.id === activeId);
  const last = trail[trail.length - 1]?.index ?? 0;
  const say = !here ? '' : here.index === 0 ? 'Original' : `Refinement ${here.index} of ${last}`;

  return (
    <div className="sc-trail">
      {say && <span className="sc-trail-say">{say}</span>}
      <nav
        ref={ref}
        className="sc-thumbs"
        aria-label="History of this shot"
        data-more={more ?? undefined}
        onKeyDown={onKeyDown}
      >
        {trail.map((s, i) => {
          const n = s.node;
          const active = n.id === activeId;
          const pending = s.state === 'pending';
          const ratio = recordedRatio(n);
          const shape = ratio ? ({ '--sc-tile-ar': ratio } as CSSProperties) : undefined;
          return (
            <button
              type="button"
              key={n.id}
              className="sc-thumb-btn sc-trail-tile"
              // the original stands apart from what was made of it: a hairline after it
              data-original={s.index === 0 && trail.length > 1 ? '' : undefined}
              // the step's name and what it asked for, so a reader hears the
              // history the tiles show; the name alone when nothing was recorded
              aria-label={said[i] ? `${s.label}: ${said[i]}` : s.label}
              aria-pressed={active}
              aria-disabled={pending || undefined}
              tabIndex={n.id === stop ? 0 : -1}
              onClick={() => {
                // a picture that is not there yet cannot be looked at; the tile fills in when it lands
                if (pending) return;
                peek.closeNow();
                onSelect(n.id);
              }}
              onPointerEnter={(e) => e.pointerType === 'mouse' && s.state === 'ready' && peekAt(s, i, e.currentTarget)}
              onPointerLeave={(e) => e.pointerType === 'mouse' && peek.close()}
              onFocus={(e) =>
                e.currentTarget.matches(':focus-visible') && s.state === 'ready' && peekAt(s, i, e.currentTarget)
              }
            >
              {s.state === 'ready' ? (
                <img
                  src={thumbUrl(n.images[0], 'micro')}
                  alt=""
                  className="sc-thumb sc-trail-pic"
                  style={shape}
                  loading="lazy"
                  decoding="async"
                  data-active={active}
                  height={52}
                />
              ) : pending ? (
                <span className="sc-thumb sc-trail-pic sc-thumb-wait" style={shape} data-active={active}>
                  <span className="sc-shimmer" />
                </span>
              ) : (
                <span className="sc-thumb sc-trail-pic sc-thumb-failed" style={shape} data-active={active}>
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
          src={peek.shown.src}
          label={peek.shown.label}
          // the step's own ask under its name, and its source only when that
          // is not the tile before it
          noun={peek.shown.said}
          note={peek.shown.from ? `From ${peek.shown.from}` : null}
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
    </div>
  );
}
