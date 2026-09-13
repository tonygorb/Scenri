import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { PHONE, useMediaQuery } from '../useMediaQuery.js';
import {
  caretFromLine,
  caretOnLine,
  emptyInsertCopy,
  INSERT_MENU_ID,
  insertLabel,
  neededInsertHeight,
  pickInsertCaret,
  placeOnScroll,
  sameInsertPos,
  scrollChildIntoNearest,
  shouldAskMore,
  splitMatch,
  type CaretOnLine,
} from './insertMenu.js';
import type { InsertSigil } from './ingredientOptions.js';
import { caretRect, keepCaret } from './line.js';
import { caretReliable, INSERT_MENU_MAX_H, placeInsertMenu, type InsertPlaced } from './placeInsertMenu.js';

export interface MenuOption {
  key: string;
  group: string;
  label: string;
  hint?: string;
  search?: string;
  thumb?: string;
  /** Pull the framing to the top of the picture — a card standing in for an avatar. */
  crop?: 'top';
  swatch?: string;
  run: () => void;
}

type Anchor = { getBoundingClientRect(): DOMRect } | null;

/**
 * Caret insert menu for `$` `/` `@` `#`.
 *
 * Caret shortlist: typing in the brief after the sigil is the filter.
 * Phone docks to the composer; desktop follows the caret. Appending a
 * page never re-anchors the box.
 */
export function TokenMenu({
  anchor,
  composer,
  line,
  query,
  options,
  remaining = 0,
  total = 0,
  sigil,
  onMore,
  onActiveId,
  onClose,
}: {
  anchor: Anchor;
  composer: Anchor;
  line?: Anchor;
  query: string;
  options: MenuOption[];
  remaining?: number;
  total?: number;
  sigil?: InsertSigil;
  onMore?: () => void;
  onActiveId?: (id: string | null) => void;
  onClose: () => void;
}) {
  const phone = useMediaQuery(PHONE);
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState<InsertPlaced | null>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const snapRef = useRef<CaretOnLine | null>(null);
  const contentKey = `${sigil ?? ''}\0${query}`;
  const fitRef = useRef<{ sigil?: string; height?: number }>({});
  const onMoreRef = useRef(onMore);
  onMoreRef.current = onMore;
  const remainingRef = useRef(remaining);
  remainingRef.current = remaining;
  const askedAtRef = useRef(0);
  const askMore = useCallback(() => {
    if (!shouldAskMore(askedAtRef.current, options.length, remainingRef.current)) return;
    askedAtRef.current = options.length;
    onMoreRef.current?.();
  }, [options.length]);

  useEffect(() => {
    setActive(0);
    askedAtRef.current = 0;
  }, [query]);

  useEffect(() => {
    setActive((a) => Math.min(a, Math.max(0, options.length - 1)));
  }, [options.length]);

  useEffect(() => {
    snapRef.current = null;
    fitRef.current = {};
  }, [sigil]);

  const placeWith = useCallback(
    (height?: number): InsertPlaced | null => {
      const card = composer?.getBoundingClientRect();
      if (!card) return null;
      const lineRect = line?.getBoundingClientRect() ?? card;
      const vv = window.visualViewport;
      const vp = { width: vv?.width ?? window.innerWidth, height: vv?.height ?? window.innerHeight };
      const held = !!shellRef.current?.contains(document.activeElement);
      const live = held ? null : caretRect();
      const liveOk = live && caretReliable(live, vp) ? live : null;
      if (liveOk) snapRef.current = caretOnLine(liveOk, lineRect);
      const snapped = snapRef.current ? caretFromLine(lineRect, snapRef.current) : null;
      const caret =
        pickInsertCaret(liveOk, snapped, held) ?? (held ? null : (anchor?.getBoundingClientRect() ?? null));
      return placeInsertMenu(caret, card, vp, { phone, line: lineRect, height });
    },
    [anchor, composer, line, phone],
  );

  useLayoutEffect(() => {
    if (fitRef.current.sigil !== sigil) fitRef.current = { sigil };
    const place = () => {
      // A pageable list uses the reservation. A hugged miss height left in
      // fitRef is why clearing the search left a sliver that would not grow.
      const height = remainingRef.current > 0 ? undefined : fitRef.current.height;
      const next = placeWith(height);
      setPos((cur) => (sameInsertPos(cur, next) ? cur : next));
    };
    const onScroll = (e: Event) => {
      if (!placeOnScroll(e.target, shellRef.current)) return;
      place();
    };
    place();
    const later = requestAnimationFrame(place);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', onScroll, true);
    window.visualViewport?.addEventListener('resize', place);
    window.visualViewport?.addEventListener('scroll', place);
    return () => {
      cancelAnimationFrame(later);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', onScroll, true);
      window.visualViewport?.removeEventListener('resize', place);
      window.visualViewport?.removeEventListener('scroll', place);
    };
  }, [anchor, composer, line, phone, sigil, placeWith]);

  // Pin the painted box to the caret. A miss or a short filter hugs; a
  // pageable list takes the reservation back, so clearing the search grows.
  useLayoutEffect(() => {
    if (!pos || !shellRef.current) return;
    if (remaining > 0) {
      if (fitRef.current.height == null && fitRef.current.sigil === (sigil ?? '')) return;
      fitRef.current = { sigil: sigil ?? '' };
      const next = placeWith();
      if (next && !sameInsertPos(pos, next)) setPos(next);
      return;
    }
    const shell = shellRef.current;
    const list = listRef.current;
    const chrome = list ? shell.offsetHeight - list.clientHeight : shell.offsetHeight;
    const h = neededInsertHeight(chrome, list?.scrollHeight ?? 0, INSERT_MENU_MAX_H);
    if (!(h > 0)) return;
    if (fitRef.current.height === h && fitRef.current.sigil === (sigil ?? '')) return;
    fitRef.current = { sigil: sigil ?? '', height: h };
    const next = placeWith(h);
    if (!next || sameInsertPos(pos, next)) return;
    setPos(next);
  }, [pos, contentKey, placeWith, remaining, options.length, sigil]);

  // Layout, not passive: the menu is on screen the moment it paints, and the
  // keystroke that opened it is often followed straight away by Enter. A
  // passive effect attaches after paint, so on a slow machine there is a frame
  // where the list is visible and the keys it advertises do nothing.
  useLayoutEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (active >= options.length - 1) askMore();
        else setActive((a) => a + 1);
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
  }, [options, active, onClose, askMore]);

  useEffect(() => {
    const root = listRef.current;
    const row = root?.querySelector<HTMLElement>('[data-active="true"]');
    if (root && row) scrollChildIntoNearest(root, row);
  }, [active]);

  // Next page as the sentinel reaches the fold. First paint is ignored
  // (scrollTop is 0) so the shortlist does not auto-fill and jump.
  useEffect(() => {
    const el = sentinelRef.current;
    const root = listRef.current;
    if (!el || !root) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (root.scrollTop <= 0) return;
        if (entries.some((e) => e.isIntersecting)) askMore();
      },
      { root, rootMargin: '0px 0px 8px 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
    // `pos` is the portal: the sentinel is not in the document until placed.
    // Query resets the list; remaining/length stay out so a page does not
    // reconnect the observer and fire again on the same fold.
  }, [pos, contentKey, askMore]);

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

  const listId = `${INSERT_MENU_ID}-list`;
  const noun = insertLabel(sigil);

  return createPortal(
    <div
      className="sc-cmd"
      id={INSERT_MENU_ID}
      data-shell={pos.shell}
      style={{
        left: pos.left,
        top: pos.top,
        width: pos.width,
        maxHeight: pos.maxHeight,
        // Pageable lists occupy the reservation so a short first paint cannot
        // hang where a 320px box was placed. A miss or a filter hugs instead.
        height: pos.side === 'above' && remaining > 0 ? pos.maxHeight : undefined,
      }}
      ref={shellRef}
    >
      <div className="sc-cmd-list" ref={listRef} role="listbox" aria-label={noun} id={listId}>
        {!options.length ? (
          <>
            <GroupTitle name={noun} total={total} />
            <div className="sc-cmd-empty">{emptyInsertCopy(sigil)}</div>
          </>
        ) : (
          options.map((o, i) => {
            const showGroup = i === 0 || o.group !== options[i - 1]?.group;
            return (
              <div key={o.key}>
                {showGroup && <GroupTitle name={o.group} total={total} />}
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
                    <img src={o.thumb} alt="" data-crop={o.crop} />
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
        {remaining > 0 && options.length > 0 && (
          <>
            <p className="sc-cmd-count" aria-live="polite">
              {options.length} of {total}
            </p>
            <div ref={sentinelRef} className="sc-cmd-sentinel" aria-hidden />
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}

function GroupTitle({ name, total }: { name: string; total: number }) {
  return (
    <div className="sc-cmd-group">
      {name} <span className="sc-cmd-n">{total}</span>
    </div>
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
