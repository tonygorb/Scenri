import { CaretLeft, CaretRight } from '@phosphor-icons/react';
import type { CSSProperties, ReactNode } from 'react';
import { useRefRail } from './useRefRail.js';

/**
 * A row of things that scrolls, with the app's one set of manners.
 *
 * There were three of these before this existed: the shelf slider on a look
 * page, the thumb rail under a product's stage, and a third written for the
 * presenter page. Each had its own fades, its own arrows and its own idea of
 * what happens at the end of the run, and a fourth surface would have grown a
 * fourth. This is that behaviour once, so the next row is a component and not
 * another set of decisions.
 *
 * The manners: the arrows and the edge fades belong to the pointer, so they
 * are absent until it is over the row; a direction with nothing left in it
 * fades its arrow out rather than taking it away, because a control that
 * vanishes under the cursor moves everything beside it; below 1024px there
 * are no arrows at all, because the swipe is the control; and reduced motion
 * removes every transition. Paging is one item per press.
 *
 * What it does not do is decide for the surface. A row of cards and a row of
 * references want different widths, so the surface sets those on the track;
 * where the arrows sit vertically is `--sc-rail-arrow-y` (the middle of the
 * row by default, which is wrong wherever the items carry a caption under
 * them); and a surface that does not want the edge fades turns them off.
 */
export function Rail({
  count,
  label,
  className,
  trackClassName,
  style,
  children,
}: {
  /** How many items are in it, so the overflow flags are recomputed when it changes. */
  count: number;
  /** What the row is, for a screen reader. */
  label: string;
  /** The surface's own class on the row, where it tunes chrome it does not want. */
  className?: string;
  /** The surface's own class on the track, where it sets its widths. */
  trackClassName?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  const { shellRef, railRef, page } = useRefRail<HTMLDivElement, HTMLOListElement>(count);
  return (
    <div className={className ? `sc-rail ${className}` : 'sc-rail'} ref={shellRef}>
      <button type="button" className="sc-rail-arrow prev" aria-label={`${label}, earlier`} onClick={() => page(-1)}>
        <CaretLeft size={13} weight="bold" />
      </button>
      <button type="button" className="sc-rail-arrow next" aria-label={`${label}, later`} onClick={() => page(1)}>
        <CaretRight size={13} weight="bold" />
      </button>
      <ol
        className={trackClassName ? `sc-rail-track ${trackClassName}` : 'sc-rail-track'}
        aria-label={label}
        ref={railRef}
        style={style}
      >
        {children}
      </ol>
    </div>
  );
}
