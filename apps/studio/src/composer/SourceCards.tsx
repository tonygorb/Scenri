import { useEffect, useRef } from 'react';

/**
 * What the picture being refined is made of, worn as the source's own small
 * inverse cards in the composer's band: the product, the person and the
 * scene. Same tokens the hub's Refining chip wears, so the two shells cannot
 * drift. Each card opens the picture. Nothing here is droppable yet: the
 * band states what the next refinement carries, it does not edit it.
 *
 * One row, however many: the cards ride a strip that scrolls sideways, the
 * same rail the lens tabs use, so the band keeps one height at three cards
 * or twenty instead of stacking rows into the sentence's room. A fade at an
 * edge says there is more past it; a mouse wheel travels the row, since a
 * mouse only speaks vertically.
 */
export type SourceItem = { key: string; kind: string; label: string; thumb: string | null; crop?: 'top' };

export function SourceCards({ items, onOpen }: { items: SourceItem[]; onOpen: () => void }) {
  const rail = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = rail.current;
    if (!el) return;
    let raf = 0;
    const place = () => {
      if (el.scrollWidth - el.clientWidth - el.scrollLeft > 1) el.dataset.fadeEnd = '';
      else delete el.dataset.fadeEnd;
      if (el.scrollLeft > 1) el.dataset.fadeStart = '';
      else delete el.dataset.fadeStart;
    };
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        place();
      });
    };
    const onWheel = (e: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth + 1) return;
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY) || e.deltaY === 0) return;
      const max = el.scrollWidth - el.clientWidth;
      const next = Math.max(0, Math.min(max, el.scrollLeft + e.deltaY));
      if (next === el.scrollLeft) return;
      e.preventDefault();
      el.scrollLeft = next;
      place();
    };
    // the panel's seam changes the row's width under it
    const ro = new ResizeObserver(place);
    ro.observe(el);
    el.addEventListener('scroll', onScroll, { passive: true });
    el.addEventListener('wheel', onWheel, { passive: false });
    place();
    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf);
      el.removeEventListener('scroll', onScroll);
      el.removeEventListener('wheel', onWheel);
    };
  }, []);

  return (
    <div className="sc-source-chips" ref={rail}>
      {items.map((it) => (
        <button
          type="button"
          className="sc-source-chip"
          key={it.key}
          title={`${it.label}. Open the image.`}
          aria-label={`Refining a shot of ${it.label}. Open the image.`}
          onClick={onOpen}
        >
          {it.thumb && <img src={it.thumb} alt="" data-crop={it.crop} />}
          <span dir="auto">{it.label}</span>
        </button>
      ))}
    </div>
  );
}
