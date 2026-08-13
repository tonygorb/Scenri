import { useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { MagnifyingGlass, X } from '@phosphor-icons/react';

/**
 * Search, as one 34px target that opens into a field.
 *
 * The catalog pages are for looking at pictures, and a resting input is the
 * loudest object above the grid — so at rest this is a button the same height
 * and shape as the controls beside it, and the field is something you ask for.
 *
 * The field is absolutely positioned over the facet rail rather than pushed
 * into the row. That is the whole trick: the wrapper is always exactly 34px,
 * so opening, typing, clearing and closing move nothing — not the rail, not
 * the toolbar's height, not the grid. It grows out of the button's own right
 * edge, because that is where the button is.
 *
 * It closes itself only when it is empty. A field holding a query stays open,
 * because collapsing it would hide the reason the grid is filtered.
 */
export function LibrarySearch({
  value,
  onChange,
  noun,
  total,
}: {
  value: string;
  onChange: (next: string) => void;
  /** Plural noun for the accessible label and placeholder, e.g. "scenes". */
  noun: string;
  /** Catalog size, shown in the placeholder. */
  total: number;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(value.trim().length > 0);

  /**
   * Mount-and-focus inside the same task as the tap that asked for it — iOS
   * only raises the keyboard for a focus it can attribute to a gesture, and a
   * focus queued behind a normal React render has already lost that claim.
   */
  const openSearch = useCallback(() => {
    flushSync(() => setOpen(true));
    input.current?.focus();
  }, []);

  // A query that arrived from anywhere else — a shared link, a Clear elsewhere
  // on the page — decides the state too.
  useEffect(() => {
    if (value.trim().length > 0) setOpen(true);
  }, [value]);

  // Slash is the one shortcut. Never while the caret is already in a field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t?.isContentEditable || (t && /^(input|textarea|select)$/i.test(t.tagName))) return;
      e.preventDefault();
      openSearch();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [openSearch]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    // First Escape empties the field, second one gives the row back.
    if (value) onChange('');
    else {
      setOpen(false);
      input.current?.blur();
    }
  };

  return (
    <div className="sc-libsearch" data-open={open ? '' : undefined}>
      <button
        type="button"
        className="sc-libsearch-toggle"
        aria-label={`Search ${noun}`}
        aria-expanded={open}
        tabIndex={open ? -1 : 0}
        onClick={openSearch}
      >
        <MagnifyingGlass size={16} />
      </button>

      <div className="sc-libsearch-field">
        <MagnifyingGlass size={15} aria-hidden />
        <input
          ref={input}
          type="search"
          value={value}
          placeholder={`Search ${total} ${noun}`}
          aria-label={`Search ${noun}`}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          tabIndex={open ? 0 : -1}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={() => {
            if (!value.trim()) setOpen(false);
          }}
        />
        {/* Always rendered, only ever faded: pulling it out of the layout when
            the field empties would shuffle the caret sideways mid-edit. */}
        <button
          type="button"
          className="sc-libsearch-clear"
          aria-label="Clear search"
          hidden={!value}
          tabIndex={value ? 0 : -1}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            onChange('');
            input.current?.focus();
          }}
        >
          <X size={12} weight="bold" />
        </button>
      </div>
    </div>
  );
}
