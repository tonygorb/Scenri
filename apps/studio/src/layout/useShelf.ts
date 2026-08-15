import { useCallback, useEffect, useRef } from 'react';

/**
 * A horizontal shelf that never ends.
 *
 * The caller renders its cards three times over; this keeps the scroller
 * parked in the middle copy and, whenever it drifts into the first or last,
 * shifts it back by exactly one copy width. The content either side is
 * identical, so the shift is invisible: the row simply keeps going in both
 * directions, however long you flick it.
 *
 * Paging is animated here rather than with `scrollTo({behavior:'smooth'})`
 * because a browser's smooth scroll is cancelled the moment scrollLeft is
 * assigned, which is exactly what the wrap does. Holding the destination in a
 * ref and easing toward it each frame lets the wrap move the current position
 * and the destination together, so an arrow press that crosses the seam
 * carries on as one motion instead of stopping dead.
 */
export function useShelf<T extends HTMLElement>(count: number) {
  const ref = useRef<T>(null);
  /** Width of one copy of the list. The loop is built on this number. */
  const unit = useRef(0);
  const target = useRef<number | null>(null);
  const raf = useRef(0);

  const measure = useCallback(() => {
    const el = ref.current;
    if (el) unit.current = el.scrollWidth / 3;
  }, []);

  // Start in the middle copy so there is a copy to travel into either way.
  useEffect(() => {
    const el = ref.current;
    if (!el || !count) return;
    measure();
    el.scrollLeft = unit.current;
    // Cards arrive with their images, which changes the scrollable width and
    // therefore the size of one copy.
    const ro = new ResizeObserver(() => {
      const before = unit.current;
      measure();
      if (before <= 0 && unit.current > 0) el.scrollLeft = unit.current;
    });
    ro.observe(el);
    for (const child of el.children) ro.observe(child);
    return () => ro.disconnect();
  }, [count, measure]);

  /** Keep the scroller inside the middle copy, moving any destination with it. */
  const wrap = useCallback(() => {
    const el = ref.current;
    const u = unit.current;
    if (!el || u <= 0) return;
    if (el.scrollLeft < u * 0.5) {
      el.scrollLeft += u;
      if (target.current !== null) target.current += u;
    } else if (el.scrollLeft > u * 1.5) {
      el.scrollLeft -= u;
      if (target.current !== null) target.current -= u;
    }
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let pending = 0;
    const onScroll = () => {
      if (pending) return;
      pending = requestAnimationFrame(() => {
        pending = 0;
        wrap();
      });
    };
    /**
     * A mouse only speaks vertically, so without this the row is reachable by
     * trackpad and arrow key but frozen for anyone on a mouse. No clamping to
     * the ends here: on a looping shelf there are none.
     */
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      e.preventDefault();
      target.current = null;
      cancelAnimationFrame(raf.current);
      el.scrollLeft += e.deltaY;
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      if (pending) cancelAnimationFrame(pending);
      cancelAnimationFrame(raf.current);
      el.removeEventListener('scroll', onScroll);
      el.removeEventListener('wheel', onWheel);
    };
  }, [wrap]);

  /** Glide a screenful, less one card so something on screen stays on screen. */
  const page = useCallback((dir: 1 | -1) => {
    const el = ref.current;
    if (!el) return;
    // The rendered card is scaled, so measure the cell it sits in instead:
    // a paged step built on a shrunken edge card lands short every time.
    const cell = el.firstElementChild ? Number.parseFloat(getComputedStyle(el).gridAutoColumns) || 232 : 232;
    const gap = Number.parseFloat(getComputedStyle(el).columnGap) || 0;
    const stride = cell + gap;
    const step = Math.max(1, Math.floor(el.clientWidth / stride) - 1) * stride;
    target.current = el.scrollLeft + step * dir;

    cancelAnimationFrame(raf.current);
    const tick = () => {
      const dest = target.current;
      if (dest === null) return;
      const distance = dest - el.scrollLeft;
      if (Math.abs(distance) < 0.5) {
        el.scrollLeft = dest;
        target.current = null;
        return;
      }
      // Exponential ease-out: fast away, settling softly, and unbothered by a
      // wrap moving both ends of the journey mid-flight.
      el.scrollLeft += distance * 0.16;
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
  }, []);

  return { ref, page };
}
