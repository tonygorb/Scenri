import { forwardRef, useCallback, useEffect, useId, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { productLabel, sceneLabel } from '../displayName.js';
import { assetUrl, imgUrl, type Brand, type Scene, type Presenter, type DemoProduct, type TreeNode } from '../api.js';
import { useBrand } from '../app/BrandLayout.js';
import { attachableMarks, markLabel } from '../brand/marks.js';
import { characterAvatar, presenterAvatar } from '../presenterVisual.js';
import { bookmarkedScenes } from '../bookmarks.js';
import { flattenPalette, normalizeHex } from '../brand/palette.js';
import { attachChipDrag } from './chipDrag.js';
import { ChipMoveSheet } from './ChipMoveSheet.js';
import { ChipPreview, isPreviewKind, type PreviewKind } from './ChipPreview.js';
import { useHoverPreview } from './useHoverPreview.js';
import { TokenMenu, type MenuOption } from './TokenMenu.js';
import { IngredientPicker, type CloseReason } from './IngredientPicker.js';
import { ColorChipMenu } from './ColorChipMenu.js';
import { composingEvent, enterSubmits, INSERT_MENU_ID, menuFromInput } from './insertMenu.js';
import {
  NOUN,
  buildCandidates,
  chipOpensPicker,
  chipOpensSheet,
  insertShortlist,
  previewHashOf,
  type Candidate,
  type ChipSheetKind,
  type IngredientKind,
  type InsertSigil,
} from './ingredientOptions.js';
import { useIngredientCatalog } from './useIngredientCatalog.js';
import { applySceneTint } from './sceneTint.js';
import { CEILING_SENTENCE, IDENTITY_CAP, IDENTITY_KINDS } from './attachRoom.js';
import {
  CHIP,
  caretBeside,
  caretFromPoint,
  caretRect,
  caretToEnd,
  caretUnits,
  chipAt,
  chipHexWords,
  chipLabel,
  closeIcon,
  collapseDoubleSpaceAtCaret,
  syncEmpty,
  decode,
  emptySentence,
  encode,
  hasSelectionIn,
  identityKeyOf,
  insertToken,
  moveAnnouncement,
  moveChipBy,
  normalizeLine,
  normalizeTint,
  parseBriefHtml,
  readLine,
  removeChip,
  renderLine,
  serializeSelection,
  setCaretUnits,
  sigilAtCaret,
  templateChip,
  textBeforeCaret,
  unitsBeforeChip,
  updateColorChip,
  type SentenceToken,
} from './line.js';

export type { SentenceToken, BriefToken, FormatToken } from './line.js';
export { briefTokens, emptySentence, identityKeyOf, isSentence } from './line.js';

export { FORMATS } from './formats.js';

/** Click this close to a chip's edge and you meant the caret, not the menu. */
const EDGE = 6;

export interface BriefInputHandle {
  openMenu: (anchor: HTMLElement | null) => void;
  /** Drop a token at the caret, the same way the slash menu does. */
  insert: (t: SentenceToken) => void;
  /** The only repaint: a remix loaded, the brief cleared, a template seeded. */
  setTokens: (t: SentenceToken[]) => void;
  /** Drop the current template chip, if any: it no longer resolves against the catalog. */
  removeTemplate: () => void;
  /** Take the chip that is this identity out of the brief, if it is in. The rail's untick. */
  remove: (t: SentenceToken) => void;
  focus: () => void;
  /**
   * Put the caret back where a chip-opened surface found it.
   *
   * The same contract `closePicker` keeps, for the one surface the composer
   * does not own: a dialog hands focus back to whatever opened it, and what
   * opened this was a chip. Focus left sitting on a chip turns the next
   * Backspace into a removal, so the caret has to come home instead.
   */
  restoreCaret: () => void;
}

/**
 * The brief as one editable sentence.
 *
 * The line is a single contenteditable, so selection, select all, copy, cut and
 * paste behave the way the browser already knows how to, across prose and chips
 * alike. Chips are contenteditable=false atoms inside it.
 *
 * React does not own the children and never re-renders them. Tokens flow out
 * through onChange and only ever come back in through setTokens, so a repaint
 * can never happen while the caret is in the line. Everything that touches
 * nodes lives in line.ts.
 */
export const BriefInput = forwardRef<
  BriefInputHandle,
  {
    initialTokens?: SentenceToken[];
    onChange: (t: SentenceToken[]) => void;
    brand: Brand;
    shots: TreeNode[];
    templates: Scene[];
    presenters: Presenter[];
    demoProducts: DemoProduct[];
    /** A Scene picked from the attach panel or the chip picker goes through here, not straight to `place()` — this is the one shared attach policy every entry point shares. */
    onTemplatePick: (id: string) => void;
    /** The hub has a refine armed, so scenes sit out of the sigil menus too —
     * same restriction the attach panel shows, so no door disagrees. */
    scenesSitOut?: boolean;
    placeholder: string;
    /** Shorter line for narrow viewports; falls back to placeholder. */
    placeholderSm?: string;
    flag?: (t: SentenceToken) => string | null;
    /** Whether this identity reaches the engine as words: its chip dims and its card says so. */
    described?: (t: SentenceToken) => boolean;
    /** The card's one line for a described identity. */
    describedNote?: string | null;
    /**
     * A chip whose identity is an image was opened. The composer owns the
     * lightbox, so there is one per composer rather than one per surface that
     * can ask for it.
     */
    onInspect?: (image: { src: string; kind: PreviewKind; label: string | null }) => void;
    /** The category of whichever product the brief already holds, for the
     * picker's "Suited to X" lift. A hint, never a gate — see compat.ts. */
    activeProductCategory?: string | null;
    /** Open the attach panel on a named tab. The one warning a click can
     * genuinely fix is a scene built around a product or a person the brief
     * has not got, and the fix is a different ingredient rather than a
     * different scene — so the picker offers it as an action instead of the
     * chip's own click silently becoming it. */
    onAttachRequest?: (tab: 'Products' | 'Presenters') => void;
    onSubmit: () => void;
    /** A dropped file goes straight to the same place a picked one does — this
     * only hands the raw FileList off, upload + insert stays wherever it
     * already lived. */
    onDropFiles?: (files: FileList) => void;
  }
>(function BriefInput(
  {
    initialTokens,
    onChange,
    brand,
    templates,
    presenters,
    demoProducts,
    onTemplatePick,
    scenesSitOut,
    placeholder,
    placeholderSm,
    flag,
    described,
    describedNote,
    onInspect,
    activeProductCategory,
    onAttachRequest,
    onSubmit,
    onDropFiles,
  },
  ref,
) {
  const rootRef = useRef<HTMLDivElement>(null);
  /** The scrolling wrapper around the line, for the more-below fade. */
  const scrollerRef = useRef<HTMLDivElement>(null);
  /** The one live region every reorder path speaks through. */
  const hintId = useId();
  const [live, setLive] = useState('');
  const announce = useCallback((msg: string) => {
    // clear-then-set on a frame boundary so repeating the same move
    // re-announces instead of being deduplicated by the screen reader
    setLive('');
    requestAnimationFrame(() => setLive(msg));
  }, []);
  const chipCount = useRef(0);
  /**
   * Where the caret last was inside the line. Only used when focus genuinely
   * left it: the file dialog and the attach panel's search box.
   */
  const lastCaret = useRef<number | null>(null);
  /**
   * The caret menu, and nothing else.
   *
   * It used to double as the chip's replace menu through a `replaceUid`, which
   * is what made typing at a chip menu insert into the brief: the query is fed
   * by the sigil under the caret, and in replace mode there was none, so the
   * menu said "keep typing to narrow" while every letter went into the line
   * behind it. A chip opens a picker now; this state cannot describe one.
   */
  const [menu, setMenu] = useState<{
    anchor: { getBoundingClientRect(): DOMRect } | null;
    sigil?: InsertSigil;
  } | null>(null);
  /** The open chip picker. Never both this and `menu`. */
  const [picker, setPicker] = useState<{
    uid: string;
    kind: ChipSheetKind;
    anchor: HTMLElement;
    /** Where the caret was when it opened, so closing can put it back. */
    caret: number | null;
    /** Opened by touch: closing must not re-focus, or the keyboard springs up. */
    touch: boolean;
  } | null>(null);
  /**
   * The chip being peeked at. Never a committed surface: a picker, a menu and
   * a drag all own the chip while they are up, and this yields to all three.
   */
  const hover = useHoverPreview<{ uid: string; anchor: HTMLElement }>();
  const { shown: hovered, closeNow: closeHover } = hover;
  const pickerRef = useRef(picker);
  useEffect(() => {
    pickerRef.current = picker;
  }, [picker]);
  /** The live `flag`, for the close path that has to put a chip's title back. */
  const flagRef = useRef(flag);
  useEffect(() => {
    flagRef.current = flag;
  }, [flag]);
  const [query, setQuery] = useState('');
  const [activeOptionId, setActiveOptionId] = useState<string | null>(null);
  const pasted = useRef(false);
  const uidSeq = useRef(0);
  const [dragOver, setDragOver] = useState(false);
  // a counter, not a boolean: chips are non-editable child elements inside
  // rootRef, so a plain enter/leave toggle flickers every time the pointer
  // crosses one on the way across the line
  const dragDepth = useRef(0);

  const { products: library } = useBrand();
  const products: any[] = library.length ? library : ((brand.json?.products ?? []) as any[]);
  const cast: any[] = (brand.json?.characters ?? []) as any[];
  const marks = useMemo(() => attachableMarks(brand.json), [brand]);

  const chipFor = useCallback(
    (token: SentenceToken, uid?: string): HTMLElement => {
      const el = document.createElement('span');
      el.className = CHIP;
      el.contentEditable = 'false';
      // A bidi-isolated run with its own direction: an LTR product name inside
      // a Hebrew sentence (or the reverse) renders its own way without letting
      // the browser reorder it against the surrounding prose. dir=auto implies
      // unicode-bidi:isolate, so the LOGICAL token order — the one the
      // compiler reads — is never what the bidi algorithm rearranges.
      el.dir = 'auto';
      el.dataset.kind = token.t;
      el.dataset.tok = encode(token);
      el.dataset.uid = uid ?? `u${uidSeq.current++}`;

      let label = '';
      let thumb: string | null = null;
      let thumbCrop: 'top' | undefined;
      let swatch: string | null = null;
      if (token.t === 'template') {
        const t = templates.find((x) => x.id === token.id);
        label = t ? sceneLabel(t, 'chip') : 'missing template';
        thumb = t?.previewUrl ?? null;
        const tint = normalizeTint(t?.previewColor);
        if (tint) {
          el.dataset.tinted = 'true';
          el.style.setProperty('--tint', tint);
        }
        // A brand-owned scene has no authored previewColor: its tint is read
        // from its own preview, the same scoring the catalog colours came from.
        if (!tint && thumb && t && 'custom' in t && t.custom) applySceneTint(el, thumb);
      } else if (token.t === 'product') {
        const p = products.find((x) => x.id === token.id);
        const d = p ? null : demoProducts.find((x) => x.id === token.id);
        // A chip sits inside the user's own sentence, so it gets the bare
        // product name — the brand is context the sentence already carries.
        const attached = p ?? d;
        label = attached ? productLabel(attached, 'chip') : 'missing product';
        thumb = p ? assetUrl(p.shots?.[0]?.file) : (d?.previewUrl ?? null);
      } else if (token.t === 'character') {
        const c = cast.find((x) => x.id === token.id);
        const p = c ? null : presenters.find((x) => x.id === token.id);
        label = c?.name ?? p?.name ?? 'missing person';
        // The canonical avatar chain (presenterVisual.ts). This chip used to
        // put the raw full-length studio shot inside its 15px circle.
        const av = c ? characterAvatar(c) : p ? presenterAvatar(p) : { src: null };
        thumb = av.src;
        thumbCrop = av.crop;
      } else if (token.t === 'color') {
        label = token.name ?? token.hex;
        swatch = token.hex;
      } else if (token.t === 'ref') {
        label = 'reference';
        thumb = imgUrl(token.imageHash);
      } else if (token.t === 'mark') {
        const m = marks.find((x) => x.hash === token.imageHash);
        label = m ? markLabel(brand.json, m) : 'missing mark';
        thumb = imgUrl(token.imageHash);
      }

      if (thumb) {
        const img = document.createElement('img');
        img.src = thumb;
        img.alt = '';
        if (thumbCrop) img.dataset.crop = thumbCrop;
        // A 404 must degrade to the chip's own label, not the browser's
        // broken-image glyph inside a circle.
        img.onerror = () => img.remove();
        el.appendChild(img);
      } else if (swatch) {
        const sw = document.createElement('span');
        sw.className = 'sc-token-swatch';
        sw.style.background = swatch;
        el.appendChild(sw);
      }
      el.appendChild(document.createTextNode(label));

      const warning = flag?.(token) ?? null;
      if (warning) {
        el.title = warning;
        el.dataset.warn = '1';
      }
      if (described?.(token)) el.dataset.described = '1';

      /**
       * A chip that opens a picker is a button, and says so.
       *
       * It was a bare span with no tabIndex and a remove button at -1, so the
       * only keyboard route to a chip was to backspace over it: there was no
       * way to reach one, and no way to change one. Tab is intercepted in
       * `onKeyDown` so six chips do not become six tab stops on the way out.
       */
      const pk = chipOpensPicker(token);
      if (pk) {
        const noun = pk === 'color' ? 'colour' : NOUN[pk];
        el.tabIndex = 0;
        el.setAttribute('role', 'button');
        el.setAttribute('aria-haspopup', 'dialog');
        el.setAttribute('aria-expanded', 'false');
        el.setAttribute('aria-label', `${noun}: ${label}. Change or remove.`);
      } else {
        // A reference or a mark has no catalog to swap from, but its identity
        // IS a picture: hovering peeks at it and opening shows it full size.
        // Same button, same popup, a different verb.
        el.tabIndex = 0;
        el.setAttribute('role', 'button');
        el.setAttribute('aria-haspopup', 'dialog');
        el.setAttribute('aria-expanded', 'false');
        el.setAttribute(
          'aria-label',
          `${token.t === 'mark' ? 'brand mark' : 'reference image'}: ${label}. Open, remove or move.`,
        );
      }
      // Every chip moves the same way; the shared hint below the line says how.
      el.setAttribute('aria-keyshortcuts', 'Alt+ArrowLeft Alt+ArrowRight');
      el.setAttribute('aria-describedby', hintId);
      // the browser's own node-drag of a contenteditable=false atom bypasses
      // every rule this line has; the pointer controller replaces it
      el.setAttribute('draggable', 'false');

      const x = document.createElement('button');
      x.type = 'button';
      x.tabIndex = -1;
      // Mouse-only by design: the keyboard remove is Delete on the chip, and a
      // nested interactive inside a role=button chip is an AT violation — so
      // the x is chrome, not a control, to everything but a pointer.
      x.setAttribute('aria-hidden', 'true');
      x.dataset.role = 'remove';
      x.appendChild(closeIcon());
      el.appendChild(x);
      return el;
    },
    [templates, products, cast, presenters, demoProducts, marks, brand, flag, described, hintId],
  );

  const emit = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    chipCount.current = root.querySelectorAll(`.${CHIP}`).length;
    onChange(readLine(root));
  }, [onChange]);

  /** Mount once. Nothing else may replace the children behind the caret. */
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    renderLine(root, initialTokens?.length ? initialTokens : emptySentence(), (t) => chipFor(t));
    chipCount.current = root.querySelectorAll(`.${CHIP}`).length;
    syncEmpty(root);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** The sheet's Move buttons: same move, same announcement, as Alt+Arrow. */
  const moveFromSheet = useCallback(
    (uid: string, dir: -1 | 1) => {
      const root = rootRef.current;
      const el = root?.querySelector<HTMLElement>(`[data-uid="${CSS.escape(uid)}"]`);
      if (root && el && moveChipBy(root, el, dir)) {
        emit();
        announce(moveAnnouncement(root, el));
      }
    },
    [emit, announce],
  );

  /** Pointer-drag reordering; drops land through the same emit as every edit. */
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    return attachChipDrag(root, {
      onDragStart: () => {
        setMenu(null);
        setQuery('');
        // A peek that was open on the chip being picked up would ride along
        // otherwise; the pointer-over path already refuses to open one while
        // the drag runs.
        closeHover();
      },
      onMoved: (_chip, message) => {
        emit();
        announce(message);
      },
      onCancelled: () => announce('Reorder cancelled.'),
    });
  }, [emit, announce, closeHover]);

  /** Chips are DOM nodes React never revisits (see chipFor above), so a
   * warning set at creation — "builds around a product", "cannot read this
   * reference" — stayed on the chip even after the thing it warned about was
   * fixed. Attaching a product from the warning chip's own click left it
   * stuck warning, and stuck hijacking the next click into re-opening
   * AttachPanel instead of the normal swap-this-token menu. Re-synced here
   * against every chip whenever what a chip should say might have changed. */
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    for (const chip of root.querySelectorAll<HTMLElement>(`.${CHIP}`)) {
      const token = decode(chip.dataset.tok ?? '');
      if (!token) continue;
      const warning = flag?.(token) ?? null;
      if (warning) chip.dataset.warn = '1';
      else delete chip.dataset.warn;
      if (described?.(token)) chip.dataset.described = '1';
      else delete chip.dataset.described;
      // A chip with a surface open says its warning inside that surface, so the
      // native tooltip would be the same words a second time, hovering over the
      // picture the panel exists to show. `openPicker` takes the title off and
      // `closePicker` puts it back; this only has to agree with them.
      if (warning && !('open' in chip.dataset)) chip.title = warning;
      else chip.removeAttribute('title');
    }
  }, [flag, described]);

  useEffect(() => {
    const track = () => {
      const u = caretUnits(rootRef.current);
      if (u !== null) lastCaret.current = u;
    };
    document.addEventListener('selectionchange', track);
    return () => document.removeEventListener('selectionchange', track);
  }, []);

  const place = useCallback(
    (token: SentenceToken) => {
      const root = rootRef.current;
      if (!root) return;
      // one template per brief, swapped in its own slot rather than appended
      if (token.t === 'template') {
        const existing = templateChip(root);
        if (existing) {
          existing.replaceWith(chipFor(token, existing.dataset.uid));
          normalizeLine(root);
          emit();
          setMenu(null);
          setQuery('');
          return;
        }
      }
      // One chip per thing, whichever door asked: the menu, the attach panel,
      // the assets rail. Asking again for an identity the brief already holds
      // says so instead of growing a twin.
      const key = identityKeyOf(token);
      if (key) {
        const twin = Array.from(root.querySelectorAll<HTMLElement>(`.${CHIP}`)).find((c) => {
          const held = decode(c.dataset.tok ?? '');
          return !!held && identityKeyOf(held) === key;
        });
        if (twin) {
          setMenu(null);
          setQuery('');
          announce(`${chipLabel(twin) || 'That'} is already in the brief.`);
          return;
        }
      }
      // Two ceilings, counted at the door so no round trip can be outrun.
      // A scene swap replaces the scene it finds, so it is never a new
      // identity; a colour never was one.
      const isNewIdentity = IDENTITY_KINDS.has(token.t) && !(token.t === 'template' && templateChip(root));
      if (isNewIdentity) {
        const held = Array.from(root.querySelectorAll<HTMLElement>(`.${CHIP}`)).filter((c) =>
          IDENTITY_KINDS.has(c.dataset.kind ?? ''),
        ).length;
        if (held >= IDENTITY_CAP) {
          setMenu(null);
          setQuery('');
          announce(CEILING_SENTENCE);
          return;
        }
        // Past the engine's photo seats nothing is refused: seats go out in
        // the line's order, so a chip that found none says so on itself and
        // can be dragged earlier to take one.
      }
      insertToken(root, chipFor(token), { eatQuery: !!menu, fallbackUnits: lastCaret.current });
      emit();
      setMenu(null);
      setQuery('');
    },
    [menu, chipFor, emit, announce],
  );

  const placeRef = useRef(place);
  useEffect(() => {
    placeRef.current = place;
  }, [place]);

  /**
   * Swap one chip for another in its own slot.
   *
   * The uid is reused, so the element is replaced but the *position* is not:
   * `caretUnits` counts a chip as exactly one unit, so every caret index in
   * the line is the same number before and after. That invariance is what
   * lets the picker take focus for its search field and still hand the caret
   * back where it found it.
   */
  const replaceChip = useCallback(
    (uid: string, token: SentenceToken): boolean => {
      const root = rootRef.current;
      const el = root?.querySelector<HTMLElement>(`[data-uid="${CSS.escape(uid)}"]`);
      if (!root || !el) return false; // the chip went away underneath the picker
      el.replaceWith(chipFor(token, uid));
      normalizeLine(root);
      emit();
      return true;
    },
    [chipFor, emit],
  );

  /** Take a chip out, and answer with the seam its caret should land on. */
  const removeChipByUid = useCallback(
    (uid: string): number | null => {
      const root = rootRef.current;
      const el = root?.querySelector<HTMLElement>(`[data-uid="${CSS.escape(uid)}"]`);
      if (!root || !el) return null;
      // Worked out before the mutation: once the node is gone there is nothing
      // left to measure from.
      const at = unitsBeforeChip(root, el);
      removeChip(root, el);
      emit();
      return at;
    },
    [emit],
  );

  /**
   * Open the picture a chip IS, full size.
   *
   * The hash comes off the token, so what the lightbox shows is the same
   * `imageHash` the compiler attaches. A peek is dismissed first: leaving a
   * card floating over a dialog is exactly the tooltip-over-panel problem this
   * feature had to solve in the first place.
   */
  const inspectChip = useCallback(
    (chip: HTMLElement): boolean => {
      const token = decode(chip.dataset.tok ?? '');
      if (!token || (token.t !== 'ref' && token.t !== 'mark')) return false;
      // Where to come back to. A click already placed the caret beside the
      // chip; a keyboard activation never moved it, so read it either way
      // before the dialog takes focus off the line.
      const root = rootRef.current;
      const at = root ? caretUnits(root) : null;
      if (at != null) lastCaret.current = at;
      closeHover();
      onInspect?.({ src: imgUrl(token.imageHash), kind: token.t, label: token.t === 'mark' ? chipLabel(chip) : null });
      return true;
    },
    [onInspect, closeHover],
  );

  const openPicker = useCallback(
    (chip: HTMLElement, kind: ChipSheetKind, caret: number | null, touch: boolean) => {
      const uid = chip.dataset.uid;
      if (!uid) return;
      // The picker owns the chip now: a peek left over from the hover that led
      // here must not keep floating beside the surface it opened.
      closeHover();
      chip.dataset.open = '';
      // Every chip that opens a surface carries aria-haspopup; the guard is only
      // so a chip that somehow has none cannot grow a lying aria-expanded.
      if (chip.hasAttribute('aria-haspopup')) chip.setAttribute('aria-expanded', 'true');
      // The warning is about to be said inside the surface. Leaving the title on
      // would float the same sentence over it on the next hover.
      chip.removeAttribute('title');
      setMenu(null);
      setQuery('');
      setPicker({ uid, kind, anchor: chip, caret, touch });
    },
    [closeHover],
  );

  /**
   * Every way out of the picker, and the only place the caret comes back.
   *
   * Idempotent through the ref: a drag that dismisses and an outside click
   * that lands in the same frame must not fight over it.
   */
  const closePicker = useCallback((_reason: CloseReason, caretOverride?: number | null) => {
    const p = pickerRef.current;
    pickerRef.current = null;
    setPicker(null);
    if (!p) return;
    const root = rootRef.current;
    const chip = root?.querySelector<HTMLElement>(`[data-uid="${CSS.escape(p.uid)}"]`);
    if (chip) {
      delete chip.dataset.open;
      if (chip.hasAttribute('aria-haspopup')) chip.setAttribute('aria-expanded', 'false');
      // Re-derived rather than stashed: the compiler may have re-flagged this
      // chip while the surface was open.
      const token = decode(chip.dataset.tok ?? '');
      const warning = token ? (flagRef.current?.(token) ?? null) : null;
      if (warning) chip.title = warning;
    }
    const at = caretOverride !== undefined ? caretOverride : p.caret;
    // Opened by a thumb: the line was never focused, and focusing it now is
    // exactly how the software keyboard would come up as the sheet leaves.
    if (p.touch) {
      if (at != null) lastCaret.current = at;
      return;
    }
    if (!root) return;
    // focus first: setCaretUnits places a range but does not focus, and
    // Chromium only re-establishes an editing caret on a genuine transition
    root.focus({ preventScroll: true });
    if (at != null) setCaretUnits(root, at);
    else caretToEnd(root);
  }, []);

  /**
   * The chip a picker is anchored to stopped existing.
   *
   * `setTokens` regenerates every uid (a remix loaded, the brief cleared after
   * a send), and a chip can also be backspaced out from under an open picker.
   * Either way the panel is pointing at nothing.
   */
  useEffect(() => {
    if (!picker) return;
    const root = rootRef.current;
    if (root?.querySelector(`[data-uid="${CSS.escape(picker.uid)}"]`)) return;
    closePicker('outside');
  }, [picker, closePicker]);

  /**
   * The chip being peeked at was removed, reordered into a new element, or
   * replaced wholesale by `setTokens`. Either way the card points at nothing.
   */
  useEffect(() => {
    if (!hovered) return;
    if (rootRef.current?.contains(hovered.anchor)) return;
    closeHover();
  }, [hovered, closeHover]);

  /**
   * A chip with a card up says its warning inside that card, so the native
   * tooltip would be the same sentence again, floating over the picture. Put
   * back on the way out, and the title re-sync effect agrees by skipping any
   * chip that is marked open.
   */
  useEffect(() => {
    const el = hovered?.anchor;
    if (!el) return;
    el.dataset.open = '';
    const title = el.getAttribute('title');
    if (title) el.removeAttribute('title');
    return () => {
      delete el.dataset.open;
      if (title) el.setAttribute('title', title);
    };
  }, [hovered]);

  useImperativeHandle(ref, () => ({
    insert: (t) => placeRef.current(t),
    setTokens: (t) => {
      const root = rootRef.current;
      if (!root) return;
      renderLine(root, t.length ? t : emptySentence(), (tok) => chipFor(tok));
      chipCount.current = root.querySelectorAll(`.${CHIP}`).length;
      syncEmpty(root);
      onChange(readLine(root));
    },
    removeTemplate: () => {
      const root = rootRef.current;
      const chip = root ? templateChip(root) : null;
      if (!root || !chip) return;
      removeChip(root, chip);
      emit();
    },
    remove: (t) => {
      const root = rootRef.current;
      if (!root) return;
      const key = identityKeyOf(t);
      const chip = Array.from(root.querySelectorAll<HTMLElement>(`.${CHIP}`)).find((c) => {
        const held = decode(c.dataset.tok ?? '');
        return !!held && identityKeyOf(held) === key;
      });
      if (!chip) return;
      removeChip(root, chip);
      emit();
    },
    openMenu: (anchor) => {
      setQuery('');
      setMenu({ anchor });
    },
    focus: () => caretToEnd(rootRef.current),
    restoreCaret: () => {
      const root = rootRef.current;
      if (!root) return;
      // focus first: setCaretUnits places a range but does not focus, and
      // Chromium only re-establishes an editing caret on a genuine transition
      root.focus({ preventScroll: true });
      const at = lastCaret.current;
      if (at != null) setCaretUnits(root, at);
      else caretToEnd(root);
    },
  }));

  /**
   * Everything the three catalogs offer, built once.
   *
   * The caret menu used to build its own list from the brand library alone, so
   * `@` could not reach a Scenri library product and a presenter matched only
   * on name and descriptor while the attach panel searched the whole casting
   * sheet. Both surfaces read this now, so neither can drift from the other.
   */
  const catalog = useIngredientCatalog(activeProductCategory);

  const candidatesFor = useCallback((kind: IngredientKind): Candidate[] => buildCandidates(kind, catalog), [catalog]);

  const bookmarked = useMemo(() => new Set(bookmarkedScenes(brand.id)), [brand.id]);

  const shownOptions: MenuOption[] = useMemo(() => {
    if (!menu) return [];
    return insertShortlist(
      menu.sigil ?? '$',
      {
        products: buildCandidates('product', catalog),
        presenters: buildCandidates('presenter', catalog),
        scenes: scenesSitOut ? [] : buildCandidates('scene', catalog),
        colors: flattenPalette(brand.json?.palette),
      },
      { query, bookmarked },
    ).map((c) => ({
      ...c,
      run: () => (c.token.t === 'template' ? onTemplatePick(c.token.id) : placeRef.current(c.token)),
    }));
  }, [menu, catalog, query, bookmarked, onTemplatePick, scenesSitOut, brand.json?.palette]);

  const onClick = (e: React.MouseEvent) => {
    const root = rootRef.current;
    const target = e.target as HTMLElement;
    if (target.closest('[data-role="remove"]')) {
      e.preventDefault();
      const chip = chipAt(target);
      if (picker && chip?.dataset.uid === picker.uid) closePicker('remove');
      // one transition for every button-driven removal: the same uid lookup,
      // seam measure and emit that the keyboard and sheet paths use
      if (chip?.dataset.uid) removeChipByUid(chip.dataset.uid);
      setMenu(null);
      return;
    }
    // What was clicked decides what the click means, so it is resolved before
    // the selection guard: a chip's body is an interaction, everything else is
    // a caret ask. The outer few pixels of a chip are for reaching the caret,
    // not for opening the menu, so they count as prose.
    const chip = chipAt(target);
    const box = chip?.getBoundingClientRect();
    const inChipBody = !!chip && !!box && e.clientX - box.left > EDGE && box.right - e.clientX > EDGE;
    if (!inChipBody) {
      /*
       * A drag that selects text ends in a click on the line, and every click
       * used to place a caret — which collapsed the selection the drag had
       * just made, so text appeared to deselect itself the instant the mouse
       * came up. A click that leaves something selected is not asking for a
       * caret, and that includes the double click that takes a word and the
       * triple that takes the line.
       */
      if (hasSelectionIn(root)) return;
      // Every click in the line is resolved by the line, not by the browser:
      // beside a chip, or in the padding, the browser's answer is wrong.
      caretFromPoint(root, e.clientX, e.clientY);
      return;
    }
    // A chip-body click is asking for the picker, never for a caret, so it
    // runs whatever is selected: clicking an atom leaves the selection, the
    // way clicking a button would. The guard above must not swallow it.
    caretFromPoint(root, e.clientX, e.clientY);
    const uid = chip.dataset.uid ?? null;
    // The touch path already opened it on pointerdown, before the browser
    // could focus the line; this would close what that just opened.
    if (uid && picker?.uid === uid) {
      if (e.detail !== 0) closePicker('outside');
      return;
    }
    const kind = chipOpensPicker(decode(chip.dataset.tok ?? ''));
    // A reference or a brand mark is not a catalog to swap — replace one by
    // deleting and inserting again, the way it was made — so what a click on
    // its body asks for is the only thing it has: that picture, properly.
    //
    // Clicking a chip body is already how every other chip opens its surface,
    // and the competing meaning is already handled a few lines up: the outer
    // EDGE pixels of every chip are reserved for reaching the caret, so a
    // click that got this far was aimed at the chip and nothing else.
    if (!kind) {
      inspectChip(chip);
      return;
    }
    // The caret was just placed by caretFromPoint above, while the line still
    // has focus — so this is an exact reading, and it is the one the picker
    // hands back when it closes.
    openPicker(chip, kind, caretUnits(root), false);
  };

  /**
   * Peeking, delegated from the line.
   *
   * `pointerover` rather than enter, because the chips are DOM nodes React
   * never rendered: there is nothing to attach a per-chip handler to without
   * the line handing it out. It only ever sets state — no preventDefault, no
   * focus, no caret — so nothing here can reach the selection or the editor.
   */
  const onPointerOver = (e: React.PointerEvent) => {
    // A finger gets the sheet, and a pen mid-drag is drawing, not peeking.
    if (e.pointerType !== 'mouse') return;
    const root = rootRef.current;
    // A picker, the insert menu and a drag each own the chip while they run.
    if (picker || menu || (root && 'chipDrag' in root.dataset)) return;
    const chip = chipAt(e.target as HTMLElement);
    const uid = chip?.dataset.uid;
    if (!chip || !uid || !chipPeeks(chip)) {
      hover.close();
      return;
    }
    if (hovered?.uid === uid) {
      hover.keep();
      return;
    }
    hover.open({ uid, anchor: chip });
  };

  // What a hover or focus can peek at: anything with a picture of its own.
  // A reference or mark carries a hash; a product, presenter or scene chip
  // peeks the same art its thumbnail already resolved. A colour has no
  // picture, and a chip whose photo failed to load has nothing to show.
  const chipPeeks = (chip: HTMLElement): boolean => {
    const t = decode(chip.dataset.tok ?? '');
    if (previewHashOf(t)) return true;
    const k = chipOpensPicker(t);
    return !!(k && k !== 'color' && isPreviewKind(k) && chip.querySelector('img'));
  };

  /**
   * Focus is the keyboard's hover.
   *
   * Only `:focus-visible`, so the focus a mouse click leaves on a chip does not
   * re-open the card the click just dismissed on its way to the lightbox.
   */
  const onFocusIn = (e: React.FocusEvent) => {
    const chip = chipAt(e.target as HTMLElement);
    const uid = chip?.dataset.uid;
    if (!chip || !uid || picker || menu) return;
    if (!chipPeeks(chip)) return;
    if (!chip.matches(':focus-visible')) return;
    hover.open({ uid, anchor: chip });
  };

  /**
   * A thumb on a chip opens the sheet, and must not focus the line.
   *
   * A tap focuses a contenteditable natively, before any React handler runs,
   * which brings the software keyboard up behind the sheet that is opening.
   * The only place to stop that is pointerdown.
   */
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse') return;
    const target = e.target as HTMLElement;
    if (target.closest('[data-role="remove"]')) return;
    const chip = chipAt(target);
    if (!chip) return; // prose still focuses, and still raises the keyboard
    const box = chip.getBoundingClientRect();
    if (e.clientX - box.left <= EDGE || box.right - e.clientX <= EDGE) return;
    // The same surface set a click resolves; `touch` is what decides that a
    // ref/mark opens the move/remove sheet here rather than the preview panel.
    const kind = chipOpensSheet(decode(chip.dataset.tok ?? ''));
    if (!kind) return;
    if (chip.dataset.uid && picker?.uid === chip.dataset.uid) return;
    e.preventDefault();
    const root = rootRef.current;
    const had = document.activeElement === root;
    const at = had ? caretUnits(root) : lastCaret.current;
    if (had) root?.blur();
    openPicker(chip, kind, at, true);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const root = rootRef.current;
    const focused = chipAt(e.target as HTMLElement);
    // A chip has focus, so these keys are the chip's before they are the line's.
    // Enter especially: without this branch first, a focused chip submits.
    if (focused && !picker) {
      const back = () => {
        caretBeside(root, focused, 'after');
        root?.focus({ preventScroll: true });
      };
      // Alt+Arrow moves the chip itself; order is meaning here, so the move
      // is a real DOM move followed by the same emit every edit takes.
      if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        e.preventDefault();
        if (root && moveChipBy(root, focused, e.key === 'ArrowLeft' ? -1 : 1)) {
          // removal-and-reinsert dropped focus to body; hand it back
          focused.focus({ preventScroll: true });
          emit();
          announce(moveAnnouncement(root, focused));
        }
        return;
      }
      // a plain arrow steps off the chip into the text, matching Tab/Escape
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        caretBeside(root, focused, e.key === 'ArrowLeft' ? 'before' : 'after');
        root?.focus({ preventScroll: true });
        return;
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        // Step off the chip into the line rather than into the next chip: one
        // more Tab then leaves the composer the way it always did.
        caretBeside(root, focused, e.shiftKey ? 'before' : 'after');
        root?.focus({ preventScroll: true });
        return;
      }
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        const kind = chipOpensPicker(decode(focused.dataset.tok ?? ''));
        if (kind && root) openPicker(focused, kind, unitsBeforeChip(root, focused) + 1, false);
        // The same two steps a pointer takes, in the keyboard's own terms:
        // focusing the chip already put its card on screen, and Enter is the
        // deliberate second act that opens it. Unlike a click in a sentence,
        // pressing Enter on a focused chip can only have meant this.
        else inspectChip(focused);
        return;
      }
      if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault();
        const at = focused.dataset.uid ? removeChipByUid(focused.dataset.uid) : null;
        root?.focus({ preventScroll: true });
        if (at != null) setCaretUnits(root, at);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        back();
        return;
      }
    }
    if (e.key === 'Escape' && menu) {
      e.preventDefault();
      setMenu(null);
      setQuery('');
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      const handled = e.defaultPrevented;
      e.preventDefault();
      if (enterSubmits({ menuOpen: !!menu, handled })) onSubmit();
      return;
    }
    if (menu || picker) return;
    if (composingEvent(e)) return;
    // '$' a product, '/' a scene, '@' a presenter, '#' a colour.
    if (e.key === '$' || e.key === '/' || e.key === '@' || e.key === '#') {
      const root = rootRef.current;
      const before = textBeforeCaret(root);
      const prev = before.slice(-1);
      if (before.length && !/[\s\u00a0]/.test(prev)) return; // mid-word: path, email, or hex
      // Live caret, not a snapshot. keydown runs before `#` is in the line, and
      // an empty contenteditable's range is the whole block — freezing that is
      // how the menu sat in the middle of the composer on a bare trigger.
      setQuery('');
      setMenu({
        anchor: {
          getBoundingClientRect: () => caretRect() ?? root?.getBoundingClientRect() ?? new DOMRect(),
        },
        sigil: e.key,
      });
    }
  };

  const nameForHex = useCallback(
    (hex: string) => flattenPalette(brand.json?.palette).find((s) => s.hex === hex)?.name,
    [brand.json?.palette],
  );

  /**
   * Whether more brief sits below the scroller's fold, for the bottom fade.
   * Read on a frame boundary: the input event lands before layout settles,
   * and reading scroll numbers synchronously there forces a reflow per
   * keystroke.
   */
  const syncScrollHint = useCallback(() => {
    requestAnimationFrame(() => {
      const el = scrollerRef.current;
      if (!el) return;
      const more = el.scrollHeight - el.scrollTop - el.clientHeight > 1;
      if (more) el.dataset.more = '';
      else delete el.dataset.more;
    });
  }, []);
  // content can also change without an input event: a remix landing, a chip
  // removed by its X, a repaint through setTokens
  useEffect(() => {
    syncScrollHint();
  });

  const onInput = () => {
    syncScrollHint();
    const root = rootRef.current;
    const chips = root?.querySelectorAll(`.${CHIP}`).length ?? 0;
    // a chip deleted with Backspace or Delete leaves both of its spaces behind
    if (chips < chipCount.current) collapseDoubleSpaceAtCaret(root);
    chipCount.current = chips;
    // clearing the line leaves a <br>; strip it and flip data-empty so the
    // placeholder returns even if Chromium re-inserts a caret host
    if (syncEmpty(root)) caretToEnd(root);
    const fromPaste = pasted.current;
    pasted.current = false;
    const chipped = chipHexWords(root, (t) => chipFor(t), { commit: fromPaste, nameFor: nameForHex });
    if (chipped) {
      chipCount.current = root?.querySelectorAll(`.${CHIP}`).length ?? 0;
      setMenu(null);
      setQuery('');
    }
    const next = chipped ? { open: false as const } : menuFromInput(sigilAtCaret(root), fromPaste);
    if (next.open) {
      if (menu) setQuery(next.query);
    } else if (menu) {
      setMenu(null);
      setQuery('');
    }
    emit();
  };

  const writeSelection = (e: React.ClipboardEvent): Range | null => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
    const range = sel.getRangeAt(0);
    const { text, html } = serializeSelection(range);
    if (!text) return null;
    e.clipboardData.setData('text/plain', text);
    e.clipboardData.setData('text/html', html);
    e.preventDefault();
    return range;
  };

  const onCopy = (e: React.ClipboardEvent) => {
    writeSelection(e);
  };

  const onCut = (e: React.ClipboardEvent) => {
    const range = writeSelection(e);
    if (!range) return;
    range.deleteContents();
    normalizeLine(rootRef.current);
    emit();
  };

  /** True when a pasted chip still points at something this install has. */
  const known = useCallback(
    (t: SentenceToken): boolean => {
      if (t.t === 'template') return templates.some((x) => x.id === t.id);
      if (t.t === 'product') return products.some((x) => x.id === t.id) || demoProducts.some((x) => x.id === t.id);
      if (t.t === 'character') return cast.some((x) => x.id === t.id) || presenters.some((x) => x.id === t.id);
      if (t.t === 'mark') return marks.some((x) => x.hash === t.imageHash);
      return true;
    },
    [templates, products, cast, presenters, demoProducts, marks],
  );

  const onDragEnter = (e: React.DragEvent) => {
    if (!Array.from(e.dataTransfer.types).includes('Files')) return;
    e.preventDefault();
    dragDepth.current++;
    setDragOver(true);
  };
  const onDragOver = (e: React.DragEvent) => e.preventDefault(); // required to permit a drop
  const onDragLeave = () => {
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragOver(false);
  };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    dragDepth.current = 0;
    setDragOver(false);
    if (e.dataTransfer.files.length) onDropFiles?.(e.dataTransfer.files);
  };

  const onPaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    pasted.current = true;
    const parts = parseBriefHtml(e.clipboardData.getData('text/html'));
    if (parts && pasteParts(parts)) {
      const root = rootRef.current;
      if (chipHexWords(root, (t) => chipFor(t), { commit: true, nameFor: nameForHex })) {
        chipCount.current = root?.querySelectorAll(`.${CHIP}`).length ?? 0;
        emit();
      }
      return;
    }
    const text = e.clipboardData.getData('text/plain');
    if (text) document.execCommand('insertText', false, text);
  };

  const pasteParts = (parts: (string | SentenceToken)[]): boolean => {
    const root = rootRef.current;
    const sel = window.getSelection();
    if (!root || !sel || sel.rangeCount === 0 || !root.contains(sel.getRangeAt(0).startContainer)) return false;
    const range = sel.getRangeAt(0);

    // one template per brief: the pasted one lands where it was pasted and the
    // chip the line already carried steps aside
    let usedTemplate = false;
    const kept: (string | SentenceToken)[] = [];
    for (const p of parts) {
      // a chip whose product or template is gone pastes as the words it read as
      if (typeof p !== 'string' && !known(p)) {
        kept.push(labelFallback(p, templates, products));
        continue;
      }
      if (typeof p !== 'string' && p.t === 'template') {
        if (usedTemplate) continue;
        usedTemplate = true;
      }
      kept.push(p);
    }
    const oldSlot = usedTemplate ? templateChip(root) : null;

    range.deleteContents();
    const frag = document.createDocumentFragment();
    for (const p of kept) frag.appendChild(typeof p === 'string' ? document.createTextNode(p) : chipFor(p));
    const tail = document.createTextNode(' ');
    frag.appendChild(tail);
    range.insertNode(frag);
    if (oldSlot) oldSlot.remove();

    const at = caretUnitsOf(root, tail);
    normalizeLine(root);
    setCaretUnits(root, at);
    emit();
    return true;
  };

  // Chromium drops a caret-host <br> into an empty contenteditable the moment it
  // gains focus. The placeholder is an inline ::before, so that <br> opened a
  // second line box and the whole composer card grew about a line's height on
  // click-in, then collapsed again on blur — the one genuine geometry change in
  // the composer. syncEmpty() already strips it; it simply had no focus caller.
  // rAF because the <br> is inserted after this event fires.
  const onFocus = useCallback(() => {
    requestAnimationFrame(() => {
      const root = rootRef.current;
      if (root && document.activeElement === root && syncEmpty(root)) caretToEnd(root);
    });
  }, []);

  /**
   * What the open surface is anchored to, read back off the chip itself.
   *
   * The hash comes from the token, never from the rendered `<img>` and never
   * from a position in the line: it is the same `imageHash` the compiler turns
   * into an attachment, so a preview cannot show one picture while the engine
   * receives another.
   */
  const anchorToken = picker ? decode(picker.anchor.dataset.tok ?? '') : null;
  const previewHash = previewHashOf(anchorToken);
  const anchorWarning = anchorToken ? (flag?.(anchorToken) ?? null) : null;
  const anchorNote = anchorToken && described?.(anchorToken) ? (describedNote ?? null) : null;

  const hoveredToken = hovered ? decode(hovered.anchor.dataset.tok ?? '') : null;
  const hoveredHash = previewHashOf(hoveredToken);
  // The chip's own resolved art: a product's shot, a presenter's avatar, a
  // scene's preview. The chip already chose it, so the card repeats it rather
  // than forming a second opinion. A chip with no picture peeks nothing.
  const hoveredThumb = hovered?.anchor.querySelector('img')?.getAttribute('src') ?? null;
  const hoveredSrc = hoveredHash ? imgUrl(hoveredHash) : hoveredThumb;
  const hoveredPicker = chipOpensPicker(hoveredToken);
  const hoveredKind =
    hoveredToken && isPreviewKind(hoveredToken.t)
      ? hoveredToken.t
      : hoveredPicker && hoveredPicker !== 'color' && isPreviewKind(hoveredPicker)
        ? hoveredPicker
        : null;
  const hoveredWarning = hoveredToken ? (flag?.(hoveredToken) ?? null) : null;
  const hoveredNote = hoveredToken && described?.(hoveredToken) ? (describedNote ?? null) : null;

  return (
    <div className="sc-brief" ref={scrollerRef} onScroll={syncScrollHint} data-drag-over={dragOver || undefined}>
      {/* the affordances a chip cannot carry visually: read by aria-describedby */}
      <span id={hintId} className="sc-vh">
        Press Enter to open, Delete to remove, Alt plus arrow keys to move.
      </span>
      {/* every reorder path announces here — drag, Alt+Arrow, the sheet */}
      <span className="sc-vh" role="status" aria-live="polite">
        {live}
      </span>
      {/* biome-ignore lint/a11y/useSemanticElements: this cannot be a <textarea> — the brief renders product and scene chips inline */}
      {/* biome-ignore lint/a11y/useAriaPropsSupportedByRole: textbox plus a listbox is the caret-menu pattern; combobox drops aria-multiline */}
      <div
        ref={rootRef}
        className="sc-brief-line"
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-autocomplete="list"
        aria-expanded={menu ? true : undefined}
        aria-controls={menu ? INSERT_MENU_ID : undefined}
        aria-activedescendant={menu ? (activeOptionId ?? undefined) : undefined}
        tabIndex={0}
        dir="auto"
        data-ph={placeholder}
        {...(placeholderSm ? { 'data-ph-sm': placeholderSm } : {})}
        onClick={onClick}
        onPointerDown={onPointerDown}
        onPointerOver={onPointerOver}
        onPointerLeave={(e) => e.pointerType === 'mouse' && hover.close()}
        onFocusCapture={onFocusIn}
        onKeyDown={onKeyDown}
        onInput={onInput}
        onCopy={onCopy}
        onCut={onCut}
        onPaste={onPaste}
        onDragEnter={onDragEnter}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onFocus={onFocus}
        onBlur={() => {
          const root = rootRef.current;
          if (chipHexWords(root, (t) => chipFor(t), { commit: true, nameFor: nameForHex })) {
            chipCount.current = root?.querySelectorAll(`.${CHIP}`).length ?? 0;
            setMenu(null);
            setQuery('');
          }
          emit();
        }}
      />

      {menu && (
        <TokenMenu
          anchor={menu.anchor}
          composer={{
            getBoundingClientRect: () =>
              rootRef.current?.closest('.sc-promptcard')?.getBoundingClientRect() ??
              rootRef.current?.getBoundingClientRect() ??
              new DOMRect(),
          }}
          line={{
            getBoundingClientRect: () => rootRef.current?.getBoundingClientRect() ?? new DOMRect(),
          }}
          query={query}
          options={shownOptions}
          sigil={menu.sigil}
          onActiveId={setActiveOptionId}
          onClose={() => {
            setMenu(null);
            setQuery('');
          }}
        />
      )}

      {hovered && hoveredSrc && hoveredKind && (
        <ChipPreview
          key={hovered.uid}
          anchor={hovered.anchor}
          kind={hoveredKind}
          src={hoveredSrc}
          // A hand-attached reference's label is the word "reference", which
          // the card already says; everything else has a name worth repeating.
          label={hoveredKind === 'ref' ? null : chipLabel(hovered.anchor)}
          warning={hoveredWarning}
          note={hoveredNote}
          // One pattern for every card: clicking the preview always opens the
          // picture full size. The picker stays the chip's own click.
          onOpen={() => {
            const chip = hovered.anchor;
            if (hoveredHash) {
              inspectChip(chip);
              return;
            }
            closeHover();
            onInspect?.({ src: hoveredSrc, kind: hoveredKind, label: chipLabel(chip) });
          }}
          onHoverIn={hover.keep}
          onHoverOut={hover.close}
          onClose={closeHover}
        />
      )}

      {picker?.kind === 'ref' || picker?.kind === 'mark' ? (
        // The touch door, and only that. A finger has neither the drag nor
        // Alt+Arrow and needs somewhere to move and remove from; a pointer has
        // both already, and peeks and opens instead.
        <ChipMoveSheet
          key={picker.uid}
          kind={picker.kind}
          label={chipLabel(picker.anchor)}
          thumb={previewHash ? imgUrl(previewHash) : null}
          onInspect={() => inspectChip(picker.anchor)}
          onMove={(dir) => moveFromSheet(picker.uid, dir)}
          onRemove={() => {
            const at = removeChipByUid(picker.uid);
            closePicker('remove', at);
          }}
          onClose={closePicker}
        />
      ) : picker?.kind === 'color' ? (
        <ColorChipMenu
          key={picker.uid}
          anchor={picker.anchor}
          currentHex={currentIdOf(picker.anchor)}
          currentName={currentColorName(picker.anchor)}
          palette={flattenPalette(brand.json?.palette)}
          onPick={(token, opts) => {
            const uid = picker.uid;
            if (opts?.live) {
              const el = rootRef.current?.querySelector<HTMLElement>(`[data-uid="${CSS.escape(uid)}"]`);
              if (el) updateColorChip(el, token);
              emit();
              return;
            }
            if (sameColor(token.hex, currentIdOf(picker.anchor))) {
              closePicker('pick');
              return;
            }
            replaceChip(uid, token);
            closePicker('pick');
          }}
          onRemove={() => {
            const at = removeChipByUid(picker.uid);
            closePicker('remove', at);
          }}
          onMove={(dir) => moveFromSheet(picker.uid, dir)}
          onClose={closePicker}
        />
      ) : picker ? (
        <IngredientPicker
          // A reopen gets a clean mount rather than the last one's scroll,
          // search and roving index.
          key={picker.uid}
          kind={picker.kind}
          anchor={picker.anchor}
          currentId={currentIdOf(picker.anchor)}
          candidates={candidatesFor(picker.kind)}
          brandId={brand.id}
          brandSlug={brand.slug}
          warning={anchorWarning}
          note={anchorNote}
          onAttachRequest={
            onAttachRequest
              ? (tab) => {
                  closePicker('outside');
                  onAttachRequest(tab);
                }
              : undefined
          }
          onPick={(c) => {
            const uid = picker.uid;
            if (c.id === currentIdOf(picker.anchor)) {
              // Re-picking what is already there is a true no-op: no swap, no
              // emit, no draft write, and for a scene no toast either.
              closePicker('pick');
              return;
            }
            if (c.kind === 'scene') {
              // One shared attach policy for every entry point: it is what
              // toasts, offers the undo, and drops a branch target.
              onTemplatePick(c.id);
            } else {
              replaceChip(uid, c.token);
            }
            closePicker('pick');
          }}
          onRemove={() => {
            const at = removeChipByUid(picker.uid);
            closePicker('remove', at);
          }}
          onMove={(dir) => moveFromSheet(picker.uid, dir)}
          onClose={closePicker}
        />
      ) : null}
    </div>
  );
});

/** What a chip is holding, read back off the element the picker is anchored to. */
function currentIdOf(chip: HTMLElement): string | null {
  const t = decode(chip.dataset.tok ?? '');
  if (!t) return null;
  if (t.t === 'color') return t.hex;
  return 'id' in t ? t.id : null;
}

function currentColorName(chip: HTMLElement): string | undefined {
  const t = decode(chip.dataset.tok ?? '');
  return t?.t === 'color' ? t.name : undefined;
}

function sameColor(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = a ? normalizeHex(a) : null;
  const right = b ? normalizeHex(b) : null;
  return !!left && left === right;
}

/** Characters before a node, chips counting as one, for restoring a caret. */
function caretUnitsOf(root: HTMLElement, node: Node): number {
  let n = 0;
  for (const c of Array.from(root.childNodes)) {
    if (c === node || c.contains(node)) break;
    n += c.nodeType === Node.TEXT_NODE ? (c.textContent ?? '').length : 1;
  }
  return n + (node.nodeType === Node.TEXT_NODE ? (node.textContent ?? '').length : 1);
}

function labelFallback(t: SentenceToken, templates: Scene[], products: any[]): string {
  if (t.t === 'template') return templates.find((x) => x.id === t.id)?.name ?? 'template';
  if (t.t === 'product') return products.find((x) => x.id === t.id)?.name ?? 'product';
  if (t.t === 'character') return 'someone';
  if (t.t === 'color') return t.name ?? t.hex;
  if (t.t === 'mark') return 'brand mark';
  return 'reference';
}

export { chipLabel };
