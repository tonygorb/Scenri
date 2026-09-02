import type { ReactNode } from 'react';
import { CaretDown } from '@phosphor-icons/react';
import { shapeOf, type SectionMode } from './useShape.js';
import type { Shape } from './useShape.js';

/**
 * The shared shell: a header, and a body that changes shape under it.
 *
 * The caret is invisible until the header is hovered or focused — a disclosure
 * control that is always showing is permanent noise for something you do once
 * a section. It stays visible on touch, where there is no hover to reveal it,
 * and the header itself is the button either way, so `aria-expanded` carries
 * the state whether or not the glyph is drawn.
 *
 * The body draws the shape its mode asks for, at once, keyed so a change
 * remounts it and its fade-in plays while the box is still growing or
 * shrinking under it. It used to fade the old shape out first, swap while
 * blank, then fade in: a 130ms hole between the click and anything moving,
 * with the height jumping at the swap. A drawn-on-top copy of the old shape
 * was tried and dropped, because for the length of the fade every tile
 * existed twice. Height is not this component's business: the rail animates
 * every body together, see `useRailMotion`.
 */
export function Group({
  name,
  kind,
  count,
  mode,
  onToggle,
  action,
  children,
}: {
  name: string;
  /** Which shelf this is, for the one thing the CSS keys on it: a product tile's radius. */
  kind?: string;
  count?: number;
  mode: SectionMode;
  onToggle: () => void;
  action?: ReactNode;
  children: (shape: Shape) => ReactNode;
}) {
  const shape = shapeOf(mode);
  return (
    <div className="sc-agroup" data-mode={mode} data-kind={kind}>
      <div className="sc-agroup-h">
        <button type="button" className="sc-agroup-t" aria-expanded={mode === 'open'} onClick={onToggle}>
          <b>{name}</b>
          {count !== undefined && count > 0 && <span className="sc-agroup-n">{count}</span>}
          <CaretDown size={11} className="sc-agroup-caret" aria-hidden="true" />
        </button>
        {action}
      </div>
      <div className="sc-agroup-body">
        <div className="sc-agroup-content">
          <div className="sc-agroup-layer" key={shape}>
            {children(shape)}
          </div>
        </div>
      </div>
    </div>
  );
}
