import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'react-router';
import * as Dialog from '@radix-ui/react-dialog';
import { Check, ImageSquare, MagnifyingGlass, Plus, Star, Trash } from '@phosphor-icons/react';
import { PHONE, useMediaQuery } from '../useMediaQuery.js';
import { useCreateAsset } from '../create/AssetCreateHost.js';
import { favoriteScenes, toggleFavoriteScene } from '../favorites.js';
import { placePanel, type Placed } from './anchorPanel.js';
import { NOUN, PAGE, sectionsFor, type Candidate, type IngredientKind, type SectionId } from './ingredientOptions.js';

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

export type CloseReason = 'pick' | 'remove' | 'escape' | 'outside' | 'dismiss';

export interface PickerProps {
  kind: IngredientKind;
  /** The chip itself. Live DOM, because React does not own the line's children. */
  anchor: HTMLElement;
  /** What the chip holds, whether or not the catalog still has it. */
  currentId: string | null;
  candidates: Candidate[];
  brandId: string;
  /** "Suited to Beverage". Null omits the section. */
  categoryTitle: string | null;
  /** The chip's own warning, if the compiler flagged it. Shown above Remove. */
  warning: string | null;
  onPick: (c: Candidate) => void;
  onRemove: () => void;
  onClose: (reason: CloseReason) => void;
  /** For a scene warned that it builds around a product or a person. */
  onAttachRequest?: (tab: 'Products' | 'Presenters') => void;
  /** A product created from inside the picker goes straight into the chip. */
  onCreated?: (productId: string) => void;
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
function PickerBody({
  kind,
  currentId,
  candidates,
  brandId,
  categoryTitle,
  warning,
  onPick,
  onRemove,
  onClose,
  onAttachRequest,
  onCreated,
  autoFocusSearch,
}: PickerProps & { autoFocusSearch: boolean }) {
  const [query, setQuery] = useState('');
  const [shown, setShown] = useState<Partial<Record<SectionId, number>>>({});
  const [starred, setStarred] = useState<ReadonlySet<string>>(() =>
    kind === 'scene' ? new Set(favoriteScenes(brandId)) : new Set(),
  );
  const searchRef = useRef<HTMLInputElement>(null);
  const gridsRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const createAsset = useCreateAsset();

  // A new search is a new list, so what was drawn of the old one means nothing.
  // Item count alone must not reset it: the product library polls every four
  // seconds and a shrinking list would otherwise yank the page back to one.
  useEffect(() => {
    setShown({});
    setActive(0);
  }, [query]);

  const sections = useMemo(
    () => sectionsFor(kind, candidates, { currentId, query, starred, categoryTitle, shown }),
    [kind, candidates, currentId, query, starred, categoryTitle, shown],
  );

  /** The candidates on screen, in render order. */
  const flat = useMemo(() => sections.flatMap((s) => s.items), [sections]);

  /**
   * Where each focusable entry sits in the roving order.
   *
   * Includes the Add card, which is focusable but is not a candidate — so the
   * arrow keys walk everything the eye can see, while Enter in the search
   * field still picks the first real result.
   */
  const nav = useMemo(() => {
    const m = new Map<string, number>();
    let i = 0;
    for (const sec of sections) {
      for (const c of sec.items) m.set(`${sec.id}:${c.id}`, i++);
    }
    return m;
  }, [sections]);
  const navCount = nav.size;

  /**
   * What is on now, and the rest.
   *
   * The current pick is one item, and one item in a four-column grid is a card
   * with three empty columns beside it and a name clipped to fit a cell it did
   * not need to fit. It reads as a row: big enough thumbnail, the whole name,
   * and the tick at the end of it.
   */
  const current = sections.find((sec) => sec.id === 'current');
  const rest = sections.filter((sec) => sec.id !== 'current');
  const currentCard = current?.items[0];

  useLayoutEffect(() => {
    if (autoFocusSearch) searchRef.current?.focus({ preventScroll: true });
  }, [autoFocusSearch]);

  // Clamped rather than reset: a poll that drops one card should not throw the
  // keyboard back to the top of the list.
  useEffect(() => {
    setActive((a) => Math.max(0, Math.min(a, navCount - 1)));
  }, [navCount]);

  const focusCard = useCallback((i: number) => {
    const cards = gridsRef.current?.querySelectorAll<HTMLElement>('[data-nav]');
    const el = cards?.[i];
    if (!el) return;
    setActive(i);
    el.focus({ preventScroll: true });
    el.scrollIntoView({ block: 'nearest' });
  }, []);

  /** With `auto-fill` the column count is whatever fitted, so ask the layout. */
  const columns = useCallback((): number => {
    const grid = gridsRef.current?.querySelector<HTMLElement>('.sc-swap-grid');
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
    if (e.key === 'ArrowDown' && onSearch) {
      e.preventDefault();
      focusCard(0);
      return;
    }
    if (e.key === 'Enter' && onSearch) {
      e.preventDefault();
      // Type three letters, press Enter. The whole point of a search field
      // over a list you were going to arrow through anyway.
      if (flat[0]) onPick(flat[0]);
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
      else if (next >= 0 && next < navCount) focusCard(next);
      return;
    }
    if (e.key === 'Home') {
      e.preventDefault();
      focusCard(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      focusCard(navCount - 1);
    }
  };

  const star = (id: string) => setStarred(new Set(toggleFavoriteScene(brandId, id)));

  const noun = NOUN[kind];
  /**
   * Whether a card carries a second line.
   *
   * Only where the picture cannot tell two things apart. A scene's light and a
   * presenter's casting note are both real, but in a 92px cell they arrive as
   * "Hard freeze-flash ..." and "Cool minimal · whit..." — a line of truncated
   * text under every tile, in a grid whose entire job is to be looked at. Two
   * products, though, are routinely the same bottle in a different variant, so
   * there the brand is what separates them. Both still reach the full text on
   * hover, and the current pick shows it in the row, which has the width.
   */
  const showSub = kind === 'product';

  /* The wrapper routes keys for the panel's own focusable controls and is
     deliberately not a control itself. The point of it existing at all is that
     nothing here listens on window, the way the caret menu does. */
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

      <div className="sc-swap-body" ref={gridsRef}>
        {flat.length === 0 && !sections.some((sec) => sec.action) && (
          <p className="sc-swap-empty">{query.trim() ? `Nothing matches “${query.trim()}”.` : `No ${noun}s yet.`}</p>
        )}

        {currentCard && (
          <section className="sc-swap-sec sc-swap-cur" data-section="current" aria-label={current?.title}>
            <div className="sc-swap-lb">
              <span>{current?.title}</span>
            </div>
            <div role="listbox" aria-label={current?.title}>
              <div
                className="sc-swap-card sc-swap-currow"
                role="option"
                aria-selected
                data-on
                data-nav={nav.get(`current:${currentCard.id}`)}
                tabIndex={nav.get(`current:${currentCard.id}`) === active ? 0 : -1}
                title={currentCard.full}
                style={currentCard.tint ? ({ '--tint': currentCard.tint } as React.CSSProperties) : undefined}
                onFocus={() => setActive(nav.get(`current:${currentCard.id}`) ?? 0)}
                onClick={() => onPick(currentCard)}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter' && e.key !== ' ') return;
                  e.preventDefault();
                  onPick(currentCard);
                }}
              >
                <Thumb src={currentCard.thumb} tinted={!!currentCard.tint} />
                <span className="sc-swap-curtext">
                  <b dir="auto">{currentCard.label}</b>
                  {currentCard.sub && <span dir="auto">{currentCard.sub}</span>}
                </span>
                <span className="sc-swap-tick" aria-hidden>
                  <Check size={11} weight="bold" />
                </span>
              </div>
            </div>
          </section>
        )}

        {rest.map((sec) => (
          <section className="sc-swap-sec" key={sec.id} data-section={sec.id} aria-label={sec.title}>
            <div className="sc-swap-lb">
              <span>{sec.title}</span>
              {sec.action === 'add-product' && (
                <button
                  type="button"
                  className="sc-swap-lbact"
                  onClick={() =>
                    // The chip goes into a brief that is still in memory, so a
                    // URL round trip would remount the composer under it.
                    createAsset('product', {
                      onCreated: (made) => made.kind === 'product' && onCreated?.(made.id),
                    })
                  }
                >
                  <Plus size={11} weight="bold" />
                  Add
                </button>
              )}
            </div>
            {/* An empty shelf is its heading and nothing else: a grid with no
                cards in it is just a gap. */}
            {sec.items.length > 0 && (
              <div className="sc-swap-grid" role="listbox" aria-label={sec.title} aria-multiselectable="false">
                {sec.items.map((c) => {
                  const i = nav.get(`${sec.id}:${c.id}`) ?? -1;
                  const on = c.id === currentId;
                  const fav = starred.has(c.id);
                  return (
                    // A div, not a button: a scene card carries its own star, and
                    // a button inside a button is not a thing a browser can parse.
                    // `option` inside `listbox` is the right role for one-of-many
                    // anyway, and it takes its own focus and Enter/Space.
                    <div
                      key={`${sec.id}:${c.id}`}
                      className="sc-swap-card"
                      role="option"
                      aria-selected={on}
                      data-on={on || undefined}
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
                      {on && (
                        <span className="sc-swap-tick" aria-hidden>
                          <Check size={11} weight="bold" />
                        </span>
                      )}
                      {/* Only where nothing else says it. Under a "Suited to X"
                        heading the badge is the heading repeated on every card
                        in the section; in a flat result list it is the only
                        place the hint can live. */}
                      {c.recommended && !on && sec.id === 'results' && <span className="sc-swap-rec">Suited</span>}
                      <b dir="auto">{c.label}</b>
                      {showSub && c.sub && <span dir="auto">{c.sub}</span>}
                      {kind === 'scene' && (
                        <button
                          type="button"
                          className="sc-swap-star"
                          data-on={fav || undefined}
                          aria-pressed={fav}
                          aria-label={fav ? `Unstar ${c.label}` : `Star ${c.label}`}
                          tabIndex={-1}
                          onClick={(e) => {
                            // The card is the pick; a star inside it must not pick.
                            e.stopPropagation();
                            star(c.id);
                          }}
                        >
                          <Star size={12} weight={fav ? 'fill' : 'regular'} />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            {sec.remaining > 0 && (
              <>
                {/* Never a silent truncation: say what is not on screen, and
                    that the field above is how to reach it. */}
                <p className="sc-swap-capped">
                  Showing {sec.items.length} of {sec.total}. Search to narrow it down.
                </p>
                <button
                  type="button"
                  className="sc-amore"
                  onClick={() => setShown((s) => ({ ...s, [sec.id]: (s[sec.id] ?? PAGE) + PAGE }))}
                >
                  Show {Math.min(PAGE, sec.remaining)} more
                </button>
              </>
            )}
          </section>
        ))}
      </div>

      <div className="sc-swap-foot">
        {currentId && !flat.some((c) => c.id === currentId) && !query.trim() && (
          <p className="sc-swap-warn">This {noun} is no longer available.</p>
        )}
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
  const [pos, setPos] = useState<Placed | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  // The creation dialog is a real Radix Dialog stacked on top, portaled to the
  // body — a click inside it reads as "outside the picker" without this.
  const [params] = useSearchParams();
  const creating = params.get('new') !== null;

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
      if (creating) return;
      const t = e.target as HTMLElement;
      if (rootRef.current?.contains(t)) return;
      // Clicking the chip again is a toggle, and the chip's own handler owns
      // it — closing here too would close and immediately reopen.
      if (t.closest?.('.sc-token')) return;
      onClose('outside');
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [onClose, creating]);

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
      <PickerBody {...props} autoFocusSearch />
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
