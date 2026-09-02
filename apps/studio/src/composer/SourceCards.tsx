import { useEffect, useRef, useState } from 'react';
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
 * statement the band exists to make. The chip opens the row in place, the
 * cards wrap, and the same chip folds it back.
 */
export type SourceItem = { key: string; kind: string; label: string; thumb: string | null; crop?: 'top' };

export function SourceCards({ items, onOpen }: { items: SourceItem[]; onOpen: () => void }) {
  const rail = useRef<HTMLDivElement>(null);
  const more = useRef<HTMLButtonElement>(null);
  const [expanded, setExpanded] = useState(false);
  /** How many cards the row shows at rest; the rest stand behind the chip. */
  const [shown, setShown] = useState(items.length);

  // Fold back whenever the row's contents change: the count is about these
  // cards, and a previous shot's "open" is nothing to inherit.
  useEffect(() => setExpanded(false), [items]);

  useEffect(() => {
    const el = rail.current;
    const chip = more.current;
    if (!el || !chip) return;
    const cards = Array.from(el.querySelectorAll<HTMLElement>('.sc-source-chip:not(.sc-source-more)'));
    /**
     * One measured layout per change, never per keystroke: every card is
     * unhidden, read once, and the widths are kept, so a resize only redoes
     * the arithmetic.
     */
    let widths: number[] = [];
    const measure = () => {
      for (const c of cards) c.hidden = false;
      chip.hidden = false;
      chip.textContent = `+${items.length}`;
      widths = cards.map((c) => c.getBoundingClientRect().width);
      return chip.getBoundingClientRect().width;
    };
    // read once per items change; a two-digit count is measured with its own
    // label, so the reservation is never a digit short
    const moreW = measure();
    const gap = Number.parseFloat(getComputedStyle(el).columnGap) || 0;
    const place = () => setShown(fitCount(widths, gap, moreW, el.clientWidth));
    place();
    const ro = new ResizeObserver(place);
    ro.observe(el);
    return () => ro.disconnect();
  }, [items]);

  const hidden = Math.max(0, items.length - shown);
  const open = expanded || hidden === 0;

  return (
    <div className="sc-source-chips" ref={rail} data-expanded={expanded || undefined}>
      {items.map((it, i) => (
        <button
          type="button"
          className="sc-source-chip"
          key={it.key}
          hidden={!open && i >= shown}
          title={`${it.label}. Open the image.`}
          aria-label={`Refining a shot of ${it.label}. Open the image.`}
          onClick={onOpen}
        >
          {it.thumb && <img src={it.thumb} alt="" data-crop={it.crop} />}
          <span dir="auto">{it.label}</span>
        </button>
      ))}
      <button
        type="button"
        ref={more}
        className="sc-source-chip sc-source-more"
        hidden={hidden === 0}
        aria-expanded={expanded}
        aria-label={expanded ? 'Show fewer' : `Show ${hidden} more`}
        onClick={() => setExpanded((v) => !v)}
      >
        {expanded ? 'less' : `+${hidden}`}
      </button>
    </div>
  );
}
