import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Soft fades on the ends of a horizontal scroller, shown only where the
 * content actually continues.
 *
 * The same behaviour the tab rail and the detail-page sliders already have,
 * pulled out so a third scroller does not become a third copy of it. A fade
 * that is always on lies about the left edge at rest, so each side tracks its
 * own overflow and the shell only paints where there is more to reach.
 *
 * Returns a ref for the scrolling element and the props for its shell.
 */
export function useEdgeFades<T extends HTMLElement>(deps: unknown[] = []) {
  const ref = useRef<T>(null);
  const [left, setLeft] = useState(false);
  const [right, setRight] = useState(false);

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    setLeft(el.scrollLeft > 2);
    setRight(max > 1 && el.scrollLeft < max - 2);
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    measure();
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        measure();
      });
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    // Images land after the first paint and change the scrollable width, so a
    // one-time measurement would leave the right fade off on a row that does
    // overflow.
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    for (const child of el.children) ro.observe(child);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      el.removeEventListener('scroll', onScroll);
      ro.disconnect();
    };
    // biome-ignore lint/correctness/useExhaustiveDependencies: callers pass what changes the content
  }, [measure, ...deps]);

  /** Step roughly one screenful, snapped to whole cards so nothing half-lands. */
  const page = useCallback((dir: 1 | -1) => {
    const el = ref.current;
    if (!el) return;
    const card = (el.firstElementChild as HTMLElement | null)?.getBoundingClientRect().width ?? 240;
    const step = Math.max(card, Math.floor(el.clientWidth / (card + 14)) * (card + 14));
    el.scrollBy({ left: dir * step, behavior: 'smooth' });
  }, []);

  /**
   * A mouse wheel only speaks vertically, so without this the row is reachable
   * by trackpad and arrow key but frozen for anyone on a mouse. Only a
   * vertical-dominant gesture is redirected, and only while the row has
   * somewhere to go, so a real vertical scroll still passes through.
   */
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      const max = el.scrollWidth - el.clientWidth;
      if (max <= 1) return;
      const next = el.scrollLeft + e.deltaY;
      if ((next <= 0 && e.deltaY < 0) || (next >= max && e.deltaY > 0)) return;
      e.preventDefault();
      el.scrollLeft = next;
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  return {
    ref,
    page,
    canLeft: left,
    canRight: right,
    edges: {
      'data-overflow-left': left || undefined,
      'data-overflow-right': right || undefined,
    },
  };
}
