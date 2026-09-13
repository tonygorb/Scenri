import { CaretDown } from '@phosphor-icons/react';
import { forwardRef, type ReactNode, useCallback, useEffect, useRef, useState } from 'react';

/**
 * A field showing a list of short words, on one line, that opens something.
 *
 * It is one button and nothing else. The first version laid an invisible
 * button under the words so each chip could carry its own Remove, and that
 * put a button inside a button, needed three layers of pointer-events to stay
 * clickable, and still missed presses. A popper is also sized from its
 * trigger, so the trigger has to be the field: a caret-sized one gave a menu
 * clipped to a caret-sized strip.
 *
 * So the words are text, the field is the control, and taking one off is done
 * where the rest are chosen. Every element inside is a span, because a button
 * may not hold a div.
 *
 * One line, always. A field that wraps moves everything under it each time a
 * word is added, and two of them wrapping at different moments is what makes
 * a form feel loose. When the words outrun the line the row scrolls and says
 * so with a quiet ellipsis.
 */
export const ChipField = forwardRef<HTMLButtonElement, { items: string[]; placeholder?: ReactNode; label: string }>(
  function ChipField({ items, placeholder, label, ...rest }, ref) {
    const row = useRef<HTMLSpanElement>(null);
    const [more, setMore] = useState(false);

    const measure = useCallback(() => {
      const el = row.current;
      setMore(!!el && el.scrollWidth - el.clientWidth > 2);
    }, []);

    useEffect(() => {
      const el = row.current;
      if (!el) return;
      measure();
      const ro = new ResizeObserver(measure);
      ro.observe(el);
      for (const child of el.children) ro.observe(child);
      return () => ro.disconnect();
    }, [measure]);

    return (
      <button type="button" className="sc-chipfield" aria-label={label} ref={ref} {...rest}>
        <span className="sc-chipfield-row" ref={row}>
          {items.length === 0 && placeholder ? <span className="sc-chipfield-ph">{placeholder}</span> : null}
          {items.map((item) => (
            <span key={item} className="sc-chipfield-chip">
              {item}
            </span>
          ))}
        </span>
        {more && (
          <span className="sc-chipfield-more" aria-hidden>
            &#8230;
          </span>
        )}
        <CaretDown size={13} className="sc-chipfield-caret" aria-hidden />
      </button>
    );
  },
);
