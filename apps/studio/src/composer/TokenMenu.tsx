import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { PHONE, useMediaQuery } from '../useMediaQuery.js';
import { emptyInsertCopy, INSERT_MENU_ID, insertLabel, splitMatch } from './insertMenu.js';
import type { InsertSigil } from './ingredientOptions.js';
import { caretRect, keepCaret } from './line.js';
import { placeInsertMenu, type InsertPlaced } from './placeInsertMenu.js';

export interface MenuOption {
  key: string;
  group: string;
  label: string;
  hint?: string;
  search?: string;
  thumb?: string;
  swatch?: string;
  run: () => void;
}

type Anchor = { getBoundingClientRect(): DOMRect } | null;

/**
 * Caret insert menu for `/` `@` `#`.
 *
 * Presentational: the caller already ranked and filtered. Keyboard first,
 * composer stays focused. Phone docks to the composer; desktop follows the
 * caret when that rect is honest.
 */
export function TokenMenu({
  anchor,
  composer,
  line,
  query,
  options,
  sigil,
  onActiveId,
  onClose,
}: {
  anchor: Anchor;
  composer: Anchor;
  line?: Anchor;
  query: string;
  options: MenuOption[];
  sigil?: InsertSigil;
  onActiveId?: (id: string | null) => void;
  onClose: () => void;
}) {
  const phone = useMediaQuery(PHONE);
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState<InsertPlaced | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const contentKey = `${query}\0${options.length}`;
  const fitRef = useRef<{ key: string; height?: number }>({ key: '' });

  useEffect(() => {
    setActive(0);
  }, [query]);

  useEffect(() => {
    setActive((a) => Math.min(a, Math.max(0, options.length - 1)));
  }, [options.length]);

  const placeWith = useCallback(
    (height?: number): InsertPlaced | null => {
      const live = caretRect();
      const caret = live ?? anchor?.getBoundingClientRect() ?? null;
      const card = composer?.getBoundingClientRect();
      if (!card) return null;
      const lineRect = line?.getBoundingClientRect() ?? null;
      const vv = window.visualViewport;
      return placeInsertMenu(
        caret,
        card,
        { width: vv?.width ?? window.innerWidth, height: vv?.height ?? window.innerHeight },
        { phone, line: lineRect, height },
      );
    },
    [anchor, composer, line, phone],
  );

  useLayoutEffect(() => {
    if (fitRef.current.key !== contentKey) fitRef.current = { key: contentKey };
    const place = () => setPos(placeWith(fitRef.current.height));
    place();
    const later = requestAnimationFrame(place);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    window.visualViewport?.addEventListener('resize', place);
    window.visualViewport?.addEventListener('scroll', place);
    return () => {
      cancelAnimationFrame(later);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      window.visualViewport?.removeEventListener('resize', place);
      window.visualViewport?.removeEventListener('scroll', place);
    };
  }, [anchor, composer, line, phone, contentKey, placeWith]);

  // First pass reserves the tallest box so a growing list cannot run off the
  // top. A miss paints ~80px; without this second pass it sits at the top of
  // that 320px reservation, floating mid-canvas.
  useLayoutEffect(() => {
    if (pos?.side !== 'above' || !listRef.current) return;
    const h = listRef.current.offsetHeight;
    if (!(h > 0 && h < pos.maxHeight)) return;
    fitRef.current = { key: contentKey, height: h };
    const next = placeWith(h);
    if (!next || (next.top === pos.top && next.maxHeight === pos.maxHeight)) return;
    setPos(next);
  }, [pos, contentKey, placeWith]);

  // Layout, not passive: the menu is on screen the moment it paints, and the
  // keystroke that opened it is often followed straight away by Enter. A
  // passive effect attaches after paint, so on a slow machine there is a frame
  // where the list is visible and the keys it advertises do nothing.
  useLayoutEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActive((a) => Math.min(options.length - 1, a + 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActive((a) => Math.max(0, a - 1));
      } else if ((e.key === 'Enter' || e.key === 'Tab') && options[active]) {
        e.preventDefault();
        options[active].run();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [options, active, onClose]);

  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const activeId = options[active] ? `${INSERT_MENU_ID}-opt-${active}` : null;
  useEffect(() => {
    onActiveId?.(activeId);
    return () => onActiveId?.(null);
  }, [activeId, onActiveId]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest('.sc-cmd')) return;
      // The next keystroke is still in the brief: a dismiss must not steal the caret.
      keepCaret(e);
      onClose();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [onClose]);

  if (!pos) return null;

  return createPortal(
    <div
      className="sc-cmd"
      id={INSERT_MENU_ID}
      data-shell={pos.shell}
      style={{ left: pos.left, top: pos.top, width: pos.width, maxHeight: pos.maxHeight }}
      ref={listRef}
      role="listbox"
      aria-label={insertLabel(sigil)}
    >
      {!options.length ? (
        <>
          <div className="sc-cmd-group">{insertLabel(sigil)}</div>
          <div className="sc-cmd-empty">{emptyInsertCopy(sigil)}</div>
        </>
      ) : (
        options.map((o, i) => {
          const showGroup = i === 0 || o.group !== options[i - 1]?.group;
          return (
            <div key={o.key}>
              {showGroup && <div className="sc-cmd-group">{o.group}</div>}
              <button
                type="button"
                id={`${INSERT_MENU_ID}-opt-${i}`}
                className="sc-cmd-row"
                role="option"
                aria-selected={i === active}
                data-active={i === active}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => keepCaret(e)}
                onClick={() => o.run()}
              >
                {o.thumb ? (
                  <img src={o.thumb} alt="" />
                ) : o.swatch ? (
                  <span className="sc-cmd-swatch" style={{ background: o.swatch }} />
                ) : null}
                <MatchLabel text={o.label} query={query} />
                {o.hint && <span className="sc-cmd-hint">{o.hint}</span>}
              </button>
            </div>
          );
        })
      )}
    </div>,
    document.body,
  );
}

function MatchLabel({ text, query }: { text: string; query: string }) {
  return (
    <span className="sc-cmd-label">
      {splitMatch(text, query).map((p) =>
        p.hit ? <b key={`h:${p.text}`}>{p.text}</b> : <span key={`t:${p.text}`}>{p.text}</span>,
      )}
    </span>
  );
}
