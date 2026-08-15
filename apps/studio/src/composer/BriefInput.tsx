import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { productLabel, sceneLabel } from '../displayName.js';
import { assetUrl, imgUrl, type Brand, type Scene, type Presenter, type DemoProduct, type TreeNode } from '../api.js';
import { useBrand } from '../app/BrandLayout.js';
import { flattenPalette } from '../brand/palette.js';
import { attachableMarks, markLabel } from '../brand/marks.js';
import { matchesQuery } from '../layout/library/libraryRules.js';
import { TokenMenu, type MenuOption } from './TokenMenu.js';
import { IngredientPicker, type CloseReason } from './IngredientPicker.js';
import { NOUN, buildCandidates, pickerKind, type Candidate, type IngredientKind } from './ingredientOptions.js';
import {
  CHIP,
  caretBeside,
  caretFromPoint,
  caretRect,
  caretToEnd,
  caretUnits,
  chipAt,
  chipLabel,
  closeIcon,
  collapseDoubleSpaceAtCaret,
  syncEmpty,
  decode,
  emptySentence,
  encode,
  insertToken,
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
  type SentenceToken,
} from './line.js';

export type { SentenceToken, BriefToken, FormatToken } from './line.js';
export { briefTokens, emptySentence, isSentence } from './line.js';

/** Kept as the composer's own list: size renders as nothing in the sentence. */
export const FORMATS = [
  { id: 'square', label: 'Square', hint: '1:1', w: 1024, h: 1024 },
  { id: 'story', label: 'Story', hint: '9:16', w: 1080, h: 1920 },
  { id: 'landscape', label: 'Landscape', hint: '16:9', w: 1600, h: 900 },
  { id: 'portrait', label: 'Portrait', hint: '4:5', w: 1024, h: 1280 },
];

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
  focus: () => void;
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
    /** A Scene picked from the `#`/`/` menu goes through here, not straight to `place()` — this is the one shared attach policy every entry point shares. */
    onTemplatePick: (id: string) => void;
    placeholder: string;
    /** Shorter line for narrow viewports; falls back to placeholder. */
    placeholderSm?: string;
    flag?: (t: SentenceToken) => string | null;
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
    shots,
    templates,
    presenters,
    demoProducts,
    onTemplatePick,
    placeholder,
    placeholderSm,
    flag,
    activeProductCategory,
    onAttachRequest,
    onSubmit,
    onDropFiles,
  },
  ref,
) {
  const rootRef = useRef<HTMLDivElement>(null);
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
    sigil?: '/' | '@' | '#';
  } | null>(null);
  /** The open chip picker. Never both this and `menu`. */
  const [picker, setPicker] = useState<{
    uid: string;
    kind: IngredientKind;
    anchor: HTMLElement;
    /** Where the caret was when it opened, so closing can put it back. */
    caret: number | null;
    /** Opened by touch: closing must not re-focus, or the keyboard springs up. */
    touch: boolean;
  } | null>(null);
  const pickerRef = useRef(picker);
  useEffect(() => {
    pickerRef.current = picker;
  }, [picker]);
  const [query, setQuery] = useState('');
  const uidSeq = useRef(0);
  const [dragOver, setDragOver] = useState(false);
  // a counter, not a boolean: chips are non-editable child elements inside
  // rootRef, so a plain enter/leave toggle flickers every time the pointer
  // crosses one on the way across the line
  const dragDepth = useRef(0);

  const { products: library } = useBrand();
  const products: any[] = library.length ? library : ((brand.json?.products ?? []) as any[]);
  const cast: any[] = (brand.json?.characters ?? []) as any[];
  const palette = usePalette(brand);
  const marks = useMemo(() => attachableMarks(brand.json), [brand]);
  const recent = shots
    .filter((s) => s.status === 'done' && s.images.length > 0)
    .slice(-6)
    .reverse();

  const chipFor = useCallback(
    (token: SentenceToken, uid?: string): HTMLElement => {
      const el = document.createElement('span');
      el.className = CHIP;
      el.contentEditable = 'false';
      el.dataset.kind = token.t;
      el.dataset.tok = encode(token);
      el.dataset.uid = uid ?? `u${uidSeq.current++}`;

      let label = '';
      let thumb: string | null = null;
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
        thumb = c ? assetUrl(c.shots?.[0]?.file) : (p?.avatarUrl ?? p?.previewUrl ?? null);
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

      /**
       * A chip that opens a picker is a button, and says so.
       *
       * It was a bare span with no tabIndex and a remove button at -1, so the
       * only keyboard route to a chip was to backspace over it: there was no
       * way to reach one, and no way to change one. Tab is intercepted in
       * `onKeyDown` so six chips do not become six tab stops on the way out.
       */
      const pk = pickerKind(token);
      if (pk) {
        el.tabIndex = 0;
        el.setAttribute('role', 'button');
        el.setAttribute('aria-haspopup', 'dialog');
        el.setAttribute('aria-expanded', 'false');
        el.setAttribute('aria-label', `${NOUN[pk]}: ${label}. Change or remove.`);
      }

      const x = document.createElement('button');
      x.type = 'button';
      x.tabIndex = -1;
      // three chips all announcing "Remove" is no help to anyone
      x.setAttribute('aria-label', `Remove ${label}`);
      x.dataset.role = 'remove';
      x.appendChild(closeIcon());
      el.appendChild(x);
      return el;
    },
    [templates, products, cast, presenters, demoProducts, marks, brand, flag],
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
      if (warning) {
        chip.title = warning;
        chip.dataset.warn = '1';
      } else {
        chip.removeAttribute('title');
        delete chip.dataset.warn;
      }
    }
  }, [flag]);

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
      insertToken(root, chipFor(token), { eatQuery: !!menu, fallbackUnits: lastCaret.current });
      emit();
      setMenu(null);
      setQuery('');
    },
    [menu, chipFor, emit],
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

  const openPicker = useCallback((chip: HTMLElement, kind: IngredientKind, caret: number | null, touch: boolean) => {
    const uid = chip.dataset.uid;
    if (!uid) return;
    chip.dataset.open = '';
    chip.setAttribute('aria-expanded', 'true');
    setMenu(null);
    setQuery('');
    setPicker({ uid, kind, anchor: chip, caret, touch });
  }, []);

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
      chip.setAttribute('aria-expanded', 'false');
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
    openMenu: (anchor) => {
      setQuery('');
      setMenu({ anchor });
    },
    focus: () => caretToEnd(rootRef.current),
  }));

  /**
   * Everything the three catalogs offer, built once.
   *
   * The caret menu used to build its own list from the brand library alone, so
   * `@` could not reach a scenri library product and a presenter matched only
   * on name and descriptor while the attach panel searched the whole casting
   * sheet. Both surfaces read this now, so neither can drift from the other.
   */
  const catalog = useMemo(
    () => ({
      libraryProducts: library,
      brandProducts: (brand.json?.products ?? []) as any[],
      demoProducts,
      presenters,
      cast,
      scenes: templates,
      productCategory: activeProductCategory ?? null,
    }),
    [library, brand, demoProducts, presenters, cast, templates, activeProductCategory],
  );

  const candidatesFor = useCallback((kind: IngredientKind): Candidate[] => buildCandidates(kind, catalog), [catalog]);

  const toOption = (c: Candidate, group: string): MenuOption => ({
    key: encode(c.token),
    group,
    label: c.label,
    hint: c.sub,
    search: c.search,
    thumb: c.thumb ?? undefined,
    run: () => (c.kind === 'scene' ? onTemplatePick(c.id) : placeRef.current(c.token)),
  });

  const options: MenuOption[] = useMemo(
    () => [
      ...buildCandidates('product', catalog).map((c) => toOption(c, 'Products')),
      ...buildCandidates('presenter', catalog).map((c) => toOption(c, 'Presenters')),
      ...buildCandidates('scene', catalog).map((c) => toOption(c, 'Scenes')),
      ...palette.map((c) => ({
        key: `c:${c.hex}|${c.name}`,
        group: 'Brand colors',
        label: c.name,
        hint: c.hex,
        swatch: c.hex,
        run: () => placeRef.current({ t: 'color', hex: c.hex, name: c.name }),
      })),
      ...marks.map((m) => ({
        key: `m:${m.hash}`,
        group: 'Brand',
        label: markLabel(brand.json, m),
        hint: 'the mark itself',
        thumb: imgUrl(m.hash as string),
        run: () => placeRef.current({ t: 'mark', imageHash: m.hash as string }),
      })),
      ...recent.map((s, i) => ({
        key: `r:${s.images[0]}`,
        group: 'Recent shots',
        label: `Shot ${recent.length - i}`,
        hint: 'as reference',
        thumb: imgUrl(s.images[0]),
        run: () => placeRef.current({ t: 'ref', imageHash: s.images[0] }),
      })),
    ],
    [catalog, palette, marks, brand, recent, onTemplatePick],
  );

  // / = everything, @ = ingredients (not scenes), # = scenes only
  const shownOptions =
    menu?.sigil === '#'
      ? options.filter((o) => o.group === 'Scenes')
      : menu?.sigil === '@'
        ? options.filter((o) => o.group !== 'Scenes')
        : options;

  // Once the typed query matches nothing the sigil was not a sigil: it was a hex
  // colour or an address. Close, and let the characters stand as plain text.
  useEffect(() => {
    if (!menu || !query) return;
    // the same matcher the menu itself filters with: if these two disagree,
    // the menu closes on a query it would have had rows for
    const hit = shownOptions.some((o) =>
      matchesQuery(`${o.label} ${o.group} ${o.hint ?? ''} ${o.search ?? ''}`, query),
    );
    if (!hit) {
      setMenu(null);
      setQuery('');
    }
  }, [menu, query, shownOptions]);

  const onClick = (e: React.MouseEvent) => {
    const root = rootRef.current;
    const target = e.target as HTMLElement;
    if (target.closest('[data-role="remove"]')) {
      e.preventDefault();
      const chip = chipAt(target);
      if (picker && chip?.dataset.uid === picker.uid) closePicker('remove');
      removeChip(root, chip);
      emit();
      setMenu(null);
      return;
    }
    // Every click in the line is resolved by the line, not by the browser:
    // beside a chip, or in the padding, the browser's answer is wrong.
    caretFromPoint(root, e.clientX, e.clientY);

    const chip = chipAt(target);
    if (!chip) return; // a click in the prose: the caret is already right
    // the outer few pixels are for reaching the caret, not for opening the menu
    const box = chip.getBoundingClientRect();
    if (e.clientX - box.left <= EDGE || box.right - e.clientX <= EDGE) return;
    const uid = chip.dataset.uid ?? null;
    // The touch path already opened it on pointerdown, before the browser
    // could focus the line; this would close what that just opened.
    if (uid && picker?.uid === uid) {
      if (e.detail !== 0) closePicker('outside');
      return;
    }
    const kind = pickerKind(decode(chip.dataset.tok ?? ''));
    // A colour, a reference or a brand mark is not a visual catalog to browse.
    if (!kind) {
      setQuery('');
      setMenu({ anchor: chip });
      return;
    }
    // The caret was just placed by caretFromPoint above, while the line still
    // has focus — so this is an exact reading, and it is the one the picker
    // hands back when it closes.
    openPicker(chip, kind, caretUnits(root), false);
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
    const kind = pickerKind(decode(chip.dataset.tok ?? ''));
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
        const kind = pickerKind(decode(focused.dataset.tok ?? ''));
        if (kind && root) openPicker(focused, kind, unitsBeforeChip(root, focused) + 1, false);
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
      e.preventDefault();
      if (!menu) onSubmit();
      return;
    }
    if (menu || picker) return;
    // '/' inserts anything, '@' an ingredient, '#' a scene. Which one you typed
    // is the filter, so the menu opens already narrowed instead of everything.
    if (e.key === '/' || e.key === '@' || e.key === '#') {
      const root = rootRef.current;
      const before = textBeforeCaret(root);
      const prev = before.slice(-1);
      if (before.length && !/[\s\u00a0]/.test(prev)) return; // mid-word: path, email, or hex
      const rect = caretRect();
      if (rect) {
        setQuery('');
        setMenu({ anchor: { getBoundingClientRect: () => rect }, sigil: e.key });
      }
    }
  };

  const onInput = () => {
    const root = rootRef.current;
    const chips = root?.querySelectorAll(`.${CHIP}`).length ?? 0;
    // a chip deleted with Backspace or Delete leaves both of its spaces behind
    if (chips < chipCount.current) collapseDoubleSpaceAtCaret(root);
    chipCount.current = chips;
    // clearing the line leaves a <br>; strip it and flip data-empty so the
    // placeholder returns even if Chromium re-inserts a caret host
    if (syncEmpty(root)) caretToEnd(root);
    if (menu) {
      const live = sigilAtCaret(root);
      if (!live) {
        setMenu(null);
        setQuery('');
      } else setQuery(live.query);
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
    const parts = parseBriefHtml(e.clipboardData.getData('text/html'));
    if (parts && pasteParts(parts)) return;
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

  return (
    <div className="sc-brief" data-drag-over={dragOver || undefined}>
      <div
        ref={rootRef}
        className="sc-brief-line"
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        dir="auto"
        data-ph={placeholder}
        {...(placeholderSm ? { 'data-ph-sm': placeholderSm } : {})}
        onClick={onClick}
        onPointerDown={onPointerDown}
        onKeyDown={onKeyDown}
        onInput={onInput}
        onCopy={onCopy}
        onCut={onCut}
        onPaste={onPaste}
        onDragEnter={onDragEnter}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onBlur={emit}
      />

      {menu && (
        <TokenMenu
          anchor={menu.anchor}
          query={query}
          options={shownOptions}
          onClose={() => {
            setMenu(null);
            setQuery('');
          }}
        />
      )}

      {picker && (
        <IngredientPicker
          // A reopen gets a clean mount rather than the last one's scroll,
          // search and roving index.
          key={picker.uid}
          kind={picker.kind}
          anchor={picker.anchor}
          currentId={currentIdOf(picker.anchor)}
          candidates={candidatesFor(picker.kind)}
          brandId={brand.id}
          warning={picker.anchor.title || null}
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
          onClose={closePicker}
        />
      )}
    </div>
  );
});

/** What a chip is holding, read back off the element the picker is anchored to. */
function currentIdOf(chip: HTMLElement): string | null {
  const t = decode(chip.dataset.tok ?? '');
  return t && 'id' in t ? t.id : null;
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

function usePalette(brand: Brand) {
  return useMemo(() => flattenPalette(brand.json?.palette), [brand]);
}

export { chipLabel };
