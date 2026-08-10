import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { assetUrl, imgUrl, type Brand, type Scene, type Presenter, type DemoProduct, type TreeNode } from '../api.js';
import { useBrand } from '../app/BrandLayout.js';
import { TokenMenu, type MenuOption } from './TokenMenu.js';
import {
  CHIP,
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
  groupOf,
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

const ROLE_NAMES = ['Primary', 'Secondary', 'Accent', 'Accent 2', 'Neutral', 'Neutral 2'];
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
    /** The one warning a click can actually fix: a template chip that builds
     * around a product with none attached. A click there used to be the same
     * swap-this-template menu every chip gets — which doesn't add a product —
     * so this takes over instead and opens where one gets attached. */
    onProductWarningClick?: () => void;
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
    onProductWarningClick,
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
  const [openChip, setOpenChip] = useState<string | null>(null);
  const [menu, setMenu] = useState<{
    anchor: { getBoundingClientRect(): DOMRect } | null;
    replaceUid?: string;
    sigil?: '/' | '@' | '#';
  } | null>(null);
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
        label = t?.name ?? 'missing template';
        thumb = t?.previewUrl ?? null;
        const tint = normalizeTint(t?.previewColor);
        if (tint) {
          el.dataset.tinted = 'true';
          el.style.setProperty('--tint', tint);
        }
      } else if (token.t === 'product') {
        const p = products.find((x) => x.id === token.id);
        const d = p ? null : demoProducts.find((x) => x.id === token.id);
        label = p?.name ?? d?.name ?? 'missing product';
        thumb = p ? assetUrl(p.shots?.[0]?.file) : (d?.previewUrl ?? null);
      } else if (token.t === 'character') {
        const c = cast.find((x) => x.id === token.id);
        const p = c ? null : presenters.find((x) => x.id === token.id);
        label = c?.name ?? p?.name ?? 'missing person';
        thumb = c ? assetUrl(c.shots?.[0]?.file) : (p?.previewUrl ?? null);
      } else if (token.t === 'color') {
        label = token.name ?? token.hex;
        swatch = token.hex;
      } else if (token.t === 'ref') {
        label = 'reference';
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

      const x = document.createElement('button');
      x.type = 'button';
      x.tabIndex = -1;
      x.setAttribute('aria-label', 'Remove');
      x.dataset.role = 'remove';
      x.appendChild(closeIcon());
      el.appendChild(x);
      return el;
    },
    [templates, products, cast, presenters, demoProducts, flag],
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
      const replaceUid = menu?.replaceUid;
      if (replaceUid) {
        const el = root.querySelector<HTMLElement>(`[data-uid="${replaceUid}"]`);
        if (el) {
          el.replaceWith(chipFor(token, replaceUid));
          normalizeLine(root);
          emit();
        }
        setMenu(null);
        setQuery('');
        setOpenChip(null);
        return;
      }
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

  const options: MenuOption[] = useMemo(
    () => [
      ...templates.map((t) => ({
        key: `t:${t.id}`,
        group: 'Scenes',
        label: t.name,
        hint: t.lighting,
        thumb: t.previewUrl ?? undefined,
        run: () => onTemplatePick(t.id),
      })),
      ...products.map((p) => ({
        key: `p:${p.id}`,
        group: 'Products',
        label: p.name,
        thumb: assetUrl(p.shots?.[0]?.file) ?? undefined,
        run: () => placeRef.current({ t: 'product', id: p.id }),
      })),
      ...presenters.map((p) => ({
        key: `h:${p.id}`,
        group: 'Presenters',
        label: p.name,
        hint: p.descriptor,
        thumb: p.previewUrl ?? undefined,
        run: () => placeRef.current({ t: 'character', id: p.id }),
      })),
      ...palette.map((c) => ({
        key: `c:${c.hex}|${c.name}`,
        group: 'Brand colors',
        label: c.name,
        hint: c.hex,
        swatch: c.hex,
        run: () => placeRef.current({ t: 'color', hex: c.hex, name: c.name }),
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
    [templates, products, presenters, palette, recent, onTemplatePick],
  );

  const openTok = openChip
    ? decode(rootRef.current?.querySelector<HTMLElement>(`[data-uid="${openChip}"]`)?.dataset.tok ?? '')
    : null;
  const menuGroup = openTok ? groupOf(openTok) : null;
  // / = everything, @ = ingredients (not scenes), # = scenes only
  const bySigil =
    menu?.sigil === '#'
      ? options.filter((o) => o.group === 'Scenes')
      : menu?.sigil === '@'
        ? options.filter((o) => o.group !== 'Scenes')
        : options;
  const shownOptions = menuGroup ? options.filter((o) => o.group === menuGroup) : bySigil;
  const selectedKey = openTok ? encode(openTok) || undefined : undefined;

  // Once the typed query matches nothing the sigil was not a sigil: it was a hex
  // colour or an address. Close, and let the characters stand as plain text.
  useEffect(() => {
    if (!menu || menu.replaceUid || !query) return;
    const q = query.toLowerCase();
    const hit = shownOptions.some((o) => `${o.label} ${o.group} ${o.hint ?? ''}`.toLowerCase().includes(q));
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
      removeChip(root, chipAt(target));
      emit();
      setMenu(null);
      setOpenChip(null);
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
    if (chip.dataset.warn && onProductWarningClick) {
      e.preventDefault();
      onProductWarningClick();
      return;
    }
    const uid = chip.dataset.uid ?? null;
    if (openChip === uid) {
      setMenu(null);
      setOpenChip(null);
      return;
    }
    setQuery('');
    setOpenChip(uid);
    setMenu({ anchor: chip, replaceUid: uid ?? undefined });
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape' && menu) {
      e.preventDefault();
      setMenu(null);
      setQuery('');
      setOpenChip(null);
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!menu) onSubmit();
      return;
    }
    if (menu) return;
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
    if (menu && !menu.replaceUid) {
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
      return true;
    },
    [templates, products, cast, presenters, demoProducts],
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
          selectedKey={selectedKey}
          onClose={() => {
            setMenu(null);
            setQuery('');
            setOpenChip(null);
          }}
        />
      )}
    </div>
  );
});

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
  return 'reference';
}

function usePalette(brand: Brand) {
  return useMemo(() => {
    const p = brand.json?.palette;
    const raw: { hex: string; name?: string }[] = [];
    const add = (c: any) => {
      if (c?.hex) raw.push({ hex: String(c.hex).toUpperCase(), name: c.name });
    };
    add(p?.primary);
    add(p?.secondary);
    (p?.accent ?? []).forEach(add);
    (p?.neutrals ?? []).forEach(add);
    return raw.map((c, i) => ({ hex: c.hex, name: c.name ?? ROLE_NAMES[i] ?? `Color ${i + 1}` }));
  }, [brand]);
}

export { chipLabel };
