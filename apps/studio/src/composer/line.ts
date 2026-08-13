/**
 * The brief line, as DOM.
 *
 * Everything in this file works on nodes, never on React state, so it can be
 * tested and so there is exactly one place that knows the rules. Two of those
 * rules are the whole reason this module exists:
 *
 * 1. While the user is editing, the DOM is the source of truth. Tokens are read
 *    out of it; they are never written back in except by an explicit repaint.
 * 2. The caret is never moved programmatically during a click. Chromium anchors
 *    its editing caret to a (node, offset) pair and ignores a move made while
 *    it is processing a click: the Selection API keeps reporting the position
 *    you set while the next keystroke lands somewhere else entirely. Structural
 *    edits therefore rearrange the DOM *around* the anchor the browser already
 *    holds, so it ends up where the user expects without being told.
 */

export type SentenceToken =
  | { t: 'text'; v: string }
  | { t: 'product'; id: string; angle?: string }
  | { t: 'character'; id: string }
  | { t: 'color'; hex: string; name?: string }
  | { t: 'ref'; imageHash: string }
  | { t: 'mark'; imageHash: string }
  /** Ask for the brand kit. Carries nothing: asking is the whole payload. */
  | { t: 'brand' }
  | { t: 'template'; id: string };

/** Size lives on the composer, not in the sentence: it renders as nothing. */
export type FormatToken = { t: 'format'; id: string; w: number; h: number };
export type BriefToken = SentenceToken | FormatToken;

export const isSentence = (t: BriefToken): t is SentenceToken => t.t !== 'format';
export const emptySentence = (): SentenceToken[] => [{ t: 'text', v: '' }];

/**
 * A stored brief's tokens, ready to seed a sentence: its size is not sentence
 * content and is dropped, and a legacy brief's bare `templateId` (no token for
 * it yet) is folded into a real template token so the chip shows up. Shared by
 * the Composer's own initialBrief hydration and by anything that needs to
 * write a brief into the persisted per-brand draft using the exact same rules.
 */
export function briefTokens(brief: { tokens: BriefToken[]; templateId?: string }): SentenceToken[] {
  const carried = (brief.tokens ?? []).filter(isSentence);
  const body = carried.length ? carried : emptySentence();
  const hasTemplateToken = body.some((t) => t.t === 'template');
  return brief.templateId && !hasTemplateToken ? [{ t: 'template', id: brief.templateId }, ...body] : body;
}

export const CHIP = 'sc-token';
const CHIP_SELECTOR = `.${CHIP}`;

// ---------------------------------------------------------------- tokens <-> attribute

export const encode = (t: SentenceToken): string =>
  t.t === 'template'
    ? `t:${t.id}`
    : t.t === 'product'
      ? // `angle` is the slot a recipe asked for (e.g. a macro example
        // pinning "material-closeup"). It used to be omitted here, so every
        // round-trip through the DOM silently reset the product to its default
        // angle and "Recreate this" could not reproduce its own tile.
        `p:${t.id}${t.angle ? `|${t.angle}` : ''}`
      : t.t === 'character'
        ? `h:${t.id}`
        : t.t === 'color'
          ? `c:${t.hex}|${t.name ?? ''}`
          : t.t === 'ref'
            ? `r:${t.imageHash}`
            : t.t === 'mark'
              ? `m:${t.imageHash}`
              : t.t === 'brand'
                ? 'b:'
                : '';

export const decode = (s: string): SentenceToken | null => {
  const kind = s.slice(0, 1);
  const rest = s.slice(2);
  if (kind === 't') return rest ? { t: 'template', id: rest } : null;
  if (kind === 'p') {
    const [id, angle] = rest.split('|');
    return id ? { t: 'product', id, ...(angle ? { angle } : {}) } : null;
  }
  if (kind === 'h') return rest ? { t: 'character', id: rest } : null;
  if (kind === 'r') return rest ? { t: 'ref', imageHash: rest } : null;
  if (kind === 'm') return rest ? { t: 'mark', imageHash: rest } : null;
  if (kind === 'b') return { t: 'brand' };
  if (kind === 'c') {
    const [hex, name] = rest.split('|');
    return hex ? { t: 'color', hex, name: name || undefined } : null;
  }
  return null;
};

export const groupOf = (t: SentenceToken): string | null =>
  t.t === 'template'
    ? 'Scenes'
    : t.t === 'product'
      ? 'Products'
      : t.t === 'character'
        ? 'Presenters'
        : t.t === 'color'
          ? 'Brand colors'
          : t.t === 'ref'
            ? 'Recent shots'
            : t.t === 'mark' || t.t === 'brand'
              ? 'Brand'
              : null;

// ---------------------------------------------------------------- read and render

/** The line as tokens. Adjacent text collapses into one run. */
export function readLine(root: HTMLElement | null): SentenceToken[] {
  if (!root) return emptySentence();
  const out: SentenceToken[] = [];
  let buf = '';
  const flush = () => {
    if (buf) {
      out.push({ t: 'text', v: buf });
      buf = '';
    }
  };
  for (const n of Array.from(root.childNodes)) {
    if (n.nodeType === Node.TEXT_NODE) {
      buf += n.textContent ?? '';
      continue;
    }
    const el = n as HTMLElement;
    const raw = el.dataset?.tok;
    if (raw) {
      const tok = decode(raw);
      if (tok) {
        flush();
        out.push(tok);
        continue;
      }
    }
    if (el.tagName === 'BR') {
      buf += '\n';
      continue;
    }
    buf += el.textContent ?? ''; // stray markup the browser produced
  }
  flush();
  if (!out.some((t) => t.t === 'text')) out.push({ t: 'text', v: '' });
  return out;
}

/**
 * Rebuild the line from tokens. This is the ONLY thing that may replace the
 * line's children, and it is called only on an explicit reset: a remix loaded,
 * the brief cleared after sending, a template seeded from Home. It must never
 * run in response to typing.
 */
export function renderLine(
  root: HTMLElement | null,
  tokens: SentenceToken[],
  chipFor: (t: SentenceToken) => HTMLElement,
): void {
  if (!root) return;
  root.textContent = '';
  for (const t of tokens) {
    if (t.t === 'text') {
      if (t.v) root.appendChild(document.createTextNode(t.v));
      continue;
    }
    root.appendChild(chipFor(t));
  }
  normalizeLine(root);
}

// ---------------------------------------------------------------- caret, as an offset

/**
 * The caret as a count of characters, each chip counting as one.
 *
 * A Range dies the moment a repaint replaces the nodes it points at; a number
 * survives. Used only around explicit repaints and normalisation, never on the
 * typing path.
 */
export function caretUnits(root: HTMLElement | null): number | null {
  const sel = typeof window === 'undefined' ? null : window.getSelection();
  if (!root || !sel || sel.rangeCount === 0) return null;
  const r = sel.getRangeAt(0);
  if (!root.contains(r.startContainer)) return null;
  if (r.startContainer === root) {
    let n = 0;
    for (let i = 0; i < r.startOffset && i < root.childNodes.length; i++) n += lengthOf(root.childNodes[i]);
    return n;
  }
  let n = 0;
  for (const c of Array.from(root.childNodes)) {
    if (c === r.startContainer) return n + r.startOffset;
    if (c.contains(r.startContainer)) return n + 1; // inside a chip counts as just after it
    n += lengthOf(c);
  }
  return n;
}

/** Restore a caret recorded by caretUnits, always inside a real text node. */
export function setCaretUnits(root: HTMLElement | null, units: number): void {
  if (!root) return;
  let n = 0;
  for (const c of Array.from(root.childNodes)) {
    const len = lengthOf(c);
    if (units <= n + len) {
      if (c.nodeType === Node.TEXT_NODE) {
        placeCaret(root, c as Text, units - n);
        return;
      }
      // a chip cannot hold a caret, so use the text just after it
      const next = c.nextSibling;
      if (next?.nodeType === Node.TEXT_NODE) {
        placeCaret(root, next as Text, 0);
        return;
      }
      break;
    }
    n += len;
  }
  caretToEnd(root);
}

/**
 * Put the caret at the end of the line, inside a real text node.
 *
 * selectNodeContents + collapse anchors the caret to the editable host itself
 * (container is the div, offset is a child index). Chromium will not type into
 * that position when the line ends in a contenteditable=false chip: it drops
 * the next keystroke at offset 0 instead, which reads as "I cannot type after
 * the chip".
 */
export function caretToEnd(root: HTMLElement | null): void {
  if (!root) return;
  // This is the "give me the caret back" entry point, used when focus really
  // did leave (a Radix menu closing, the file dialog). Focusing is safe here:
  // it is a genuine transition, which is exactly when Chromium re-establishes
  // an editing caret. It is a no-op when the line already has focus.
  root.focus({ preventScroll: true });
  if (!root.firstChild) {
    // an empty line has nothing to anchor to, and has to stay :empty for its
    // placeholder, so the host caret is the right answer there
    const sel = window.getSelection();
    const r = document.createRange();
    r.selectNodeContents(root);
    r.collapse(false);
    sel?.removeAllRanges();
    sel?.addRange(r);
    return;
  }
  const tail = tailText(root);
  placeCaret(root, tail, tail.length);
}

/** The line's last text node, adding the space a trailing chip needs. */
export function tailText(root: HTMLElement): Text {
  const last = root.lastChild;
  if (last && last.nodeType === Node.TEXT_NODE) return last as Text;
  const t = document.createTextNode(' ');
  root.appendChild(t);
  return t;
}

function placeCaret(root: HTMLElement, node: Text, offset: number) {
  const sel = window.getSelection();
  const r = document.createRange();
  r.setStart(node, Math.max(0, Math.min(offset, node.length)));
  r.collapse(true);
  sel?.removeAllRanges();
  sel?.addRange(r);
  void root;
}

const lengthOf = (n: ChildNode): number => (n.nodeType === Node.TEXT_NODE ? (n.textContent ?? '').length : 1);

// ---------------------------------------------------------------- the invariants

/**
 * Bring the line back to its canonical shape, carrying the caret across.
 *
 * Every structural edit ends here, so the rules live in exactly one place:
 *
 *  - no empty text nodes, no adjacent text nodes
 *  - exactly one space on each side of a chip
 *  - no space at the very start
 *  - a text node always follows a trailing chip, so there is somewhere to type
 */
export function normalizeLine(root: HTMLElement | null): void {
  if (!root) return;
  const at = caretUnits(root);

  root.normalize();
  for (const n of Array.from(root.childNodes)) {
    if (n.nodeType === Node.TEXT_NODE && !(n.textContent ?? '').length) n.remove();
  }

  const kids = Array.from(root.childNodes);
  for (let i = 0; i < kids.length; i++) {
    const n = kids[i];
    if (n.nodeType !== Node.TEXT_NODE) continue;
    let v = (n.textContent ?? '').replace(/ {2,}/g, ' ');
    const prevIsChip = isChip(n.previousSibling);
    const nextIsChip = isChip(n.nextSibling);
    if (prevIsChip)
      v = v.replace(/^ */, ' '); // exactly one, never none
    else if (!n.previousSibling) v = v.replace(/^ +/, ''); // nothing leads the sentence
    if (nextIsChip) v = v.replace(/ *$/, ' ');
    n.textContent = v;
  }

  // chips that ended up shoulder to shoulder need the space between them
  for (const n of Array.from(root.childNodes)) {
    if (isChip(n) && isChip(n.nextSibling)) {
      root.insertBefore(document.createTextNode(' '), n.nextSibling);
    }
  }
  if (isChip(root.lastChild)) root.appendChild(document.createTextNode(' '));
  if (isChip(root.firstChild)) root.insertBefore(document.createTextNode(''), root.firstChild);

  // Chromium leaves a lone <br> (or an empty wrapper) when the user clears the
  // line. Strip it and keep data-empty in sync for the placeholder.
  if (syncEmpty(root)) return;

  if (at !== null) setCaretUnits(root, at);
}

/**
 * True when the line has no chips and no real text.
 *
 * Chromium often leaves a lone <br>, a zwsp, or an empty <div><br></div>
 * wrapper after the user clears the line — none of those count as content.
 */
export function isBlankLine(root: HTMLElement): boolean {
  if (root.querySelector(CHIP_SELECTOR)) return false;
  return !(root.textContent ?? '').replace(/[\u200B\uFEFF\u00a0]/g, '').trim();
}

/**
 * Drop empty-editor leftovers and mirror blankness onto data-empty.
 *
 * The placeholder is driven by [data-empty], not :empty — :empty fails as soon
 * as Chromium inserts a <br> on focus or after a clear.
 */
export function syncEmpty(root: HTMLElement | null): boolean {
  if (!root) return false;
  const blank = isBlankLine(root);
  if (blank && root.firstChild) root.replaceChildren();
  root.toggleAttribute('data-empty', blank);
  return blank;
}

const isChip = (n: ChildNode | null): boolean =>
  !!n && n.nodeType === Node.ELEMENT_NODE && (n as HTMLElement).classList.contains(CHIP);

// ---------------------------------------------------------------- insert and remove

export interface InsertOptions {
  /** Only a slash-menu pick consumes the "/query" that opened the menu. */
  eatQuery?: boolean;
  /** Where the caret was before focus left the line (file dialog, search box). */
  fallbackUnits?: number | null;
}

/**
 * Drop a chip where the caret is and leave the caret after it.
 *
 * The caret's own text node is REUSED as the single space that follows the
 * chip, and the surrounding text is rebuilt around it. Splitting the node the
 * ordinary way would leave the browser's anchor on the half before the chip,
 * which is what made a chip look appended while typing carried on in front of
 * it. Because the node the browser points at is the one that ends up after the
 * chip, its offset simply clamps to the end of that space and no programmatic
 * caret move is needed at all.
 */
export function insertToken(root: HTMLElement | null, chip: HTMLElement, opts: InsertOptions = {}): void {
  if (!root) return;
  const sel = window.getSelection();
  let range: Range | null = null;
  if (sel && sel.rangeCount > 0 && root.contains(sel.getRangeAt(0).startContainer)) {
    range = sel.getRangeAt(0);
  } else if (opts.fallbackUnits != null) {
    setCaretUnits(root, opts.fallbackUnits);
    const live = window.getSelection();
    if (live && live.rangeCount > 0 && root.contains(live.getRangeAt(0).startContainer)) range = live.getRangeAt(0);
  }
  if (!range) {
    range = document.createRange();
    range.selectNodeContents(root);
    range.collapse(false);
  }
  range.deleteContents(); // a highlighted stretch is what the chip replaces

  let host: Text;
  let at: number;
  if (range.startContainer.nodeType === Node.TEXT_NODE) {
    host = range.startContainer as Text;
    at = range.startOffset;
  } else {
    const parentEl = range.startContainer as HTMLElement;
    host = document.createTextNode('');
    parentEl.insertBefore(host, parentEl.childNodes[range.startOffset] ?? null);
    at = 0;
  }

  const full = host.textContent ?? '';
  let before = full.slice(0, at);
  const after = full.slice(at);

  if (opts.eatQuery) before = eatQuery(host, before);

  const parent = host.parentNode;
  if (!parent) return;
  host.textContent = ' ';
  if (after.trim() || after.length > 1) parent.insertBefore(document.createTextNode(after), host.nextSibling);
  parent.insertBefore(chip, host);
  if (before) parent.insertBefore(document.createTextNode(before), chip);

  /*
   * Then say where the caret goes, explicitly.
   *
   * Reusing the node is what keeps the browser's anchor on the right side of
   * the chip, but rewriting that node's text resets its offset, so the caret
   * would sit at the start of the space and the next keystroke would run into
   * the chip's label. This assignment is honoured because the line never lost
   * focus: every control that can insert cancels mousedown (see keepCaret).
   */
  placeCaret(root, host, host.length);
  normalizeLine(root);
}

/** `/` inserts anything; `@` ingredients; `#` a scene. */
export const SIGILS = ['/', '@', '#'] as const;
export type Sigil = (typeof SIGILS)[number];
const isSigil = (c: string): c is Sigil => (SIGILS as readonly string[]).includes(c);
const isBreak = (c: string) => c === ' ' || c === '\n' || c === '\u00a0';

/**
 * The sigil query the caret currently sits in, or null.
 *
 * A sigil only counts at the start of a word. That single rule is what keeps
 * `#F5C518` a hex colour and `tony@example.com` an address: in both the
 * character has a letter or digit in front of it, so no menu opens. Whitespace
 * closes a query, so a menu never survives past the word it started.
 */
export function sigilAtCaret(root: HTMLElement | null): { sigil: Sigil; query: string } | null {
  const before = textBeforeCaret(root);
  for (let i = before.length - 1; i >= 0; i--) {
    const ch = before[i];
    if (isBreak(ch)) return null;
    if (isSigil(ch)) {
      const atWordStart = i === 0 || isBreak(before[i - 1]);
      return atWordStart ? { sigil: ch, query: before.slice(i + 1) } : null;
    }
  }
  return null;
}

/** Remove the "/query", "@query" or "#query" that opened the menu, even across text nodes. */
function eatQuery(host: Text, before: string): string {
  const cut = (v: string) => Math.max(v.lastIndexOf('/'), v.lastIndexOf('@'), v.lastIndexOf('#'));
  const here = cut(before);
  if (here >= 0) return before.slice(0, here);
  const wipe: ChildNode[] = [];
  for (let n = host.previousSibling; n && n.nodeType === Node.TEXT_NODE; n = n.previousSibling) {
    const v = n.textContent ?? '';
    const i = cut(v);
    if (i >= 0) {
      n.textContent = v.slice(0, i);
      for (const w of wipe) w.remove();
      return '';
    }
    wipe.push(n);
  }
  return before;
}

/** Take a chip out and close the gap, leaving the caret at the seam. */
export function removeChip(root: HTMLElement | null, chip: Element | null): void {
  if (!root || !chip) return;
  root.normalize();
  const before = unitsBefore(root, chip);
  chip.remove();
  normalizeLine(root);
  setCaretUnits(root, before);
}

function unitsBefore(root: HTMLElement, node: Node): number {
  let n = 0;
  for (const c of Array.from(root.childNodes)) {
    if (c === node) break;
    n += lengthOf(c);
  }
  return n;
}

/** True when the caret sits between two spaces, as a deleted chip leaves it. */
export function collapseDoubleSpaceAtCaret(root: HTMLElement | null): void {
  if (!root) return;
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || !sel.getRangeAt(0).collapsed) return;
  const range = sel.getRangeAt(0);
  const node = range.startContainer;
  if (node.nodeType !== Node.TEXT_NODE || !root.contains(node)) return;
  const text = node as Text;
  const v = text.textContent ?? '';
  const at = range.startOffset;
  if (v[at - 1] !== ' ' || v[at] !== ' ') return;
  text.textContent = v.slice(0, at) + v.slice(at + 1);
  placeCaret(root, text, at);
}

// ---------------------------------------------------------------- slash query

/**
 * Text from the start of the run up to the caret, for filtering the menu.
 * A chip ends the query; the browser can split one run of typing across
 * several text nodes, so this walks back over them.
 */
export function textBeforeCaret(root: HTMLElement | null): string {
  const sel = typeof window === 'undefined' ? null : window.getSelection();
  if (!root || !sel || sel.rangeCount === 0) return '';
  const r = sel.getRangeAt(0);
  if (r.startContainer.nodeType !== Node.TEXT_NODE || !root.contains(r.startContainer)) return '';
  let out = (r.startContainer.textContent ?? '').slice(0, r.startOffset);
  for (let n = r.startContainer.previousSibling; n && n.nodeType === Node.TEXT_NODE; n = n.previousSibling) {
    out = (n.textContent ?? '') + out;
  }
  return out;
}

/** Rect of the caret, so the slash menu opens where the user is typing. */
export function caretRect(): DOMRect | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const r = sel.getRangeAt(0).cloneRange();
  const rect = r.getBoundingClientRect();
  if (rect.width || rect.height) return rect;
  const probe = document.createElement('span');
  probe.textContent = '​';
  r.insertNode(probe);
  const out = probe.getBoundingClientRect();
  const parent = probe.parentNode;
  probe.remove();
  parent?.normalize();
  return out;
}

/**
 * Put the caret immediately before or after a chip.
 *
 * A chip is an atom: the caret must never end up inside it, where there is
 * nothing to type into and arrow keys have to walk back out. user-select:none
 * keeps the browser from putting it there, but then a click on the chip has
 * nowhere to go and Chromium falls back to the start of the line, so the side
 * the user clicked has to be honoured explicitly. This is safe to do during a
 * click: the line never loses focus, which is the case Chromium honours.
 */
export function caretBeside(root: HTMLElement | null, chip: Element | null, side: 'before' | 'after'): void {
  if (!root || !chip) return;
  if (side === 'after') {
    const next = chip.nextSibling;
    if (next?.nodeType === Node.TEXT_NODE) {
      const t = next as Text;
      // past the single space that follows a chip, so the caret reads as
      // sitting after the pill rather than wedged against it
      placeCaret(root, t, Math.min(1, t.length));
      return;
    }
    const t = document.createTextNode(' ');
    chip.parentNode?.insertBefore(t, chip.nextSibling);
    placeCaret(root, t, t.length);
    return;
  }
  const prev = chip.previousSibling;
  if (prev?.nodeType === Node.TEXT_NODE) {
    const t = prev as Text;
    placeCaret(root, t, t.length);
    return;
  }
  const t = document.createTextNode('');
  chip.parentNode?.insertBefore(t, chip);
  placeCaret(root, t, 0);
}

/** How far either side of a chip still counts as "I meant this chip". */
const CHIP_GAP = 9;

/** One rect per rendered row of the line, in order. */
function rowRects(root: HTMLElement): DOMRect[] {
  if (!root.firstChild) return [];
  const r = document.createRange();
  r.selectNodeContents(root);
  return Array.from(r.getClientRects()).filter((b) => b.height > 0);
}

/** The row a click belongs to, even when it landed in the padding. */
function nearestRow(rows: DOMRect[], y: number): DOMRect | null {
  let best: DOMRect | null = null;
  let bestGap = Infinity;
  for (const row of rows) {
    const gap = y < row.top ? row.top - y : y > row.bottom ? y - row.bottom : 0;
    if (gap < bestGap) {
      bestGap = gap;
      best = row;
    }
  }
  return best;
}

/**
 * Place the caret for a click anywhere in the line.
 *
 * The browser cannot be trusted with this. Two failures, both measured:
 * a click in the few pixels between a chip and the text after it resolves to
 * the position BEFORE the chip, tens of pixels away on the other side of it;
 * and a click in the line's padding, above or below the row, resolves to the
 * very start of the sentence instead of to the nearest position on that row.
 * Together they meant a click next to a chip threw the caret back to the front
 * of the brief.
 *
 * So: the click is pulled onto the nearest row, and if it fell on or beside a
 * chip, which half of that chip decides. Anything else is handed back to the
 * browser at the corrected point, where it behaves.
 *
 * Returns true when this click was ours to place.
 */
export function caretFromPoint(root: HTMLElement | null, x: number, y: number): boolean {
  if (!root) return false;
  const rows = rowRects(root);
  const row = nearestRow(rows, y);
  if (!row) return false;
  const cy = row.top + row.height / 2;

  for (const chip of Array.from(root.querySelectorAll<HTMLElement>(CHIP_SELECTOR))) {
    const r = chip.getBoundingClientRect();
    if (r.bottom < row.top || r.top > row.bottom) continue; // a chip on another row
    if (x < r.left - CHIP_GAP || x > r.right + CHIP_GAP) continue;
    caretBeside(root, chip, x < r.left + r.width / 2 ? 'before' : 'after');
    return true;
  }

  // the click was in the padding: ask again from inside the row
  if (Math.abs(cy - y) < 1) return false;
  const at = caretRangeFromPoint(x, cy);
  if (!at || !root.contains(at.node)) return false;
  if (at.node.nodeType !== Node.TEXT_NODE) return false;
  placeCaret(root, at.node as Text, at.offset);
  return true;
}

/** caretRangeFromPoint is Chromium and WebKit; Firefox spells it differently. */
function caretRangeFromPoint(x: number, y: number): { node: Node; offset: number } | null {
  const doc = document as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  };
  const r = doc.caretRangeFromPoint?.(x, y);
  if (r) return { node: r.startContainer, offset: r.startOffset };
  const p = doc.caretPositionFromPoint?.(x, y);
  return p ? { node: p.offsetNode, offset: p.offset } : null;
}

// ---------------------------------------------------------------- focus

/**
 * Stop a control from taking the caret out of the brief.
 *
 * Put this on the CONTAINER of anything that inserts into the line (the plus
 * menu, the attach panel, the token menu) rather than on each button. Guarding
 * one control at a time is how the plus button stayed broken for three rounds
 * while its siblings were fixed; a container guard covers everything inside it,
 * including whatever gets added later.
 *
 * Cancelling mousedown is what keeps the caret: Chromium re-establishes an
 * editing caret only on a real focus transition, so once focus has genuinely
 * left the line, putting it back programmatically is reported but not honoured.
 * Fields the user has to type into are exempt, and they use the caret fallback.
 */
export function keepCaret(e: { target: EventTarget | null; preventDefault(): void }): void {
  const el = e.target as HTMLElement | null;
  if (el?.closest?.('input, textarea, select, [contenteditable=""], [contenteditable="true"]')) return;
  e.preventDefault();
}

// ---------------------------------------------------------------- clipboard

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Two flavours of the selection.
 *
 * text/plain reads a chip as its label, so anywhere else in the world this
 * pastes as the sentence you see. text/html carries each chip's token inside a
 * data-sc-brief wrapper, so pasting back into a brief rebuilds the chips.
 *
 * Chromium reports an empty Selection.toString() when the endpoints land on an
 * editable host, so the default clipboard write would be empty on a select all.
 */
export function serializeSelection(range: Range): { text: string; html: string } {
  let text = '';
  let html = '';
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const v = node.textContent ?? '';
      text += v;
      html += esc(v);
      return;
    }
    const el = node as HTMLElement;
    const raw = el.dataset?.tok;
    if (raw) {
      const label = chipLabel(el);
      text += label;
      html += `<span data-sc-tok="${esc(raw)}">${esc(label)}</span>`;
      return;
    }
    node.childNodes.forEach(walk);
  };
  range.cloneContents().childNodes.forEach(walk);
  return { text, html: `<span data-sc-brief="1">${html}</span>` };
}

/** A chip's words, without the remove button's own (empty) text. */
export function chipLabel(chip: HTMLElement): string {
  let out = '';
  for (const n of Array.from(chip.childNodes)) {
    if (n.nodeType === Node.TEXT_NODE) out += n.textContent ?? '';
  }
  return out.trim();
}

/**
 * Read our own clipboard flavour into parts. Markup is never inserted: only
 * the tokens are read, and the chips get rebuilt from scratch by the caller.
 * The data-sc-brief wrapper is required, because any page on the web can put a
 * data-sc-tok in the HTML it puts on your clipboard.
 *
 * data-bt-* is the pre-rename spelling, read but never written: a brief copied
 * before the upgrade is still on the clipboard, and it should still paste as
 * chips. The wrapper requirement applies to it identically, so accepting the
 * old name widens no trust.
 */
export function parseBriefHtml(html: string): (string | SentenceToken)[] | null {
  if (!html.includes('data-sc-brief') && !html.includes('data-bt-brief')) return null;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const host = doc.querySelector('[data-sc-brief], [data-bt-brief]');
  if (!host) return null;
  const parts: (string | SentenceToken)[] = [];
  const walk = (n: Node) => {
    if (n.nodeType === Node.TEXT_NODE) {
      parts.push(n.textContent ?? '');
      return;
    }
    const el = n as HTMLElement;
    const raw = el.dataset?.scTok ?? el.dataset?.btTok;
    if (raw === undefined) {
      n.childNodes.forEach(walk);
      return;
    }
    const tok = decode(raw);
    parts.push(tok ?? el.textContent ?? '');
  };
  host.childNodes.forEach(walk);
  return parts.length ? parts : null;
}

// ---------------------------------------------------------------- chips

/** One template per brief: the existing chip, if the line already has one. */
export const templateChip = (root: HTMLElement | null): HTMLElement | null =>
  root?.querySelector<HTMLElement>('[data-kind="template"]') ?? null;

export const chipAt = (target: EventTarget | null): HTMLElement | null =>
  (target as HTMLElement | null)?.closest?.(CHIP_SELECTOR) ?? null;

/**
 * Every template keeps its own hue but reads at the same strength. Raw
 * extracted colours range from near-black to cream, so mixing them straight
 * into the chip made some invisible and others washed out.
 */
export function normalizeTint(hex?: string | null): string | undefined {
  if (!hex || !/^#[0-9a-f]{6}$/i.test(hex)) return undefined;
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b),
    d = max - min;
  if (d < 0.02) return undefined;
  let h: number;
  if (max === r) h = (((g - b) / d + (g < b ? 6 : 0)) * 60) % 360;
  else if (max === g) h = ((b - r) / d + 2) * 60;
  else h = ((r - g) / d + 4) * 60;
  return `hsl(${Math.round(h)} 55% 55%)`;
}

/** Built as nodes rather than markup: nothing in this tree is ever parsed. */
export function closeIcon(): SVGElement {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('width', '9');
  svg.setAttribute('height', '9');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2.4');
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', 'm6 6 12 12M18 6 6 18');
  svg.appendChild(path);
  return svg;
}
