import type { CSSProperties } from 'react';
import type { Swatch } from './question.js';

/**
 * The figure on a drawn option: one cell of a sprite sheet.
 *
 * A shape is quicker to recognise than to read, so a row can be drawn once as
 * a sheet and every option shows its own cell of it. The component knows the
 * sheet by name and the cell by position, and nothing about what is drawn on
 * it: the flow names both beside its options, and the stylesheet keys the
 * sheet's picture on `data-kind` and, where a sheet draws more than one
 * figure, on `data-cast`.
 */
export function LookArt({ art, cast }: { art: NonNullable<Swatch['art']>; cast?: string }) {
  return (
    <span
      className="sc-look-art"
      data-kind={art.sheet}
      data-cast={cast}
      style={{ '--sc-look-x': art.x, '--sc-look-y': art.y } as CSSProperties}
      aria-hidden="true"
    />
  );
}
