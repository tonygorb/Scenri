import { useCallback, useLayoutEffect, useRef } from 'react';

/**
 * Overflow state and paging for the reference thumbs.
 *
 * A mouse must not pan this row — the wheel belongs to the page, and the
 * arrows are the only desktop way along the set. The row does not loop:
 * order is the product contract, and the add tile sits outside the scroller
 * so it is always on screen.
 */
export function useRefRail<Shell extends HTMLElement = HTMLDivElement, Rail extends HTMLElement = HTMLDivElement>(
  itemCount: number,
) {
  const shellRef = useRef<Shell>(null);
  const railRef = useRef<Rail>(null);

  useLayoutEffect(() => {
    const shell = shellRef.current;
    const rail = railRef.current;
    if (!shell || !rail) return;

    let fadeRaf = 0;
    const placeFades = () => {
      const max = rail.scrollWidth - rail.clientWidth;
      if (max <= 1) {
        delete shell.dataset.overflowLeft;
        delete shell.dataset.overflowRight;
        return;
      }
      if (rail.scrollLeft > 2) shell.dataset.overflowLeft = '';
      else delete shell.dataset.overflowLeft;
      if (rail.scrollLeft < max - 2) shell.dataset.overflowRight = '';
      else delete shell.dataset.overflowRight;
    };

    const onScroll = () => {
      if (fadeRaf) return;
      fadeRaf = requestAnimationFrame(() => {
        fadeRaf = 0;
        placeFades();
      });
    };

    placeFades();
    const ro = new ResizeObserver(() => placeFades());
    ro.observe(rail);
    for (const child of rail.children) ro.observe(child);

    rail.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      if (fadeRaf) cancelAnimationFrame(fadeRaf);
      ro.disconnect();
      rail.removeEventListener('scroll', onScroll);
    };
  }, [itemCount]);

  /** One thumb at a time — the set is an index, not a gallery you skip through. */
  const page = useCallback((dir: 1 | -1) => {
    const rail = railRef.current;
    if (!rail?.firstElementChild) return;
    const cell = (rail.firstElementChild as HTMLElement).getBoundingClientRect().width;
    const gap = Number.parseFloat(getComputedStyle(rail).columnGap) || 0;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    rail.scrollBy({ left: dir * (cell + gap), behavior: reduce ? 'auto' : 'smooth' });
  }, []);

  return { shellRef, railRef, page };
}
