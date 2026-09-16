import { CaretDown, X } from '@phosphor-icons/react';
import type { ReactNode } from 'react';

/**
 * A field showing a list of short words that opens something.
 *
 * The field itself is not a button. A button cannot hold the remove control
 * the composer already uses (an X that floats over the right edge on hover),
 * and the first version that tried put a button inside a button. The hit that
 * opens the menu is a sibling underneath; each chip is a span, and taking one
 * off is the chip's own button, the same pattern as a brief token.
 *
 * The chips wrap. A one-line row with a trailing ellipsis hid words the
 * person had already chosen, which is the thing a details field is there to
 * show. This sheet has one list, so wrapping it does not shove a neighbour
 * around.
 */
export function ChipField({
  items,
  placeholder,
  open,
  hit,
  onRemove,
  onOpen,
}: {
  items: string[];
  placeholder?: ReactNode;
  open?: boolean;
  /** The menu trigger, stretched under the chips so the popper is field-wide. */
  hit: ReactNode;
  onRemove?: (item: string) => void;
  /** Clicking a chip (not its X) still opens the menu. */
  onOpen?: () => void;
}) {
  return (
    <div className="sc-chipfield" data-state={open ? 'open' : undefined}>
      {hit}
      <span className="sc-chipfield-row">
        {items.length === 0 && placeholder ? <span className="sc-chipfield-ph">{placeholder}</span> : null}
        {items.map((item) => (
          <span key={item} className="sc-chipfield-chip" onClick={() => onOpen?.()}>
            {item}
            {onRemove && (
              <button
                type="button"
                data-role="remove"
                aria-label={`Remove ${item}`}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onRemove(item);
                }}
              >
                <X size={10} weight="bold" />
              </button>
            )}
          </span>
        ))}
      </span>
      <CaretDown size={13} className="sc-chipfield-caret" aria-hidden />
    </div>
  );
}
