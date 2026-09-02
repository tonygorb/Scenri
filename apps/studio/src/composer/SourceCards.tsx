import { useLayoutEffect, useRef, useState } from 'react';
import { Popover } from '@radix-ui/themes';
import { useNavigate } from 'react-router';
import { isPreviewKind } from './ChipPreview.js';
import { fitCount } from './sourceFit.js';
import { useHoverPreview } from './useHoverPreview.js';
import { useIngredientPeek } from './useIngredientPeek.js';

/**
 * What the picture being refined is made of, worn as the source's own small
 * inverse cards in the composer's band: the product, the person and the
 * scene. Same tokens the hub's Refining chip wears, so the two shells cannot
 * drift. A card behaves as every read-only ingredient chip does: hovering
 * peeks its picture, a click pins the card, and the card is the door to the
 * catalog page. Nothing here is droppable yet: the band states what the next
 * refinement carries, it does not edit it.
 *
 * One row, however many. The scene is the world every refinement keeps, so
 * it always shows; then as many product and presenter cards as fit; then the
 * rest fold into a stack of their own thumbnails with a count, so what is
 * folded is still recognisable at a glance. The stack opens the folded names
 * as a flat list in the composer's own popover, on hover the way the peeks
 * open, held by a click; nothing under the caret ever moves.
 *
 * Nothing here writes to the DOM behind React: when the cards change, the
 * row first renders with every card showing, a layout effect reads their
 * widths off that render plus a hidden probe wearing the widest stack, and
 * only then does state fold what does not fit. A resize redoes the
 * arithmetic on the kept widths without measuring again.
 */
export type SourceItem = {
  key: string;
  kind: string;
  label: string;
  thumb: string | null;
  crop?: 'top';
  /** The catalog page, when the thing has one. */
  to?: string;
};

/** How many folded thumbnails the stack shows before the count does the rest. */
const FACES = 3;

export function SourceCards({ items }: { items: SourceItem[] }) {
  const navigate = useNavigate();
  const rail = useRef<HTMLDivElement>(null);
  const probe = useRef<HTMLSpanElement>(null);
  const widths = useRef<number[]>([]);
  const peek = useIngredientPeek('.sc-source-chip');
  const rest = useHoverPreview<{ anchor: HTMLElement }>();

  const world = items.find((i) => i.kind === 'scene') ?? null;
  const foldable = items.filter((i) => i !== world);
  const itemsKey = items.map((i) => i.key).join('|');
  const [seen, setSeen] = useState(itemsKey);
  /** How many foldable cards the row shows; the rest stand in the stack. */
  const [shown, setShown] = useState(foldable.length);
  // New contents: show everything for one render so it can be measured.
  if (seen !== itemsKey) {
    setSeen(itemsKey);
    setShown(foldable.length);
  }

  useLayoutEffect(() => {
    const el = rail.current;
    const p = probe.current;
    if (!el || !p) return;
    const cards = Array.from(el.querySelectorAll<HTMLElement>('.sc-source-chip[data-foldable]'));
    widths.current = cards.map((c) => c.getBoundingClientRect().width);
    const pinned = el.querySelector<HTMLElement>('.sc-source-chip[data-world]');
    const gap = Number.parseFloat(getComputedStyle(el).columnGap) || 0;
    const worldW = pinned ? pinned.getBoundingClientRect().width + gap : 0;
    const stackW = p.getBoundingClientRect().width;
    const place = () => setShown(fitCount(widths.current, gap, stackW, el.clientWidth - worldW));
    place();
    // the panel's seam changes the row's width under it
    const ro = new ResizeObserver(place);
    ro.observe(el);
    return () => ro.disconnect();
  }, [itemsKey]);

  const folded = foldable.slice(shown);
  const hidden = folded.length;

  const card = (it: SourceItem, extra: Record<string, unknown>) => {
    const kind = isPreviewKind(it.kind) ? it.kind : null;
    const open = peek.isOpen(it.key);
    return (
      <button
        type="button"
        className="sc-source-chip"
        key={it.key}
        title={open ? undefined : `${it.label}. Preview.`}
        aria-label={`Refining a shot of ${it.label}. Preview.`}
        {...extra}
        {...(kind && it.thumb ? peek.bind({ key: it.key, src: it.thumb, kind, label: it.label, to: it.to }) : {})}
      >
        {it.thumb && <img src={it.thumb} alt="" data-crop={it.crop} />}
        <span dir="auto">{it.label}</span>
      </button>
    );
  };

  const faces = (list: SourceItem[]) => (
    <span className="sc-source-faces">
      {list
        .slice(0, FACES)
        .map((it) => (it.thumb ? <img key={it.key} src={it.thumb} alt="" data-crop={it.crop} /> : null))}
    </span>
  );

  return (
    <div className="sc-source-chips" ref={rail}>
      {foldable.map((it, i) => card(it, { 'data-foldable': '', hidden: hidden > 0 && i >= shown }))}
      {world && card(world, { 'data-world': '' })}
      {hidden > 0 && (
        <Popover.Root open={!!rest.shown} onOpenChange={(o) => !o && rest.closeNow()}>
          <Popover.Trigger>
            <button
              type="button"
              className="sc-source-chip sc-source-stack"
              aria-label={`Show ${hidden} more`}
              onPointerEnter={(e) => e.pointerType === 'mouse' && rest.open({ anchor: e.currentTarget })}
              onPointerLeave={(e) => e.pointerType === 'mouse' && rest.close()}
              onClick={(e) => (rest.shown ? rest.closeNow() : rest.open({ anchor: e.currentTarget }))}
            >
              {faces(folded)}
              <span>+{hidden}</span>
            </button>
          </Popover.Trigger>
          <Popover.Content
            className="sc-source-pop"
            side="top"
            align="end"
            sideOffset={8}
            onPointerEnter={rest.keep}
            onPointerLeave={rest.close}
          >
            {folded.map((it) => (
              <button
                type="button"
                className="sc-source-row"
                key={it.key}
                onClick={() => {
                  rest.closeNow();
                  if (it.to) navigate(it.to);
                }}
              >
                {it.thumb && <img src={it.thumb} alt="" data-crop={it.crop} />}
                <span dir="auto">{it.label}</span>
              </button>
            ))}
          </Popover.Content>
        </Popover.Root>
      )}
      {/* the widest stack this row could ever show, measured, never seen */}
      <span ref={probe} className="sc-source-chip sc-source-stack" data-probe aria-hidden="true">
        {faces(foldable)}
        <span>+{foldable.length}</span>
      </span>
      {peek.surface}
    </div>
  );
}
