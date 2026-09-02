import { useLayoutEffect, useRef, useState } from 'react';
import { Popover } from '@radix-ui/themes';
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
 * One row at rest, however many: as many whole cards as fit, then a "+N"
 * chip saying how many more there are. A card cut off at the edge read as a
 * layout accident and told nobody how much was hidden; a count is the
 * statement the band exists to make. The chip opens the rest in a small
 * floating card above the band, the composer's own popover, so the sentence
 * under the caret never moves; it opens on hover the way the peeks do, and
 * a click holds it.
 *
 * Nothing here writes to the DOM behind React: when the cards change, the
 * row first renders with every card showing, a layout effect reads their
 * widths off that render plus a hidden probe wearing the widest count, and
 * only then does state hide what does not fit. A resize redoes the
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

export function SourceCards({ items }: { items: SourceItem[] }) {
  const rail = useRef<HTMLDivElement>(null);
  const peek = useIngredientPeek('.sc-source-chip');
  const rest = useHoverPreview<{ anchor: HTMLElement }>();
  const probe = useRef<HTMLSpanElement>(null);
  const widths = useRef<number[]>([]);
  const itemsKey = items.map((i) => i.key).join('|');
  const [seen, setSeen] = useState(itemsKey);
  /** How many cards the row shows at rest; the rest stand behind the chip. */
  const [shown, setShown] = useState(items.length);
  // New contents: show everything for one render so it can be measured.
  if (seen !== itemsKey) {
    setSeen(itemsKey);
    setShown(items.length);
  }

  useLayoutEffect(() => {
    const el = rail.current;
    const p = probe.current;
    if (!el || !p) return;
    const cards = Array.from(
      el.querySelectorAll<HTMLElement>('.sc-source-chip:not([data-probe]):not(.sc-source-more)'),
    );
    widths.current = cards.map((c) => c.getBoundingClientRect().width);
    const moreW = p.getBoundingClientRect().width;
    const gap = Number.parseFloat(getComputedStyle(el).columnGap) || 0;
    const place = () => setShown(fitCount(widths.current, gap, moreW, el.clientWidth));
    place();
    // the panel's seam changes the row's width under it
    const ro = new ResizeObserver(place);
    ro.observe(el);
    return () => ro.disconnect();
  }, [itemsKey]);

  const hidden = Math.max(0, items.length - shown);
  const card = (it: SourceItem, folded: boolean) => {
    const kind = isPreviewKind(it.kind) ? it.kind : null;
    const open = peek.isOpen(it.key);
    return (
      <button
        type="button"
        className="sc-source-chip"
        key={it.key}
        hidden={folded}
        title={open ? undefined : `${it.label}. Preview.`}
        aria-label={`Refining a shot of ${it.label}. Preview.`}
        {...(kind && it.thumb ? peek.bind({ key: it.key, src: it.thumb, kind, label: it.label, to: it.to }) : {})}
      >
        {it.thumb && <img src={it.thumb} alt="" data-crop={it.crop} />}
        <span dir="auto">{it.label}</span>
      </button>
    );
  };

  return (
    <div className="sc-source-chips" ref={rail}>
      {items.map((it, i) => card(it, hidden > 0 && i >= shown))}
      {hidden > 0 && (
        <Popover.Root open={!!rest.shown} onOpenChange={(o) => !o && rest.closeNow()}>
          <Popover.Trigger>
            <button
              type="button"
              className="sc-source-chip sc-source-more"
              aria-label={`Show ${hidden} more`}
              onPointerEnter={(e) => e.pointerType === 'mouse' && rest.open({ anchor: e.currentTarget })}
              onPointerLeave={(e) => e.pointerType === 'mouse' && rest.close()}
              onClick={(e) => (rest.shown ? rest.closeNow() : rest.open({ anchor: e.currentTarget }))}
            >
              +{hidden}
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
            {items.slice(shown).map((it) => card(it, false))}
          </Popover.Content>
        </Popover.Root>
      )}
      {peek.surface}
      {/* the widest count this row could ever show, measured, never seen */}
      <span ref={probe} className="sc-source-chip sc-source-more" data-probe aria-hidden="true">
        +{items.length}
      </span>
    </div>
  );
}
