import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import * as Dialog from '@radix-ui/react-dialog';
import { ArrowSquareOut, BookmarkSimple, Check, ImageSquare, MagnifyingGlass, Trash } from '@phosphor-icons/react';
import { PHONE, useMediaQuery } from '../useMediaQuery.js';

/** A thumb, not a mouse. Decides whether opening the panel takes the keyboard. */
const COARSE = '(pointer: coarse)';
import { bookmarkedScenes } from '../bookmarks.js';
import { presenterPath, productPath, scenePath } from '../routes.js';
import { placePanel, type Placed } from './anchorPanel.js';
import { NOUN, PAGE, pickList, type Candidate, type IngredientKind } from './ingredientOptions.js';

/**
 * Change the product, presenter or scene a chip already holds.
 *
 * The chip used to open TokenMenu — a 256px keyboard list built for inserting
 * a token at the caret. Reusing it to *replace* one asked the reader to
 * recognise a scene from a 15px circle, put a "40 of 576" cap line where the
 * answer should be, and told them to keep typing into a menu that in that mode
 * did not read what they typed. This is the other thing: a small visual
 * catalog, scoped to one kind, where the current pick is obvious and any other
 * one is a single click away.
 *
 * One model for all three kinds, because it is learned once. What differs is
 * only the content: a product is recognised by its packshot, a presenter by
 * their face, a scene by its light.
 */
export function IngredientPicker(props: PickerProps) {
  const phone = useMediaQuery(PHONE);
  return phone ? <PickerSheet {...props} /> : <PickerPanel {...props} />;
}

/**
 * Whether the search field should take focus the moment the panel opens.
 *
 * On a mouse, yes: typing is the fastest way into a long catalog and nothing
 * is covered by it. On a touch screen it summons the software keyboard over
 * the pictures you opened the thing to look at, so the field waits to be
 * tapped.
 */
function useAutoFocusSearch(): boolean {
  return !useMediaQuery(COARSE);
}

export type CloseReason = 'pick' | 'remove' | 'escape' | 'outside' | 'dismiss';

export interface PickerProps {
  kind: IngredientKind;
  /** The chip itself. Live DOM, because React does not own the line's children. */
  anchor: HTMLElement;
  /** What the chip holds, whether or not the catalog still has it. */
  currentId: string | null;
  candidates: Candidate[];
  brandId: string;
  /** For the link out to the asset's own page. */
  brandSlug: string;
  /** The chip's own warning, if the compiler flagged it. Shown above Remove. */
  warning: string | null;
  onPick: (c: Candidate) => void;
  onRemove: () => void;
  onClose: (reason: CloseReason) => void;
  /** For a scene warned that it builds around a product or a person. */
  onAttachRequest?: (tab: 'Products' | 'Presenters') => void;
}

/** The label on the button that empties the slot. */
const removeLabel = (kind: IngredientKind) => `Remove ${NOUN[kind]}`;

// ---------------------------------------------------------------- the body

/**
 * Everything inside either shell.
 *
 * Both shells give it a scroll box and a width; nothing else about it changes
 * between a desktop panel and a sheet under a thumb, which is the point — the
 * interaction is learned once and then it is the same everywhere.
 */
/** Where a thing of this kind lives, for the link off the current row. */
function assetPath(kind: IngredientKind, brandSlug: string, id: string): string {
  const b = { slug: brandSlug };
  if (kind === 'product') return productPath(b, id);
  if (kind === 'presenter') return presenterPath(b, id);
  return scenePath(b, id);
}

function PickerBody({
  kind,
  currentId,
  candidates,
  brandId,
  brandSlug,
  warning,
  onPick,
  onRemove,
  onClose,
  onAttachRequest,
  autoFocusSearch,
}: PickerProps & { autoFocusSearch: boolean }) {
  const [query, setQuery] = useState('');
  const [shown, setShown] = useState(PAGE);
  const searchRef = useRef<HTMLInputElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  // Read, never written. Bookmarking is something you do while browsing a
  // library; here it only decides what floats to the top, and marks the rows
  // it lifted so the order is not a mystery.
  const bookmarked = useMemo<ReadonlySet<string>>(
    () => (kind === 'scene' ? new Set(bookmarkedScenes(brandId)) : new Set()),
    [kind, brandId],
  );

  // A new search is a new list, so what was drawn of the old one means nothing.
  // Item count alone must not reset it: the product library polls every four
  // seconds and a shrinking list would otherwise yank the page back to one.
  useEffect(() => {
    setShown(PAGE);
    setActive(0);
  }, [query]);

  const list = useMemo(
    () => pickList(kind, candidates, { currentId, query, bookmarked, shown }),
    [kind, candidates, currentId, query, bookmarked, shown],
  );

  useLayoutEffect(() => {
    if (autoFocusSearch) searchRef.current?.focus({ preventScroll: true });
  }, [autoFocusSearch]);

  // Clamped rather than reset: a poll that drops one card should not throw the
  // keyboard back to the top of the list.
  useEffect(() => {
    setActive((a) => Math.max(0, Math.min(a, list.items.length - 1)));
  }, [list.items.length]);

  const focusCard = useCallback((i: number) => {
    const el = gridRef.current?.querySelectorAll<HTMLElement>('[data-nav]')[i];
    if (!el) return;
    setActive(i);
    el.focus({ preventScroll: true });
    el.scrollIntoView({ block: 'nearest' });
  }, []);

  /** With `auto-fill` the column count is whatever fitted, so ask the layout. */
  const columns = useCallback((): number => {
    const grid = gridRef.current;
    if (!grid) return 1;
    return Math.max(1, getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length);
  }, []);

  /**
   * Bound to the panel, never to `window`.
   *
   * TokenMenu listens on window with capture, which is exactly how a letter
   * typed at a chip menu ended up inserted into the brief behind it. Nothing
   * here can reach the line, because nothing here is listening to it.
   */
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      // The detail overlay closes on Escape too, and the picker is opened from
      // a composer that lives inside it.
      e.stopPropagation();
      onClose('escape');
      return;
    }
    const onSearch = e.target === searchRef.current;
    if (onSearch && e.key === 'ArrowDown') {
      e.preventDefault();
      focusCard(0);
      return;
    }
    if (onSearch && e.key === 'Enter') {
      e.preventDefault();
      // Type three letters, press Enter. The whole point of a search field
      // over a list you were going to arrow through anyway.
      if (list.items[0]) onPick(list.items[0]);
      return;
    }
    if (onSearch) return; // arrows and Home/End belong to the text while it has focus

    const cols = columns();
    const step =
      e.key === 'ArrowRight'
        ? 1
        : e.key === 'ArrowLeft'
          ? -1
          : e.key === 'ArrowDown'
            ? cols
            : e.key === 'ArrowUp'
              ? -cols
              : 0;
    if (step) {
      e.preventDefault();
      const next = active + step;
      // Up from the top row goes back to the search field rather than nowhere.
      if (next < 0 && step === -cols) searchRef.current?.focus();
      else if (next >= 0 && next < list.items.length) focusCard(next);
      return;
    }
    if (e.key === 'Home') {
      e.preventDefault();
      focusCard(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      focusCard(list.items.length - 1);
    }
  };

  const noun = NOUN[kind];
  /**
   * Whether a card carries a second line.
   *
   * Only where the picture cannot tell two things apart. A scene's light and a
   * presenter's casting note both truncate to nothing at this size. Two
   * products, though, are routinely the same bottle from a different house, so
   * there the brand is what separates them — and with one list rather than two
   * shelves it is also what says whose product it is.
   */
  const showSub = kind === 'product';

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: a key router, not a control
    <div className="sc-swap-inner" onKeyDown={onKeyDown}>
      <div className="sc-swap-head">
        <span className="sc-swap-search">
          <MagnifyingGlass size={13} />
          <input
            ref={searchRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${noun}s`}
            aria-label={`Search ${noun}s`}
            autoComplete="off"
            spellCheck={false}
          />
        </span>
      </div>

      {/* What is on, above the line, wherever the search happens to be. It is
          the answer to "what do I have", so it does not come and go.

          Not a control. It was a button that closed the panel, then a link that
          took you out of the app, and both were the same mistake: a row this
          size invites a click, and there is no single obvious thing that click
          should do. Swapping is the grid, removing is the button that says
          "Remove", and neither of those wants a second unlabelled door. What is
          left is "let me look at it properly", which is real but secondary — so
          it is one small marked button at the end of the row, and the row
          itself does nothing at all. */}
      {list.current && (
        <div className="sc-swap-cur" title={list.current.full}>
          <Thumb src={list.current.thumb} tinted={!!list.current.tint} />
          <span className="sc-swap-curtext">
            <b dir="auto">{list.current.label}</b>
            {list.current.sub && <span dir="auto">{list.current.sub}</span>}
          </span>
          <a
            className="sc-swap-open"
            href={assetPath(kind, brandSlug, list.current.id)}
            target="_blank"
            rel="noreferrer"
            title={`Open this ${noun} in a new tab`}
            aria-label={`Open ${list.current.label} in a new tab`}
          >
            <ArrowSquareOut size={14} />
          </a>
          <span className="sc-swap-tick" aria-hidden>
            <Check size={11} weight="bold" />
          </span>
        </div>
      )}

      <div className="sc-swap-body">
        {list.items.length === 0 && (
          <p className="sc-swap-empty">{query.trim() ? `Nothing matches “${query.trim()}”.` : `No other ${noun}s.`}</p>
        )}

        <div className="sc-swap-grid" ref={gridRef} role="listbox" aria-label={`Choose a ${noun}`}>
          {list.items.map((c, i) => (
            // A div, not a button: `option` inside `listbox` is the right role
            // for one-of-many, and it takes its own focus and Enter/Space.
            <div
              key={c.id}
              className="sc-swap-card"
              role="option"
              aria-selected={false}
              data-nav={i}
              tabIndex={i === active ? 0 : -1}
              title={c.full}
              style={c.tint ? ({ '--tint': c.tint } as React.CSSProperties) : undefined}
              onFocus={() => setActive(i)}
              onClick={() => onPick(c)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter' && e.key !== ' ') return;
                e.preventDefault();
                onPick(c);
              }}
            >
              <Thumb src={c.thumb} tinted={!!c.tint} />
              <b dir="auto">
                {c.bookmarked && (
                  <>
                    <BookmarkSimple className="sc-bm-mark" size={10} weight="fill" aria-hidden />
                    <span className="sc-vh">Bookmarked. </span>
                  </>
                )}
                {c.label}
              </b>
              {showSub && c.sub && <span dir="auto">{c.sub}</span>}
            </div>
          ))}
        </div>

        {list.remaining > 0 && (
          <button type="button" className="sc-swap-more" onClick={() => setShown((n) => n + PAGE)}>
            {/* Never a silent truncation: say what is not on screen, and that
                the field above is how to reach it. */}
            Show {Math.min(PAGE, list.remaining)} more of {list.total}
          </button>
        )}
      </div>

      <div className="sc-swap-foot">
        {currentId && !list.current && <p className="sc-swap-warn">This {noun} is no longer available.</p>}
        {warning && <p className="sc-swap-warn">{warning}</p>}
        {warning && onAttachRequest && kind === 'scene' && (
          <div className="sc-swap-attach">
            {/* The one warning a click can genuinely fix is on a scene that
                builds around something the brief has not got. It used to
                hijack the chip's own click; now it is an action that says so. */}
            {warning.includes('product') && (
              <button type="button" className="sc-btn" onClick={() => onAttachRequest('Products')}>
                Attach a product
              </button>
            )}
            {warning.includes('person') && (
              <button type="button" className="sc-btn" onClick={() => onAttachRequest('Presenters')}>
                Attach a presenter
              </button>
            )}
          </div>
        )}
        <button type="button" className="sc-swap-remove" onClick={onRemove}>
          <Trash size={13} />
          {removeLabel(kind)}
        </button>
      </div>
    </div>
  );
}

/** A catalog import whose image never downloaded has a product but no picture. */
function Thumb({ src, tinted }: { src?: string | null; tinted: boolean }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [src]);
  if (!src || broken) {
    return (
      <span className="sc-swap-thumb sc-swap-thumb-empty">
        <ImageSquare size={18} />
      </span>
    );
  }
  return (
    <img
      className="sc-swap-thumb"
      data-tinted={tinted || undefined}
      src={src}
      alt=""
      loading="lazy"
      onError={() => setBroken(true)}
    />
  );
}

// ---------------------------------------------------------------- desktop

/**
 * Anchored to the chip, portaled to the body.
 *
 * Not a Radix Popover: there is no React element to anchor to (the chip is a
 * DOM node the line owns), Popover would trap focus and hand it back to a
 * trigger that does not exist, and the caret contract needs a close that
 * restores a character offset rather than focusing an element.
 */
function PickerPanel(props: PickerProps) {
  const { anchor, kind, onClose } = props;
  const autoFocus = useAutoFocusSearch();
  const [pos, setPos] = useState<Placed | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const measure = () => {
      const vv = window.visualViewport;
      // The clamp has to use the *visual* viewport or a software keyboard puts
      // the panel under itself; the rect and `position: fixed` are both in
      // layout coordinates, so those two need no translation.
      const p = placePanel(anchor.getBoundingClientRect(), {
        width: vv?.width ?? window.innerWidth,
        height: vv?.height ?? window.innerHeight,
      });
      // The brief is its own 30vh scroller, so a chip can leave the screen
      // while its panel is open. A panel pointing at nothing should go.
      if (!p) {
        onClose('outside');
        return;
      }
      setPos(p);
    };
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    window.visualViewport?.addEventListener('resize', measure);
    window.visualViewport?.addEventListener('scroll', measure);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
      window.visualViewport?.removeEventListener('resize', measure);
      window.visualViewport?.removeEventListener('scroll', measure);
    };
  }, [anchor, onClose]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (rootRef.current?.contains(t)) return;
      // Clicking the chip again is a toggle, and the chip's own handler owns
      // it — closing here too would close and immediately reopen.
      if (t.closest?.('.sc-token')) return;
      onClose('outside');
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [onClose]);

  if (!pos) return null;
  return createPortal(
    <div
      ref={rootRef}
      className="sc-swap"
      data-kind={kind}
      data-side={pos.side}
      role="dialog"
      aria-label={`Change ${NOUN[kind]}`}
      style={{ left: pos.left, top: pos.top, width: pos.width, maxHeight: pos.maxHeight }}
    >
      <PickerBody {...props} autoFocusSearch={autoFocus} />
    </div>,
    document.body,
  );
}

// ---------------------------------------------------------------- phone

/**
 * A sheet under the thumb, on the shell the shot settings already established.
 *
 * It borrows `.sc-shotsheet` wholesale rather than growing a second sheet, so
 * the drag, both animations, the reduced-motion rule and the scrollbar gutter
 * are the ones already written and already tested.
 */
function PickerSheet(props: PickerProps) {
  const { kind, onClose } = props;
  const sheet = useRef<HTMLDivElement>(null);
  const from = useRef<{ y: number; t: number } | null>(null);
  const moved = useRef(0);

  const grab = (e: React.PointerEvent<HTMLElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    from.current = { y: e.clientY, t: e.timeStamp };
    moved.current = 0;
    if (sheet.current) sheet.current.style.transition = 'none';
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const drag = (e: React.PointerEvent<HTMLElement>) => {
    if (!from.current || !sheet.current) return;
    moved.current = Math.max(0, e.clientY - from.current.y);
    sheet.current.style.transform = `translateY(${moved.current}px)`;
  };
  const release = (e: React.PointerEvent<HTMLElement>) => {
    const start = from.current;
    from.current = null;
    if (!start || !sheet.current) return;
    sheet.current.style.transition = '';
    const speed = moved.current / Math.max(1, e.timeStamp - start.t);
    if (moved.current > 96 || speed > 0.45) {
      onClose('dismiss');
      return;
    }
    sheet.current.style.transform = '';
  };

  return (
    <Dialog.Root open onOpenChange={(o) => !o && onClose('dismiss')}>
      <Dialog.Portal>
        <Dialog.Overlay className="sc-shotsheet-scrim" />
        <Dialog.Content
          ref={sheet}
          className="sc-shotsheet sc-swapsheet"
          data-kind={kind}
          aria-describedby={undefined}
          // Radix focuses the first tabbable thing it finds, which is the
          // search field, which raises the keyboard over the grid the sheet
          // exists to show. Focus the sheet itself instead: the trap and
          // Escape still work, and the field waits to be tapped.
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            sheet.current?.focus({ preventScroll: true });
          }}
          // Radix would hand focus back to the chip, and the chip is inside a
          // contenteditable — the software keyboard would come straight up.
          onCloseAutoFocus={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => {
            e.preventDefault();
            onClose('escape');
          }}
        >
          <div
            className="sc-shotsheet-grip"
            onPointerDown={grab}
            onPointerMove={drag}
            onPointerUp={release}
            onPointerCancel={release}
          >
            <span className="sc-shotsheet-bar" aria-hidden />
            <Dialog.Title className="sc-vh">Change {NOUN[kind]}</Dialog.Title>
          </div>
          {/* No autofocus: focusing the field is what raises the keyboard, and
              a sheet that opens with half of itself covered is worse than one
              you tap the field in when you actually want to search. */}
          <PickerBody {...props} autoFocusSearch={false} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
