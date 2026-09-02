import { useLayoutEffect, useRef, useState } from 'react';
import { Popover } from '@radix-ui/themes';
import { fitCount } from './sourceFit.js';

/**
 * What the picture being refined is made of, worn as the source's own small
 * inverse cards in the composer's band: the product, the person and the
 * scene. Same tokens the hub's Refining chip wears, so the two shells cannot
 * drift. Each card opens the picture. Nothing here is droppable yet: the
 * band states what the next refinement carries, it does not edit it.
 *
 * One row at rest, however many: as many whole cards as fit, then a "+N"
 * chip saying how many more there are. A card cut off at the edge read as a
 * layout accident and told nobody how much was hidden; a count is the
 * statement the band exists to make. The chip opens the rest in a small
 * floating card above the band, the composer's own popover, so the sentence
 * under the caret never moves.
 *
 * Nothing here writes to the DOM behind React: when the cards change, the
 * row first renders with every card showing, a layout effect reads their
 * widths off that render plus a hidden probe wearing the widest count, and
 * only then does state hide what does not fit. A resize redoes the
 * arithmetic on the kept widths without measuring again.
 */
export type SourceItem = { key: string; kind: string; label: string; thumb: string | null; crop?: 'top' };

export function SourceCards({ items, onOpen }: { items: SourceItem[]; onOpen: () => void }) {
  const rail = useRef<HTMLDivElement>(null);
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
  const card = (it: SourceItem, folded: boolean) => (
    <button
      type="button"
      className="sc-source-chip"
      key={it.key}
      hidden={folded}
      title={`${it.label}. Open the image.`}
      aria-label={`Refining a shot of ${it.label}. Open the image.`}
      onClick={onOpen}
    >
      {it.thumb && <img src={it.thumb} alt="" data-crop={it.crop} />}
      <span dir="auto">{it.label}</span>
    </button>
  );

  return (
    <div className="sc-source-chips" ref={rail}>
      {items.map((it, i) => card(it, hidden > 0 && i >= shown))}
      {hidden > 0 && (
        <Popover.Root>
          <Popover.Trigger>
            <button type="button" className="sc-source-chip sc-source-more" aria-label={`Show ${hidden} more`}>
              +{hidden}
            </button>
          </Popover.Trigger>
          <Popover.Content className="sc-source-pop" side="top" align="end" sideOffset={8}>
            {items.slice(shown).map((it) => card(it, false))}
          </Popover.Content>
        </Popover.Root>
      )}
      {/* the widest count this row could ever show, measured, never seen */}
      <span ref={probe} className="sc-source-chip sc-source-more" data-probe aria-hidden="true">
        +{items.length}
      </span>
    </div>
  );
}
