import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check } from '@phosphor-icons/react';
import { keepCaret } from './line.js';

/** Rows a caret menu will draw. Past this, typing is faster than scrolling. */
const MENU_CAP = 40;

export interface MenuOption {
  key: string;
  group: string;
  label: string;
  hint?: string;
  thumb?: string;
  swatch?: string;
  /** What choosing this row does. One menu, several kinds of outcome. */
  run: () => void;
}

/**
 * Command menu anchored to the caret. Keyboard first: arrows move, Enter
 * inserts, Escape closes, typing filters. Rendered in a portal and positioned
 * from a measured rect so it can never drift away from the input.
 */
/** Anything that can report a rect: a chip, or a virtual caret position. */
type Anchor = { getBoundingClientRect(): DOMRect } | null;

export function TokenMenu({
  anchor,
  query,
  options,
  selectedKey,
  onClose,
}: {
  anchor: Anchor;
  query: string;
  options: MenuOption[];
  /** Marks the row a chip currently holds, when the menu was opened from one. */
  selectedKey?: string;
  onClose: () => void;
}) {
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState<{ left: number; bottom: number } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  /**
   * Matches, capped.
   *
   * A caret menu is a shortlist you arrow through, not a catalog: with several
   * hundred products imported, an unfiltered `@` drew every one of them into a
   * portal above the brief and the keyboard walk became useless. Typing is the
   * way through a list this size, and the cap is what makes typing the obvious
   * move rather than scrolling.
   */
  const all = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => `${o.label} ${o.group} ${o.hint ?? ''}`.toLowerCase().includes(q));
  }, [options, query]);
  const filtered = useMemo(() => all.slice(0, MENU_CAP), [all]);

  useEffect(() => {
    const i = selectedKey ? filtered.findIndex((o) => o.key === selectedKey) : -1;
    setActive(i >= 0 ? i : 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, selectedKey]);

  useLayoutEffect(() => {
    if (!anchor) return;
    const place = () => {
      const r = anchor.getBoundingClientRect();
      setPos({ left: Math.min(r.left, window.innerWidth - 268), bottom: window.innerHeight - r.top + 8 });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [anchor]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActive((a) => Math.min(filtered.length - 1, a + 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActive((a) => Math.max(0, a - 1));
      } else if (e.key === 'Enter' && filtered[active]) {
        e.preventDefault();
        filtered[active].run();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'Tab') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [filtered, active, onClose]);

  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('.sc-cmd')) onClose();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [onClose]);

  if (!pos) return null;
  if (!filtered.length) {
    return createPortal(
      <div className="sc-cmd" style={{ left: pos.left, bottom: pos.bottom }}>
        <div className="sc-cmd-empty">Nothing matches “{query}”</div>
      </div>,
      document.body,
    );
  }

  let lastGroup = '';
  return createPortal(
    <div
      className="sc-cmd"
      style={{ left: pos.left, bottom: pos.bottom }}
      ref={listRef}
      role="listbox"
      onMouseDownCapture={keepCaret}
    >
      {all.length > filtered.length && (
        <div className="sc-cmd-capped">
          {filtered.length} of {all.length}. Keep typing to narrow.
        </div>
      )}
      {filtered.map((o, i) => {
        // first row of each group carries the group heading
        const head = o.group === lastGroup ? null : o.group;
        lastGroup = o.group;
        return (
          <div key={o.key}>
            {head && <div className="sc-cmd-group">{head}</div>}
            <button
              type="button"
              className="sc-cmd-row"
              role="option"
              aria-selected={i === active}
              data-active={i === active}
              data-selected={o.key === selectedKey || undefined}
              onMouseEnter={() => setActive(i)}
              onMouseDown={() => o.run()}
            >
              {o.thumb ? (
                <img src={o.thumb} alt="" />
              ) : o.swatch ? (
                <span className="sc-cmd-swatch" style={{ background: o.swatch }} />
              ) : (
                <span className="sc-cmd-swatch sc-cmd-swatch-empty" />
              )}
              <span className="sc-cmd-label">{o.label}</span>
              {o.key === selectedKey ? (
                <Check className="sc-cmd-check" size={12} weight="bold" />
              ) : (
                o.hint && <span className="sc-cmd-hint">{o.hint}</span>
              )}
            </button>
          </div>
        );
      })}
      <div className="sc-cmd-foot">
        <kbd>↑↓</kbd> move <kbd>↵</kbd> insert <kbd>esc</kbd> close
      </div>
    </div>,
    document.body,
  );
}
